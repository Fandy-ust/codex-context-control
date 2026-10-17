using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Threading.Tasks;

// A Windows executable entry point: no shell, no console window, byte-exact stdio.
internal static class Launcher {
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
      bool hook = args.Length > 0 && args[0] == "--hook";
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
        var input = Console.OpenStandardInput().CopyToAsync(child.StandardInput.BaseStream).ContinueWith(t => {try {child.StandardInput.Close();}catch {}});
        var output = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
        var errors = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
        child.WaitForExit(); Task.WaitAll(output,errors); return child.ExitCode;
      }
    } catch (Exception e) {try{Console.Error.WriteLine("Context Manager: " + e.Message);}catch{}return 1;}
  }
}
