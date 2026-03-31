using System.Diagnostics;

namespace Klarkey.PasskeyProviderBridge;

public sealed class KlarkeyBridgeClientOptions
{
    public required string ExecutablePath { get; init; }

    public string[] Arguments { get; init; } = [];

    public string? WorkingDirectory { get; init; }

    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(15);

    internal ProcessStartInfo CreateStartInfo()
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = ExecutablePath,
            WorkingDirectory = WorkingDirectory ?? Path.GetDirectoryName(ExecutablePath) ?? Environment.CurrentDirectory,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        foreach (var argument in Arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        startInfo.ArgumentList.Add("--passkey-provider-bridge");
        return startInfo;
    }
}
