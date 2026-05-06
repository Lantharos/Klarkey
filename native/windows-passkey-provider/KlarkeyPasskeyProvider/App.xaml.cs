using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using KlarkeyPasskeyProvider.Services;

namespace KlarkeyPasskeyProvider;

public partial class App : Application
{
    private const string GenericVerificationFailureMessage = "Windows Hello verification failed.";

    private Window? _window;
    private readonly WindowsHelloVerificationService _windowsHelloVerificationService = new();

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var launchOptions = VerificationLaunchOptions.Parse(Environment.GetCommandLineArgs());
        if (launchOptions.Mode == VerificationLaunchMode.Invalid)
        {
            Exit();
            return;
        }

        if (launchOptions.Mode != VerificationLaunchMode.Probe)
        {
            RunVerificationLaunch(launchOptions);
            return;
        }

        _window = new MainWindow();
        _window.Activate();
    }

    private void RunVerificationLaunch(VerificationLaunchOptions launchOptions)
    {
        _window = new Window();
        _window.Activate();
        _ = CompleteVerificationLaunchAsync(_window, launchOptions);
    }

    private async Task CompleteVerificationLaunchAsync(Window window, VerificationLaunchOptions launchOptions)
    {
        WindowsHelloVerificationResult result;

        try
        {
            result = launchOptions.Mode == VerificationLaunchMode.CheckAvailability
                ? await _windowsHelloVerificationService.CheckAvailabilityAsync()
                : await _windowsHelloVerificationService.VerifyAsync(window, launchOptions.Message);
        }
        catch
        {
            result = new WindowsHelloVerificationResult("failed", GenericVerificationFailureMessage);
        }

        try
        {
            if (!string.IsNullOrWhiteSpace(launchOptions.ResponseFilePath))
            {
                await File.WriteAllTextAsync(
                    launchOptions.ResponseFilePath,
                    JsonSerializer.Serialize(
                        result,
                        WindowsHelloVerificationJsonContext.Default.WindowsHelloVerificationResult
                    )
                );
            }
        }
        finally
        {
            window.Close();
            Exit();
        }
    }
}
