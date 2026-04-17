using System;
using System.Collections.Generic;

namespace KlarkeyPasskeyProvider.Services;

internal enum VerificationLaunchMode
{
    Probe,
    CheckAvailability,
    VerifyUser,
}

internal sealed record VerificationLaunchOptions(
    VerificationLaunchMode Mode,
    string? ResponseFilePath,
    string? Message
)
{
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

        return mode?.ToLowerInvariant() switch
        {
            "check-availability" => new VerificationLaunchOptions(VerificationLaunchMode.CheckAvailability, responseFilePath, message),
            "verify-user" => new VerificationLaunchOptions(VerificationLaunchMode.VerifyUser, responseFilePath, message),
            _ => new VerificationLaunchOptions(VerificationLaunchMode.Probe, responseFilePath, message),
        };
    }
}
