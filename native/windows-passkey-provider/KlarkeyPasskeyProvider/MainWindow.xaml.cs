using Microsoft.UI.Xaml;
using KlarkeyPasskeyProvider.ViewModels;

namespace KlarkeyPasskeyProvider;

public sealed partial class MainWindow : Window
{
    internal MainViewModel ViewModel { get; } = new();

    public MainWindow()
    {
        InitializeComponent();

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        Title = AppResources.GetString("WindowTitle");

        AppWindow.SetIcon("Assets/AppIcon.ico");
    }
}
