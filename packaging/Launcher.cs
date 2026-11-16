using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Launcher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string browser = FindBrowser();
            if (browser == null)
                throw new InvalidOperationException("请先安装 Microsoft Edge 或 Google Chrome，再启动游戏。");

            byte[] payload;
            using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("game.zip"))
            using (var buffer = new MemoryStream())
            {
                if (input == null) throw new InvalidDataException("游戏资源缺失。");
                input.CopyTo(buffer);
                payload = buffer.ToArray();
            }
            string version;
            using (var sha = SHA256.Create())
                version = BitConverter.ToString(sha.ComputeHash(payload)).Replace("-", "").Substring(0, 24);
            string home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WildsGameDesktop");
            string content = Path.Combine(home, "versions", version);
            using (var mutex = new System.Threading.Mutex(false, "Local\\WildsGameExtract-" + version))
            {
                try { mutex.WaitOne(); }
                catch (System.Threading.AbandonedMutexException) { }
                try
                {
                    if (!File.Exists(Path.Combine(content, ".complete")))
                    {
                        Directory.CreateDirectory(content);
                        using (var memory = new MemoryStream(payload))
                        using (var archive = new ZipArchive(memory, ZipArchiveMode.Read))
                        {
                            string prefix = Path.GetFullPath(content) + Path.DirectorySeparatorChar;
                            foreach (ZipArchiveEntry entry in archive.Entries)
                            {
                                string target = Path.GetFullPath(Path.Combine(content, entry.FullName));
                                if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                                    throw new InvalidDataException("游戏资源路径无效。");
                                Directory.CreateDirectory(Path.GetDirectoryName(target));
                                using (Stream source = entry.Open())
                                using (Stream output = File.Create(target)) source.CopyTo(output);
                            }
                        }
                        File.WriteAllText(Path.Combine(content, ".complete"), version);
                    }
                }
                finally { mutex.ReleaseMutex(); }
            }

            string url = new Uri(Path.Combine(content, "index.html")).AbsoluteUri;
            string profile = Path.Combine(home, "browser-profile");
            Process.Start(new ProcessStartInfo {
                FileName = browser,
                Arguments = "--app=\"" + url + "\" --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check",
                WorkingDirectory = content,
                UseShellExecute = false
            });
        }
        catch (Exception error)
        {
            MessageBox.Show("游戏启动失败：\n" + error.Message, "荒野方界", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string FindBrowser()
    {
        foreach (string name in new[] { "msedge.exe", "chrome.exe" })
        {
            foreach (RegistryKey hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            using (RegistryKey key = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + name))
            {
                string candidate = key == null ? null : key.GetValue(null) as string;
                if (!String.IsNullOrEmpty(candidate) && File.Exists(candidate.Trim('"')))
                    return candidate.Trim('"');
            }
        }
        foreach (string root in new[] {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
        foreach (string relative in new[] { @"Microsoft\Edge\Application\msedge.exe", @"Google\Chrome\Application\chrome.exe" })
        {
            string candidate = Path.Combine(root, relative);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}
