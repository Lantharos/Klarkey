using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using KlarkeyPasskeyProvider.Infrastructure;
using KlarkeyPasskeyProvider.Services;

namespace KlarkeyPasskeyProvider.ViewModels;

internal sealed class MainViewModel : INotifyPropertyChanged
{
    private readonly KlarkeyBridgeProbeService bridgeProbeService = new();
    private readonly AsyncCommand pingBridgeCommand;
    private string executablePath;
    private string appPath;
    private string statusTitle;
    private string statusMessage;
    private string bridgeDetail;
    private bool isBusy;

    internal MainViewModel()
    {
        var defaults = bridgeProbeService.CreateDefaults();
        executablePath = defaults.ExecutablePath;
        appPath = defaults.AppPath;
        statusTitle = AppResources.GetString("InitialStatusTitle");
        statusMessage = AppResources.GetString("InitialStatusMessage");
        bridgeDetail = AppResources.GetString("InitialStatusDetail");
        pingBridgeCommand = new AsyncCommand(PingBridgeAsync, () => !IsBusy);
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public ICommand PingBridgeCommand => pingBridgeCommand;

    public string ExecutablePath
    {
        get => executablePath;
        set => SetProperty(ref executablePath, value);
    }

    public string AppPath
    {
        get => appPath;
        set => SetProperty(ref appPath, value);
    }

    public string StatusTitle
    {
        get => statusTitle;
        private set => SetProperty(ref statusTitle, value);
    }

    public string StatusMessage
    {
        get => statusMessage;
        private set => SetProperty(ref statusMessage, value);
    }

    public string BridgeDetail
    {
        get => bridgeDetail;
        private set => SetProperty(ref bridgeDetail, value);
    }

    public bool IsBusy
    {
        get => isBusy;
        private set
        {
            if (SetProperty(ref isBusy, value))
            {
                pingBridgeCommand.NotifyCanExecuteChanged();
            }
        }
    }

    private async Task PingBridgeAsync()
    {
        IsBusy = true;
        try
        {
            var result = await bridgeProbeService.PingAsync(ExecutablePath, AppPath, CancellationToken.None);
            StatusTitle = result.Title;
            StatusMessage = result.Message;
            BridgeDetail = result.Detail;
        }
        finally
        {
            IsBusy = false;
        }
    }

    private bool SetProperty<T>(ref T storage, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(storage, value))
        {
            return false;
        }

        storage = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        return true;
    }
}
