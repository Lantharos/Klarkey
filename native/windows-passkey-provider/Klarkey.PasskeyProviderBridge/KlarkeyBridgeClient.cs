using System.Diagnostics;
using System.Text.Json;

namespace Klarkey.PasskeyProviderBridge;

public sealed class KlarkeyBridgeClient : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly KlarkeyBridgeClientOptions options;

    public KlarkeyBridgeClient(KlarkeyBridgeClientOptions options)
    {
        this.options = options;
    }

    public Task<BridgeEnvelope<PingResult>> PingAsync(CancellationToken cancellationToken = default) =>
        SendAsync<PingRequest, PingResult>(new PingRequest(CreateRequestId()), cancellationToken);

    public Task<BridgeEnvelope<FindCredentialsResult>> FindCredentialsAsync(
        string url,
        string requestDetailsJson,
        CancellationToken cancellationToken = default
    ) =>
        SendAsync<FindCredentialsRequest, FindCredentialsResult>(
            new FindCredentialsRequest(CreateRequestId(), url, requestDetailsJson),
            cancellationToken
        );

    public Task<BridgeEnvelope<ActionExecutionResult>> StoreCredentialAsync(
        string url,
        string requestDetailsJson,
        string responseJson,
        CancellationToken cancellationToken = default
    ) =>
        SendAsync<StoreCredentialRequest, ActionExecutionResult>(
            new StoreCredentialRequest(CreateRequestId(), url, requestDetailsJson, responseJson),
            cancellationToken
        );

    public Task<BridgeEnvelope<ActionExecutionResult>> TouchCredentialAsync(
        string credentialId,
        CancellationToken cancellationToken = default
    ) =>
        SendAsync<TouchCredentialRequest, ActionExecutionResult>(
            new TouchCredentialRequest(CreateRequestId(), credentialId),
            cancellationToken
        );

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private async Task<BridgeEnvelope<TResponse>> SendAsync<TRequest, TResponse>(
        TRequest request,
        CancellationToken cancellationToken
    )
    {
        using var process = new Process
        {
            StartInfo = options.CreateStartInfo()
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("Klarkey bridge process did not start.");
        }

        using var timeoutCts = new CancellationTokenSource(options.Timeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

        await WriteMessageAsync(process.StandardInput.BaseStream, request, linkedCts.Token);
        process.StandardInput.Close();

        var response = await ReadMessageAsync<TResponse>(process.StandardOutput.BaseStream, linkedCts.Token);
        var errorOutput = await process.StandardError.ReadToEndAsync(linkedCts.Token);
        await process.WaitForExitAsync(linkedCts.Token);

        if (!response.Ok && response.Error is null && !string.IsNullOrWhiteSpace(errorOutput))
        {
            return response with
            {
                Error = new BridgeError("provider_bridge_failure", errorOutput.Trim())
            };
        }

        return response;
    }

    private static async Task WriteMessageAsync<TRequest>(
        Stream stream,
        TRequest request,
        CancellationToken cancellationToken
    )
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(request, JsonOptions);
        var header = BitConverter.GetBytes(payload.Length);

        await stream.WriteAsync(header, cancellationToken);
        await stream.WriteAsync(payload, cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }

    private static async Task<BridgeEnvelope<TResponse>> ReadMessageAsync<TResponse>(
        Stream stream,
        CancellationToken cancellationToken
    )
    {
        var header = await ReadExactAsync(stream, sizeof(int), cancellationToken);
        var length = BitConverter.ToInt32(header, 0);
        if (length <= 0)
        {
            throw new InvalidOperationException("Klarkey bridge returned an empty response.");
        }

        var payload = await ReadExactAsync(stream, length, cancellationToken);
        var response = JsonSerializer.Deserialize<BridgeEnvelope<TResponse>>(payload, JsonOptions);
        return response ?? throw new InvalidOperationException("Klarkey bridge returned malformed JSON.");
    }

    private static async Task<byte[]> ReadExactAsync(Stream stream, int byteCount, CancellationToken cancellationToken)
    {
        var buffer = new byte[byteCount];
        var offset = 0;

        while (offset < byteCount)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset, byteCount - offset), cancellationToken);
            if (read == 0)
            {
                throw new EndOfStreamException("Klarkey bridge closed the stream before the response completed.");
            }

            offset += read;
        }

        return buffer;
    }

    private static string CreateRequestId() =>
        $"req_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds():x}_{Guid.NewGuid():N}"[..28];
}
