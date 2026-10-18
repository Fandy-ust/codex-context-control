using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Windows.Forms;
using System.Drawing;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Text;
internal static class Installer {
  const string ArchiveResource = "ContextManager.Payload.zip";
  const string HashResource = "ContextManager.Payload.sha256";
  const string TempPrefix = "ContextManager-setup-";

  sealed class Payload : IDisposable {
    public string Directory;
    public string TemporaryRoot;
    public void Dispose() {
      if (TemporaryRoot == null || !System.IO.Directory.Exists(TemporaryRoot)) return;
      var temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
      var full = Path.GetFullPath(TemporaryRoot);
      if (!full.StartsWith(temp + TempPrefix, StringComparison.OrdinalIgnoreCase) ||
          !String.Equals(Path.GetDirectoryName(full), temp.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
        throw new IOException("Refusing to clean a path outside the installer temporary directory.");
      CheckNoLinks(full);
      for (var attempt = 0; ; attempt++) {
        try { System.IO.Directory.Delete(full, true); break; }
        catch (IOException) { if (attempt >= 4) throw; System.Threading.Thread.Sleep(200); }
        catch (UnauthorizedAccessException) { if (attempt >= 4) throw; System.Threading.Thread.Sleep(200); }
      }
    }
  }

  static void CheckNoLinks(string directory) {
    if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
      throw new IOException("Installer temporary files contain a link.");
    foreach (var child in System.IO.Directory.GetFileSystemEntries(directory)) {
      var attributes = File.GetAttributes(child);
      if ((attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Installer temporary files contain a link.");
      if ((attributes & FileAttributes.Directory) != 0) CheckNoLinks(child);
    }
  }

  static Payload PreparePayload() {
    var assembly = Assembly.GetExecutingAssembly();
    using (var archive = assembly.GetManifestResourceStream(ArchiveResource)) {
      if (archive == null) {
        var external = Path.Combine(Path.GetDirectoryName(assembly.Location), "payload");
        if (!File.Exists(Path.Combine(external, "payload-manifest.json")))
          throw new IOException("安装文件不完整，请使用完整的 Setup.exe。 / Installer payload is missing.");
        return new Payload { Directory = external };
      }
      using (var hash = assembly.GetManifestResourceStream(HashResource)) {
        if (hash == null) throw new IOException("Installer checksum is missing.");
        string expected;
        using (var reader = new StreamReader(hash)) expected = reader.ReadToEnd().Trim();
        string actual;
        using (var sha = SHA256.Create()) actual = BitConverter.ToString(sha.ComputeHash(archive)).Replace("-", "").ToLowerInvariant();
        if (expected.Length != 64 || !String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase))
          throw new IOException("安装包校验失败，请重新下载。 / Installer checksum verification failed.");
      }
      archive.Position = 0;
      var temporary = Path.Combine(Path.GetTempPath(), TempPrefix + Guid.NewGuid().ToString("N"));
      var payload = new Payload { TemporaryRoot = temporary, Directory = Path.Combine(temporary, "payload") };
      try {
        System.IO.Directory.CreateDirectory(payload.Directory);
        var prefix = Path.GetFullPath(payload.Directory) + Path.DirectorySeparatorChar;
        using (var zip = new ZipArchive(archive, ZipArchiveMode.Read, true)) {
          foreach (var entry in zip.Entries) {
            var name = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
            var destination = Path.GetFullPath(Path.Combine(payload.Directory, name));
            if (name.IndexOf(':') >= 0 || Path.IsPathRooted(name) ||
                !destination.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
                ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000)
              throw new IOException("Installer archive contains an unsafe path.");
            if (entry.Name.Length == 0) { System.IO.Directory.CreateDirectory(destination); continue; }
            System.IO.Directory.CreateDirectory(Path.GetDirectoryName(destination));
            using (var input = entry.Open())
            using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write)) input.CopyTo(output);
          }
        }
        if (!File.Exists(Path.Combine(payload.Directory, "payload-manifest.json"))) throw new IOException("Installer manifest is missing.");
        return payload;
      } catch { payload.Dispose(); throw; }
    }
  }

  sealed class Result { public int ExitCode; public string Output; }

  static string Quote(string argument) {
    var result = new StringBuilder("\"");
    int slashes = 0;
    foreach (char c in argument) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') result.Append('\\', slashes * 2 + 1).Append(c);
      else result.Append('\\', slashes).Append(c);
      slashes = 0;
    }
    return result.Append('\\', slashes * 2).Append('"').ToString();
  }

  static async Task<Result> Execute(bool remove, string[] options, Action<string> report) {
    report("正在校验并解压安装文件… / Preparing installer…");
    using (var payload = await Task.Run(() => PreparePayload())) {
      var code = Path.Combine(payload.Directory, "resources", "app");
      var arguments = Quote(Path.Combine(code, "scripts", "install-win.mjs")) +
        (remove ? " --uninstall" : " --payload " + Quote(payload.Directory));
      foreach (var option in options) arguments += " " + option;
      var info = new ProcessStartInfo(Path.Combine(code, "vendor", "node.exe")) {
        Arguments = arguments, WorkingDirectory = Path.GetTempPath(), UseShellExecute = false, CreateNoWindow = true,
        RedirectStandardOutput = true, RedirectStandardError = true,
        StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
      };
      report(remove ? "正在卸载… / Uninstalling…" : "正在安装 / 更新… / Installing / updating…");
      using (var process = Process.Start(info)) {
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        await Task.Run(() => process.WaitForExit());
        return new Result { ExitCode = process.ExitCode, Output = (await stdout) + Environment.NewLine + (await stderr) };
      }
    }
  }

  [STAThread] public static int Main(string[] args) {
    if (args.Length > 0) {
      try {
        Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
        Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
        if (args[0] != "--install" && args[0] != "--uninstall") throw new ArgumentException("Use --install or --uninstall.");
        var options = new string[args.Length - 1];
        for (int i = 1; i < args.Length; i++) {
          if (args[i] != "--no-auto-start" && args[i] != "--no-open" && args[i] != "--no-shortcut")
            throw new ArgumentException("Unknown installer option: " + args[i]);
          options[i - 1] = args[i];
        }
        var result = Execute(args[0] == "--uninstall", options, message => Console.WriteLine(message)).GetAwaiter().GetResult();
        Console.WriteLine(result.Output);
        return result.ExitCode;
      } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
    Application.EnableVisualStyles();
    var form=new Form{Text="Context Manager",Width=620,Height=390,StartPosition=FormStartPosition.CenterScreen,BackColor=Color.FromArgb(24,24,24),ForeColor=Color.White};
    form.Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    var title=new Label{Text="Context Manager · Windows",Left=24,Top=24,Width=550,Height=35,Font=new Font("Segoe UI",18)};
    var note=new Label{Text="Codex integration is enabled after its startup check.\n默认接入 Codex；启动检查失败则保留原入口。保留预算和偏好。",Left=24,Top=70,Width=550,Height=50};
    var install=new Button{Text="安装 / 更新 · Install / Update",Left=24,Top=130,Width=270,Height=38};
    var uninstall=new Button{Text="卸载 · Uninstall",Left=310,Top=130,Width=260,Height=38};
    var output=new TextBox{Left=24,Top=185,Width=546,Height=145,Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,BackColor=Color.FromArgb(40,40,40),ForeColor=Color.White};
    bool busy=false;
    form.FormClosing+=(sender,e)=>{if(busy)e.Cancel=true;};
    Action<bool> run=async remove=>{
      busy=true;
      install.Enabled=uninstall.Enabled=false;
      try{
        var result=await Execute(remove,new string[0],message=>output.Text=message);
        output.Text=result.Output;
        output.AppendText(Environment.NewLine+(result.ExitCode==0?"完成 / Complete":"失败 / Failed ("+result.ExitCode+")"));
      }catch(Exception e){output.Text=e.Message;}finally{busy=false;install.Enabled=uninstall.Enabled=true;}
    };
    install.Click+=(s,e)=>run(false);uninstall.Click+=(s,e)=>run(true);
    form.Controls.AddRange(new Control[]{title,note,install,uninstall,output});Application.Run(form);
    return 0;
  }
}
