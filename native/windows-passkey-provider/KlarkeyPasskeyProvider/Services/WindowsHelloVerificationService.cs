using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using WinRT.Interop;
using Windows.Security.Credentials.UI;

namespace KlarkeyPasskeyProvider.Services;

internal sealed class WindowsHelloVerificationService
{
    private const int HideWindowCommand = 0;

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr windowHandle, int command);

    internal async Task<WindowsHelloVerificationResult> CheckAvailabilityAsync()
    {
        var availability = await UserConsentVerifier.CheckAvailabilityAsync();
        return availability switch
        {
            UserConsentVerifierAvailability.Available => new WindowsHelloVerificationResult("available", "Windows Hello is ready."),
            UserConsentVerifierAvailability.DeviceBusy => new WindowsHelloVerificationResult("unavailable", "Windows Hello is busy right now."),
            UserConsentVerifierAvailability.DeviceNotPresent => new WindowsHelloVerificationResult("unavailable", "This device does not have Windows Hello set up."),
            UserConsentVerifierAvailability.DisabledByPolicy => new WindowsHelloVerificationResult("unavailable", "Windows Hello is disabled by policy."),
            UserConsentVerifierAvailability.NotConfiguredForUser => new WindowsHelloVerificationResult("unavailable", "Windows Hello is not configured for this Windows account."),
            _ => new WindowsHelloVerificationResult("unavailable", "Windows Hello is unavailable on this device."),
        };
    }

    internal async Task<WindowsHelloVerificationResult> VerifyAsync(Window ownerWindow, string? message)
    {
        var availability = await CheckAvailabilityAsync();
        if (availability.Status != "available")
        {
            return availability;
        }

        var windowHandle = WindowNative.GetWindowHandle(ownerWindow);
        if (windowHandle != IntPtr.Zero)
        {
            ShowWindow(windowHandle, HideWindowCommand);
        }

        var verificationResult = await UserConsentVerifierInterop.RequestVerificationForWindowAsync(
            windowHandle,
            string.IsNullOrWhiteSpace(message) ? "Verify with Windows Hello for Klarkey." : message.Trim()
        );

        return verificationResult switch
        {
            UserConsentVerificationResult.Verified => new WindowsHelloVerificationResult("verified", "Windows Hello verification completed."),
            UserConsentVerificationResult.Canceled => new WindowsHelloVerificationResult("canceled", "Windows Hello verification was canceled."),
            UserConsentVerificationResult.RetriesExhausted => new WindowsHelloVerificationResult("canceled", "Windows Hello verification ran out of retries."),
            UserConsentVerificationResult.DeviceBusy => new WindowsHelloVerificationResult("failed", "Windows Hello is busy right now."),
            UserConsentVerificationResult.DeviceNotPresent => new WindowsHelloVerificationResult("failed", "This device does not have Windows Hello set up."),
            UserConsentVerificationResult.DisabledByPolicy => new WindowsHelloVerificationResult("failed", "Windows Hello is disabled by policy."),
            UserConsentVerificationResult.NotConfiguredForUser => new WindowsHelloVerificationResult("failed", "Windows Hello is not configured for this Windows account."),
            _ => new WindowsHelloVerificationResult("failed", "Windows Hello verification failed."),
        };
    }
}
