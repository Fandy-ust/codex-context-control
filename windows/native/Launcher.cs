using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Threading.Tasks;

// A Windows executable entry point: no shell, no console window, byte-exact stdio.
internal static class Launcher {
  static string logFile;
  static void Log(string stage, object details) {
    try {
      if (String.IsNullOrEmpty(logFile)) return;
      Directory.CreateDirectory(Path.GetDirectoryName(logFile));
      if (File.Exists(logFile) && new FileInfo(logFile).Length > 1024 * 1024) {
        if (File.Exists(logFile + ".1")) File.Delete(logFile + ".1");
        File.Move(logFile, logFile + ".1");
      }
      var record = new { at = DateTime.UtcNow.ToString("o"), pid = Process.GetCurrentProcess().Id, stage = stage, details = details };
      File.AppendAllText(logFile, new JavaScriptSerializer().Serialize(record) + "\n", new UTF8Encoding(false));
    } catch { /* Diagnostic logging never blocks the stdio protocol. */ }
  }
  static async Task Pump(Stream source, Stream destination, string channel, bool closeDestination) {
    var buffer = new byte[16384]; long total = 0;
    try {
      int count;
      while ((count = await source.ReadAsync(buffer, 0, buffer.Length)) > 0) {
        await destination.WriteAsync(buffer, 0, count);
        // Process.StandardInput.BaseStream is buffered. A short initialize
        // request must be forwarded now, rather than waiting for EOF or 4K.
        await destination.FlushAsync();
        if (total == 0) Log("stdio.first_flush", new { channel = channel, bytes = count });
        total += count;
      }
      Log("stdio.eof", new { channel = channel, bytes = total });
    } catch (Exception error) { Log("stdio.error", new { channel = channel, bytes = total, type = error.GetType().Name, message = error.Message }); }
    finally { if (closeDestination) try { destination.Close(); } catch { } }
  }
  internal static string Quote(string value) {
    var b = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { b.Append('\\', slashes * 2 + 1); b.Append(c); slashes = 0; continue; }
      b.Append('\\', slashes); slashes = 0; b.Append(c);
    }
    b.Append('\\', slashes * 2); b.Append('"'); return b.ToString();
  }
  public static int Main(string[] args) {
    try {
      var baseDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
      var config = new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(baseDir,"launcher.json")));
      logFile = Environment.GetEnvironmentVariable("CONTEXT_CONTROL_DIAGNOSTIC_LOG");
      if (String.IsNullOrEmpty(logFile)) logFile = Path.Combine(config["controlHome"], "logs", "launcher.jsonl");
      bool hook = args.Length > 0 && args[0] == "--hook";
      Log("launcher.start", new { mode = hook ? "hook" : "cli", argumentCount = args.Length, node = config["node"], codeRoot = config["codeRoot"] });
      var start = new ProcessStartInfo(config["node"]);
      start.UseShellExecute = false; start.CreateNoWindow = true;
      start.RedirectStandardInput = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
      start.WorkingDirectory = Environment.CurrentDirectory;
      if (String.IsNullOrEmpty(Environment.GetEnvironmentVariable("CONTEXT_CONTROL_HOME"))) start.EnvironmentVariables["CONTEXT_CONTROL_HOME"] = config["controlHome"];
      start.EnvironmentVariables["CONTEXT_CONTROL_NODE"] = config["node"];
      start.Arguments = Quote(Path.Combine(config["codeRoot"],"src",hook?"cli.mjs":"wrapper.mjs"));
      if (hook) start.Arguments += " hook";
      for (int i=hook?1:0;i<args.Length;i++) start.Arguments += " " + Quote(args[i]);
      using (var child = Process.Start(start)) {
        Log("launcher.child_started", new { childPid = child.Id });
        var input = Pump(Console.OpenStandardInput(), child.StandardInput.BaseStream, "stdin", true);
        var output = Pump(child.StandardOutput.BaseStream, Console.OpenStandardOutput(), "stdout", false);
        var errors = Pump(child.StandardError.BaseStream, Console.OpenStandardError(), "stderr", false);
        child.WaitForExit(); Task.WaitAll(output,errors);
        Log("launcher.child_exit", new { exitCode = child.ExitCode }); return child.ExitCode;
      }
    } catch (Exception e) {Log("launcher.error", new { type = e.GetType().Name, message = e.Message });try{Console.Error.WriteLine("Context Manager: " + e.Message);}catch{}return 1;}
  }
}
