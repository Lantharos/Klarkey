using System;
using System.Globalization;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Klarkey.PasskeyProviderBridge;

namespace KlarkeyPasskeyProvider.Services;

internal sealed class KlarkeyBridgeProbeService
{
    internal (string ExecutablePath, string AppPath) CreateDefaults()
    {
        var repoRoot = FindRepositoryRoot();
        if (repoRoot is null)
        {
            return (string.Empty, string.Empty);
        }

        return (
            Path.Combine(repoRoot, "node_modules", ".bin", "electron.cmd"),
            repoRoot
        );
    }

    internal async Task<BridgeProbeResult> PingAsync(string executablePath, string appPath, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(executablePath))
        {
            return CreateError("BridgeExecutableRequired");
        }

        if (!File.Exists(executablePath))
        {
            return CreateError("BridgeExecutableMissing", executablePath);
        }

        if (string.IsNullOrWhiteSpace(appPath))
        {
            return CreateError("BridgeAppPathRequired");
        }

        if (!Directory.Exists(appPath))
        {
            return CreateError("BridgeAppPathMissing", appPath);
        }

        await using var client = new KlarkeyBridgeClient(new KlarkeyBridgeClientOptions
        {
            ExecutablePath = executablePath,
            WorkingDirectory = appPath,
            Arguments = [appPath]
        });

        try
        {
            var response = await client.PingAsync(cancellationToken);
            if (!response.Ok || response.Result is null)
            {
                return CreateError(
                    "BridgePingFailed",
                    response.Error?.Message ?? AppResources.GetString("BridgeUnknownError")
                );
            }

            var detail = string.Format(
                CultureInfo.CurrentCulture,
                AppResources.GetString("BridgePingDetailFormat"),
                response.Result.Bridge
            );

            return new BridgeProbeResult(
                AppResources.GetString("BridgePingSuccessTitle"),
                AppResources.GetString("BridgePingSuccessMessage"),
                detail,
                true
            );
        }
        catch (Exception exception)
        {
            return CreateError("BridgePingException", exception.Message);
        }
    }

    private static string? FindRepositoryRoot()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory); current is not null; current = current.Parent)
        {
            var packageJson = Path.Combine(current.FullName, "package.json");
            var bunLock = Path.Combine(current.FullName, "bun.lock");
            if (File.Exists(packageJson) && File.Exists(bunLock))
            {
                return current.FullName;
            }
        }

        return null;
    }

    private static BridgeProbeResult CreateError(string titleKey, params object[] formatArgs)
    {
        var title = AppResources.GetString(titleKey);
        var message = formatArgs.Length == 0
            ? AppResources.GetString($"{titleKey}Message")
            : string.Format(CultureInfo.CurrentCulture, AppResources.GetString($"{titleKey}Message"), formatArgs);

        return new BridgeProbeResult(title, message, string.Empty, false);
    }
}
