using Microsoft.Windows.ApplicationModel.Resources;

namespace KlarkeyPasskeyProvider;

internal static class AppResources
{
    private static readonly ResourceLoader ResourceLoader = new();

    internal static string GetString(string key)
    {
        var value = ResourceLoader.GetString(key);
        return string.IsNullOrWhiteSpace(value) ? key : value;
    }
}
