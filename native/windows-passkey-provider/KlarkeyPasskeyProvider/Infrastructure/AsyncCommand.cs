using System;
using System.Threading.Tasks;
using System.Windows.Input;

namespace KlarkeyPasskeyProvider.Infrastructure;

internal sealed class AsyncCommand : ICommand
{
    private readonly Func<Task> executeAsync;
    private readonly Func<bool> canExecute;

    internal AsyncCommand(Func<Task> executeAsync, Func<bool> canExecute)
    {
        this.executeAsync = executeAsync;
        this.canExecute = canExecute;
    }

    public event EventHandler? CanExecuteChanged;

    public bool CanExecute(object? parameter) => canExecute();

    public async void Execute(object? parameter) => await executeAsync();

    internal void NotifyCanExecuteChanged() => CanExecuteChanged?.Invoke(this, EventArgs.Empty);
}
