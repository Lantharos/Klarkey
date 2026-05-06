using System.Text.Json.Serialization;

namespace Klarkey.PasskeyProviderBridge;

public sealed record BridgeError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message
);

public sealed record PingResult(
    [property: JsonPropertyName("ready")] bool Ready,
    [property: JsonPropertyName("bridge")] string Bridge
);

public sealed record FindCredentialsResult(
    [property: JsonPropertyName("requestDetailsJson")] string RequestDetailsJson,
    [property: JsonPropertyName("selectedCredentialIds")] IReadOnlyList<string> SelectedCredentialIds
);

public sealed record ActionExecutionResult(
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("secret")] string? Secret,
    [property: JsonPropertyName("copied")] bool? Copied,
    [property: JsonPropertyName("itemId")] string? ItemId
);

public sealed record BridgeEnvelope<TSuccess>(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("result")] TSuccess? Result,
    [property: JsonPropertyName("error")] BridgeError? Error
);

public sealed record PingRequest(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("type")] string Type = "ping"
);

public sealed record FindCredentialsRequest(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("requestDetailsJson")] string RequestDetailsJson,
    [property: JsonPropertyName("type")] string Type = "find-credentials"
);

public sealed record StoreCredentialRequest(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("url")] string Url,
    [property: JsonPropertyName("requestDetailsJson")] string RequestDetailsJson,
    [property: JsonPropertyName("responseJson")] string ResponseJson,
    [property: JsonPropertyName("type")] string Type = "store-credential"
);

public sealed record TouchCredentialRequest(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("credentialId")] string CredentialId,
    [property: JsonPropertyName("type")] string Type = "touch-credential"
);
