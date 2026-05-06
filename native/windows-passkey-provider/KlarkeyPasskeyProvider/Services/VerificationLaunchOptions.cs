using System;
using System.Collections.Generic;
using System.IO;

namespace KlarkeyPasskeyProvider.Services;

internal enum VerificationLaunchMode
{
    Probe,
    CheckAvailability,
    VerifyUser,
    Invalid,
}

internal sealed record VerificationLaunchOptions(
    VerificationLaunchMode Mode,
    string? ResponseFilePath,
    string? Message
)
{
    private const string ResponseDirectoryPrefix = "klarkey-hello-";
    private const string ResponseFileName = "response.json";

    internal static VerificationLaunchOptions Parse(IReadOnlyList<string> arguments)
    {
        string? mode = null;
        string? responseFilePath = null;
        string? message = null;

        for (var index = 1; index < arguments.Count; index++)
        {
            var current = arguments[index];
            if (string.Equals(current, "--mode", StringComparison.OrdinalIgnoreCase) && index + 1 < arguments.Count)
            {
                mode = arguments[++index];
                continue;
            }

            if (string.Equals(current, "--response-file", StringComparison.OrdinalIgnoreCase) && index + 1 < arguments.Count)
            {
                responseFilePath = arguments[++index];
                continue;
            }

            if (string.Equals(current, "--message", StringComparison.OrdinalIgnoreCase) && index + 1 < arguments.Count)
            {
                message = arguments[++index];
            }
        }

        var validatedResponseFilePath = ValidateResponseFilePath(responseFilePath);
        return mode?.ToLowerInvariant() switch
        {
            "check-availability" when validatedResponseFilePath is not null => new VerificationLaunchOptions(VerificationLaunchMode.CheckAvailability, validatedResponseFilePath, message),
            "verify-user" when validatedResponseFilePath is not null => new VerificationLaunchOptions(VerificationLaunchMode.VerifyUser, validatedResponseFilePath, message),
            "check-availability" or "verify-user" => new VerificationLaunchOptions(VerificationLaunchMode.Invalid, null, null),
            _ => new VerificationLaunchOptions(VerificationLaunchMode.Probe, responseFilePath, message),
        };
    }

    internal static string? ValidateResponseFilePath(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        try
        {
            var fullPath = Path.GetFullPath(value);
            var tempRoot = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var tempRootWithSeparator = tempRoot + Path.DirectorySeparatorChar;
            if (!fullPath.StartsWith(tempRootWithSeparator, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            if (!string.Equals(Path.GetFileName(fullPath), ResponseFileName, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var directoryPath = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrWhiteSpace(directoryPath) || !Directory.Exists(directoryPath) || !File.Exists(fullPath))
            {
                return null;
            }

            var parentDirectory = Path.GetDirectoryName(directoryPath);
            if (!string.Equals(Path.GetFullPath(parentDirectory ?? string.Empty).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), tempRoot, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            if (!new DirectoryInfo(directoryPath).Name.StartsWith(ResponseDirectoryPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var fileAttributes = File.GetAttributes(fullPath);
            var directoryAttributes = File.GetAttributes(directoryPath);
            if ((fileAttributes & FileAttributes.ReparsePoint) != 0 || (directoryAttributes & FileAttributes.ReparsePoint) != 0)
            {
                return null;
            }

            return fullPath;
        }
        catch
        {
            return null;
        }
    }
}
