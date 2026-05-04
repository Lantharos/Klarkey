using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using System.Text.RegularExpressions;

namespace Klarkey.PasskeyProviderBridge;

public sealed class KlarkeyBridgeClient : IAsyncDisposable
{
    private const int MaxBridgeRequestBytes = 2 * 1024 * 1024;
    private const int MaxBridgeResponseBytes = 1024 * 1024;
    private const int MaxBridgeErrorBytes = 16 * 1024;
    private const string GenericBridgeFailureMessage = "Klarkey provider bridge failed.";

    private static readonly Regex SensitiveErrorPattern = new(
        @"(?i)(token|secret|password|passkey|credential|private|jwt|bearer|cookie|authorization|client_secret|refresh_token|id_token|access_token|app_key|vault)",
        RegexOptions.CultureInvariant
    );

    private static readonly Regex UrlErrorPattern = new(
        @"(?i)\b(?:https?://|file://|[a-z]:\\|\\\\)",
        RegexOptions.CultureInvariant
    );

    private readonly KlarkeyBridgeClientOptions options;

    public KlarkeyBridgeClient(KlarkeyBridgeClientOptions options)
    {
        this.options = options;
    }

    public Task<BridgeEnvelope<PingResult>> PingAsync(CancellationToken cancellationToken = default) =>
        SendAsync(
            new PingRequest(CreateRequestId()),
            BridgeTypeInfo<PingRequest>(),
            BridgeTypeInfo<BridgeEnvelope<PingResult>>(),
            cancellationToken
        );

    public Task<BridgeEnvelope<FindCredentialsResult>> FindCredentialsAsync(
        string url,
        string requestDetailsJson,
        CancellationToken cancellationToken = default
    ) =>
        SendAsync(
            new FindCredentialsRequest(CreateRequestId(), url, requestDetailsJson),
            BridgeTypeInfo<FindCredentialsRequest>(),
            BridgeTypeInfo<BridgeEnvelope<FindCredentialsResult>>(),
            cancellationToken
        );

    public Task<BridgeEnvelope<ActionExecutionResult>> StoreCredentialAsync(
        string url,
        string requestDetailsJson,
        string responseJson,
        CancellationToken cancellationToken = default
    ) =>
        SendAsync(
            new StoreCredentialRequest(CreateRequestId(), url, requestDetailsJson, responseJson),
            BridgeTypeInfo<StoreCredentialRequest>(),
            BridgeTypeInfo<BridgeEnvelope<ActionExecutionResult>>(),
            cancellationToken
        );

    public Task<BridgeEnvelope<ActionExecutionResult>> TouchCredentialAsync(
        string credentialId,
        CancellationToken cancellationToken = default
    ) =>
        SendAsync(
            new TouchCredentialRequest(CreateRequestId(), credentialId),
            BridgeTypeInfo<TouchCredentialRequest>(),
            BridgeTypeInfo<BridgeEnvelope<ActionExecutionResult>>(),
            cancellationToken
        );

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private async Task<BridgeEnvelope<TResponse>> SendAsync<TRequest, TResponse>(
        TRequest request,
        JsonTypeInfo<TRequest> requestJsonType,
        JsonTypeInfo<BridgeEnvelope<TResponse>> responseJsonType,
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

        await WriteMessageAsync(process.StandardInput.BaseStream, request, requestJsonType, linkedCts.Token);
        process.StandardInput.Close();

        var response = await ReadMessageAsync(process.StandardOutput.BaseStream, responseJsonType, linkedCts.Token);
        var errorOutput = await ReadBoundedErrorOutputAsync(process.StandardError, linkedCts.Token);
        await process.WaitForExitAsync(linkedCts.Token);

        if (!response.Ok && response.Error is null && !string.IsNullOrWhiteSpace(errorOutput))
        {
            return response with
            {
                Error = new BridgeError("provider_bridge_failure", SanitizeBridgeErrorOutput(errorOutput))
            };
        }

        return response;
    }

    private static async Task WriteMessageAsync<TRequest>(
        Stream stream,
        TRequest request,
        JsonTypeInfo<TRequest> requestJsonType,
        CancellationToken cancellationToken
    )
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(request, requestJsonType);
        if (payload.Length > MaxBridgeRequestBytes)
        {
            throw new InvalidOperationException("Klarkey bridge request was too large.");
        }

        var header = BitConverter.GetBytes(payload.Length);

        await stream.WriteAsync(header, cancellationToken);
        await stream.WriteAsync(payload, cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }

    private static async Task<TResponse> ReadMessageAsync<TResponse>(
        Stream stream,
        JsonTypeInfo<TResponse> responseJsonType,
        CancellationToken cancellationToken
    )
    {
        var header = await ReadExactAsync(stream, sizeof(int), cancellationToken);
        var length = BitConverter.ToInt32(header, 0);
        if (length <= 0)
        {
            throw new InvalidOperationException("Klarkey bridge returned an empty response.");
        }
        if (length > MaxBridgeResponseBytes)
        {
            throw new InvalidOperationException("Klarkey bridge returned a response that was too large.");
        }

        var payload = await ReadExactAsync(stream, length, cancellationToken);
        var response = JsonSerializer.Deserialize(payload, responseJsonType);
        return response ?? throw new InvalidOperationException("Klarkey bridge returned malformed JSON.");
    }

    private static JsonTypeInfo<TValue> BridgeTypeInfo<TValue>() =>
        (JsonTypeInfo<TValue>?)BridgeJsonContext.Default.GetTypeInfo(typeof(TValue))
        ?? throw new InvalidOperationException("Klarkey bridge JSON type is not registered.");

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

    private static async Task<string> ReadBoundedErrorOutputAsync(
        StreamReader reader,
        CancellationToken cancellationToken
    )
    {
        var buffer = new char[1024];
        var builder = new StringBuilder();

        while (builder.Length < MaxBridgeErrorBytes)
        {
            var remaining = MaxBridgeErrorBytes - builder.Length;
            var read = await reader.ReadAsync(
                buffer.AsMemory(0, Math.Min(buffer.Length, remaining)),
                cancellationToken
            );

            if (read == 0)
            {
                break;
            }

            builder.Append(buffer, 0, read);
        }

        return builder.ToString();
    }

    private static string SanitizeBridgeErrorOutput(string errorOutput)
    {
        var message = errorOutput.Trim();
        if (
            message.Length == 0 ||
            message.Length > 200 ||
            SensitiveErrorPattern.IsMatch(message) ||
            UrlErrorPattern.IsMatch(message)
        )
        {
            return GenericBridgeFailureMessage;
        }

        return message;
    }

    private static string CreateRequestId() =>
        $"req_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds():x}_{Guid.NewGuid():N}"[..28];
}
