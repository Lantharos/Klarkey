using System.Text.Json.Serialization;

namespace KlarkeyPasskeyProvider.Services;

[JsonSerializable(typeof(WindowsHelloVerificationResult))]
internal sealed partial class WindowsHelloVerificationJsonContext : JsonSerializerContext;
