using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Forms;
using Windows.Security.Credentials.UI;

internal enum LaunchMode
{
    CheckAvailability,
    VerifyUser,
}

internal sealed record LaunchOptions(LaunchMode Mode, string ResponseFilePath, string? Message)
{
    internal static LaunchOptions Parse(IReadOnlyList<string> arguments)
    {
        string? mode = null;
        string? responseFilePath = null;
        string? message = null;

        for (var index = 0; index < arguments.Count; index++)
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

        if (string.IsNullOrWhiteSpace(responseFilePath))
        {
            throw new InvalidOperationException("A response file path is required.");
        }

        return new LaunchOptions(
            string.Equals(mode, "verify-user", StringComparison.OrdinalIgnoreCase) ? LaunchMode.VerifyUser : LaunchMode.CheckAvailability,
            responseFilePath,
            message
        );
    }
}

internal sealed record VerificationResult(string Status, string Message);

internal sealed class WindowsHelloVerifier
{
    internal async Task<VerificationResult> CheckAvailabilityAsync()
    {
        var availability = await UserConsentVerifier.CheckAvailabilityAsync();
        return availability switch
        {
            UserConsentVerifierAvailability.Available => new VerificationResult("available", "Windows Hello is ready."),
            UserConsentVerifierAvailability.DeviceBusy => new VerificationResult("unavailable", "Windows Hello is busy right now."),
            UserConsentVerifierAvailability.DeviceNotPresent => new VerificationResult("unavailable", "This device does not have Windows Hello set up."),
            UserConsentVerifierAvailability.DisabledByPolicy => new VerificationResult("unavailable", "Windows Hello is disabled by policy."),
            UserConsentVerifierAvailability.NotConfiguredForUser => new VerificationResult("unavailable", "Windows Hello is not configured for this Windows account."),
            _ => new VerificationResult("unavailable", "Windows Hello is unavailable on this device."),
        };
    }

    internal async Task<VerificationResult> VerifyAsync(IWin32Window ownerWindow, string? message)
    {
        var availability = await CheckAvailabilityAsync();
        if (availability.Status != "available")
        {
            return availability;
        }

        var verificationResult = await UserConsentVerifierInterop.RequestVerificationForWindowAsync(
            ownerWindow.Handle,
            string.IsNullOrWhiteSpace(message) ? "Verify with Windows Hello for Klarkey." : message.Trim()
        );

        return verificationResult switch
        {
            UserConsentVerificationResult.Verified => new VerificationResult("verified", "Windows Hello verification completed."),
            UserConsentVerificationResult.Canceled => new VerificationResult("canceled", "Windows Hello verification was canceled."),
            UserConsentVerificationResult.RetriesExhausted => new VerificationResult("canceled", "Windows Hello verification ran out of retries."),
            UserConsentVerificationResult.DeviceBusy => new VerificationResult("failed", "Windows Hello is busy right now."),
            UserConsentVerificationResult.DeviceNotPresent => new VerificationResult("failed", "This device does not have Windows Hello set up."),
            UserConsentVerificationResult.DisabledByPolicy => new VerificationResult("failed", "Windows Hello is disabled by policy."),
            UserConsentVerificationResult.NotConfiguredForUser => new VerificationResult("failed", "Windows Hello is not configured for this Windows account."),
            _ => new VerificationResult("failed", "Windows Hello verification failed."),
        };
    }
}

internal static class Program
{
    [STAThread]
    private static async Task<int> Main(string[] args)
    {
        try
        {
            var options = LaunchOptions.Parse(args);
            var verifier = new WindowsHelloVerifier();

            if (options.Mode == LaunchMode.CheckAvailability)
            {
                var availability = await verifier.CheckAvailabilityAsync();
                await File.WriteAllTextAsync(options.ResponseFilePath, JsonSerializer.Serialize(availability));
                return 0;
            }

            ApplicationConfiguration.Initialize();
            var activeScreen = Screen.FromPoint(Cursor.Position).WorkingArea;
            using var ownerWindow = new Form
            {
                ShowInTaskbar = false,
                FormBorderStyle = FormBorderStyle.None,
                StartPosition = FormStartPosition.Manual,
                Left = activeScreen.Left + (activeScreen.Width / 2),
                Top = activeScreen.Top + (activeScreen.Height / 2),
                Width = 1,
                Height = 1,
                Opacity = 0,
            };

            ownerWindow.Load += async (_, _) =>
            {
                VerificationResult result;
                try
                {
                    result = await verifier.VerifyAsync(ownerWindow, options.Message);
                }
                catch (Exception exception)
                {
                    result = new VerificationResult("failed", exception.Message);
                }

                await File.WriteAllTextAsync(options.ResponseFilePath, JsonSerializer.Serialize(result));
                ownerWindow.Close();
            };

            Application.Run(ownerWindow);
            return 0;
        }
        catch (Exception exception)
        {
            var responseFilePath = TryReadResponseFilePath(args);
            if (!string.IsNullOrWhiteSpace(responseFilePath))
            {
                await File.WriteAllTextAsync(
                    responseFilePath,
                    JsonSerializer.Serialize(new VerificationResult("failed", exception.Message))
                );
            }

            return 1;
        }
    }

    private static string? TryReadResponseFilePath(IReadOnlyList<string> arguments)
    {
        for (var index = 0; index < arguments.Count - 1; index++)
        {
            if (string.Equals(arguments[index], "--response-file", StringComparison.OrdinalIgnoreCase))
            {
                return arguments[index + 1];
            }
        }

        return null;
    }
}
