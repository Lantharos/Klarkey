using System.Buffers.Binary;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

string[] ChromiumExtensionOrigins = ["chrome-extension://gbdmdcmboinmeckelhacpljieaphedgn/"];
const string FirefoxExtensionId = "klarkey@example.local";

var executablePath = Path.Combine(AppContext.BaseDirectory, "..", "..", "node_modules", "electron", "dist", "electron.exe");
var rootPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", ".."));

if (!File.Exists(executablePath) || !args.Any(IsAllowedNativeMessagingCaller) || !NativeMessagingParent.IsAllowed())
{
    return 1;
}

var startInfo = new ProcessStartInfo
{
    FileName = executablePath,
    WorkingDirectory = rootPath,
    UseShellExecute = false,
    RedirectStandardInput = true,
    RedirectStandardOutput = true,
    RedirectStandardError = true,
    CreateNoWindow = true,
};

startInfo.ArgumentList.Add(rootPath);
startInfo.ArgumentList.Add("--native-messaging-host");
foreach (var arg in args)
{
    startInfo.ArgumentList.Add(arg);
}

using var process = new Process
{
    StartInfo = startInfo,
    EnableRaisingEvents = true,
};

process.Start();

var stdin = Console.OpenStandardInput();
var stdout = Console.OpenStandardOutput();
var stderr = Console.OpenStandardError();
using var stdinCopyCancellation = new CancellationTokenSource();

var copyInput = RelayInputAsync(stdin, process.StandardInput.BaseStream, stdinCopyCancellation.Token)
    .ContinueWith(async task =>
    {
        try
        {
            await task;
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            try
            {
                process.StandardInput.Close();
            }
            catch (ObjectDisposedException)
            {
            }
        }
    }).Unwrap();

var copyOutput = RelayOutputAsync(process.StandardOutput.BaseStream, stdout);
var copyError = RelayErrorAsync(process.StandardError.BaseStream, stderr);

await Task.WhenAll(copyOutput, copyError, process.WaitForExitAsync());
stdinCopyCancellation.Cancel();
try
{
    await copyInput;
}
catch (OperationCanceledException)
{
}

return process.ExitCode;

bool IsAllowedNativeMessagingCaller(string value) =>
    ChromiumExtensionOrigins.Contains(NormalizeNativeMessagingCaller(value), StringComparer.Ordinal) ||
    value == FirefoxExtensionId;

string NormalizeNativeMessagingCaller(string value) =>
    value.StartsWith("chrome-extension://", StringComparison.Ordinal) && !value.EndsWith("/", StringComparison.Ordinal)
        ? value + "/"
        : value;

static async Task RelayInputAsync(Stream source, Stream destination, CancellationToken cancellationToken)
{
    const uint MaxNativeHostRequestBytes = 10 * 1024 * 1024;
    var header = new byte[4];
    var buffer = new byte[4096];

    while (await ReadHeaderAsync(source, header, cancellationToken))
    {
        var messageLength = BinaryPrimitives.ReadUInt32LittleEndian(header);
        if (messageLength == 0 || messageLength > MaxNativeHostRequestBytes)
        {
            return;
        }

        await destination.WriteAsync(header, cancellationToken);

        var remaining = messageLength;
        while (remaining > 0)
        {
            var readLength = (int)Math.Min((uint)buffer.Length, remaining);
            var bytesRead = await source.ReadAsync(buffer.AsMemory(0, readLength), cancellationToken);
            if (bytesRead == 0)
            {
                return;
            }

            await destination.WriteAsync(buffer.AsMemory(0, bytesRead), cancellationToken);
            remaining -= (uint)bytesRead;
        }

        await destination.FlushAsync(cancellationToken);
    }
}

static async Task<bool> ReadHeaderAsync(Stream source, byte[] header, CancellationToken cancellationToken)
{
    var offset = 0;
    while (offset < header.Length)
    {
        var bytesRead = await source.ReadAsync(header.AsMemory(offset), cancellationToken);
        if (bytesRead == 0)
        {
            return false;
        }

        offset += bytesRead;
    }

    return true;
}

static async Task RelayOutputAsync(Stream source, Stream destination)
{
    var buffer = new byte[4096];
    var prefix = new byte[2];
    var prefixLength = 0;
    var prefixChecked = false;

    while (true)
    {
        var bytesRead = await source.ReadAsync(buffer);
        if (bytesRead == 0)
        {
            if (!prefixChecked && prefixLength > 0)
            {
                await destination.WriteAsync(prefix.AsMemory(0, prefixLength));
            }
            return;
        }

        var offset = 0;
        if (!prefixChecked)
        {
            while (offset < bytesRead && prefixLength < prefix.Length)
            {
                prefix[prefixLength] = buffer[offset];
                prefixLength++;
                offset++;
            }

            if (prefixLength < prefix.Length)
            {
                continue;
            }

            prefixChecked = true;
            if (prefix[0] != '\r' || prefix[1] != '\n')
            {
                await destination.WriteAsync(prefix);
            }
        }

        if (offset < bytesRead)
        {
            await destination.WriteAsync(buffer.AsMemory(offset, bytesRead - offset));
        }
    }
}

static async Task RelayErrorAsync(Stream source, Stream destination)
{
    var payload = await NativeHostErrorRelay.ReadBoundedErrorAsync(source);
    var message = NativeHostErrorRelay.Sanitize(payload);
    if (string.IsNullOrWhiteSpace(message))
    {
        return;
    }

    var encoded = Encoding.UTF8.GetBytes(message + Environment.NewLine);
    await destination.WriteAsync(encoded);
}

static class NativeHostErrorRelay
{
    const int MaxNativeHostErrorBytes = 16 * 1024;
    const string GenericNativeHostFailureMessage = "Klarkey native host failed.";
    static readonly string[] SensitiveTerms =
    [
        "access_token",
        "app_key",
        "authorization",
        "bearer",
        "ciphertext",
        "client_secret",
        "cookie",
        "credential",
        "id_token",
        "passcode",
        "password",
        "passkey",
        "private",
        "recovery",
        "refresh_token",
        "secret",
        "token",
        "vault",
    ];

    public static async Task<string> ReadBoundedErrorAsync(Stream source)
    {
        var buffer = new byte[4096];
        using var retained = new MemoryStream(MaxNativeHostErrorBytes);

        while (true)
        {
            var bytesRead = await source.ReadAsync(buffer);
            if (bytesRead == 0)
            {
                break;
            }

            var remaining = MaxNativeHostErrorBytes - (int)retained.Length;
            if (remaining > 0)
            {
                retained.Write(buffer, 0, Math.Min(bytesRead, remaining));
            }
        }

        return Encoding.UTF8.GetString(retained.ToArray());
    }

    public static string Sanitize(string value)
    {
        var message = value.Trim();
        if (message.Length == 0)
        {
            return string.Empty;
        }

        if (message.Length > 240 || ContainsSensitiveText(message) || ContainsPathOrUrl(message))
        {
            return GenericNativeHostFailureMessage;
        }

        return message;
    }

    static bool ContainsSensitiveText(string message)
    {
        var normalized = message.ToLowerInvariant();
        return SensitiveTerms.Any(normalized.Contains);
    }

    static bool ContainsPathOrUrl(string message)
    {
        var normalized = message.ToLowerInvariant();
        return normalized.Contains("://") ||
            normalized.Contains(":\\") ||
            normalized.Contains("\\\\") ||
            normalized.Contains("users\\") ||
            normalized.Contains("/users/");
    }
}

static class NativeMessagingParent
{
    const uint ProcessQueryLimitedInformation = 0x1000;
    const uint SnapshotProcesses = 0x00000002;
    const int MaxProcessPathLength = 4096;
    static readonly IntPtr InvalidHandle = new(-1);
    static readonly Dictionary<string, string[]> AllowedParentPathSuffixes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["chrome.exe"] = ["Google\\Chrome\\Application\\chrome.exe", "imput\\Helium\\Application\\chrome.exe"],
        ["msedge.exe"] = ["Microsoft\\Edge\\Application\\msedge.exe"],
        ["brave.exe"] = ["BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
        ["firefox.exe"] = ["Mozilla Firefox\\firefox.exe"],
        ["chromium.exe"] = ["Chromium\\Application\\chromium.exe"],
        ["zen.exe"] = ["Zen Browser\\zen.exe"],
    };

    public static bool IsAllowed()
    {
        if (!OperatingSystem.IsWindows())
        {
            return true;
        }

        var parentProcessId = TryGetParentProcessId(Environment.ProcessId);
        if (!parentProcessId.HasValue)
        {
            return false;
        }

        var parentPath = TryGetProcessPath(parentProcessId.Value);
        if (IsAllowedParentPath(parentPath))
        {
            return true;
        }

        if (!IsTrustedCommandShellPath(parentPath))
        {
            return false;
        }

        var browserProcessId = TryGetParentProcessId(parentProcessId.Value);
        return browserProcessId.HasValue && IsAllowedParentPath(TryGetProcessPath(browserProcessId.Value));
    }

    public static bool IsAllowedParentPath(string? processPath)
    {
        if (string.IsNullOrWhiteSpace(processPath))
        {
            return false;
        }

        var parentName = Path.GetFileName(processPath);
        if (string.IsNullOrWhiteSpace(parentName) || !AllowedParentPathSuffixes.TryGetValue(parentName, out var suffixes))
        {
            return false;
        }

        return TrustedBrowserRoots().Any(root =>
            suffixes.Any(suffix => PathsEqual(processPath, Path.Combine(root, suffix))));
    }

    static IEnumerable<string> TrustedBrowserRoots()
    {
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        };

        return roots.Where(root => !string.IsNullOrWhiteSpace(root));
    }

    static bool IsTrustedCommandShellPath(string? processPath)
    {
        if (string.IsNullOrWhiteSpace(processPath) ||
            !string.Equals(Path.GetFileName(processPath), "cmd.exe", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return TrustedCommandShellPaths().Any(path => PathsEqual(processPath, path));
    }

    static IEnumerable<string> TrustedCommandShellPaths()
    {
        var windowsDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var systemDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System);

        var paths = new[]
        {
            !string.IsNullOrWhiteSpace(systemDirectory) ? Path.Combine(systemDirectory, "cmd.exe") : null,
            !string.IsNullOrWhiteSpace(windowsDirectory) ? Path.Combine(windowsDirectory, "System32", "cmd.exe") : null,
            !string.IsNullOrWhiteSpace(windowsDirectory) ? Path.Combine(windowsDirectory, "SysWOW64", "cmd.exe") : null,
        };

        return paths.Where(path => !string.IsNullOrWhiteSpace(path)).Cast<string>();
    }

    static bool PathsEqual(string left, string right)
    {
        try
        {
            var normalizedLeft = Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var normalizedRight = Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return string.Equals(normalizedLeft, normalizedRight, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    static string? TryGetProcessPath(int processId)
    {
        var processHandle = OpenProcess(ProcessQueryLimitedInformation, false, (uint)processId);
        if (processHandle == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            var path = new StringBuilder(MaxProcessPathLength);
            var pathLength = (uint)path.Capacity;
            return QueryFullProcessImageName(processHandle, 0, path, ref pathLength)
                ? path.ToString()
                : null;
        }
        finally
        {
            CloseHandle(processHandle);
        }
    }

    static int? TryGetParentProcessId(int processId)
    {
        var snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
        if (snapshot == IntPtr.Zero || snapshot == InvalidHandle)
        {
            return null;
        }

        try
        {
            var entry = new ProcessEntry
            {
                Size = (uint)Marshal.SizeOf<ProcessEntry>(),
            };

            if (!Process32First(snapshot, ref entry))
            {
                return null;
            }

            do
            {
                if (entry.ProcessId == processId)
                {
                    return (int)entry.ParentProcessId;
                }
            } while (Process32Next(snapshot, ref entry));

            return null;
        }
        finally
        {
            CloseHandle(snapshot);
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "QueryFullProcessImageNameW")]
    static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder exeName, ref uint size);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "Process32FirstW")]
    static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode, EntryPoint = "Process32NextW")]
    static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry
    {
        public uint Size;
        public uint Usage;
        public uint ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId;
        public uint Threads;
        public uint ParentProcessId;
        public int PriorityClassBase;
        public uint Flags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string ExeFile;
    }
}
