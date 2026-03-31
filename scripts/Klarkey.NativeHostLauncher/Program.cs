using System.Diagnostics;
using System.Threading;

var executablePath = Path.Combine(AppContext.BaseDirectory, "..", "..", "node_modules", "electron", "dist", "electron.exe");
var rootPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", ".."));

if (!File.Exists(executablePath))
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

var copyInput = stdin.CopyToAsync(process.StandardInput.BaseStream, stdinCopyCancellation.Token)
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
var copyError = process.StandardError.BaseStream.CopyToAsync(stderr);

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

static async Task RelayOutputAsync(Stream source, Stream destination)
{
    var buffer = new byte[4096];
    var isFirstChunk = true;

    while (true)
    {
        var bytesRead = await source.ReadAsync(buffer);
        if (bytesRead == 0)
        {
            return;
        }

        var offset = 0;
        if (isFirstChunk)
        {
            isFirstChunk = false;

            if (bytesRead >= 2 && buffer[0] == '\r' && buffer[1] == '\n')
            {
                offset = 2;
            }
        }

        if (offset < bytesRead)
        {
            await destination.WriteAsync(buffer.AsMemory(offset, bytesRead - offset));
        }
    }
}
