using System.Text.Json;
using System.Text.Json.Serialization;

namespace Klarkey.PasskeyProviderBridge;

[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, PropertyNameCaseInsensitive = true)]
[JsonSerializable(typeof(PingRequest))]
[JsonSerializable(typeof(FindCredentialsRequest))]
[JsonSerializable(typeof(StoreCredentialRequest))]
[JsonSerializable(typeof(TouchCredentialRequest))]
[JsonSerializable(typeof(BridgeEnvelope<PingResult>))]
[JsonSerializable(typeof(BridgeEnvelope<FindCredentialsResult>))]
[JsonSerializable(typeof(BridgeEnvelope<ActionExecutionResult>))]
internal sealed partial class BridgeJsonContext : JsonSerializerContext;
