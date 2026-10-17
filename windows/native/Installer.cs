using System;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;
using System.Drawing;
using System.Text;
internal static class Installer {
  [STAThread] public static void Main() {
    Application.EnableVisualStyles();
    var form=new Form{Text="Context Manager",Width=620,Height=390,StartPosition=FormStartPosition.CenterScreen,BackColor=Color.FromArgb(24,24,24),ForeColor=Color.White};
    form.Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    var title=new Label{Text="Context Manager · Windows",Left=24,Top=24,Width=550,Height=35,Font=new Font("Segoe UI",18)};
    var note=new Label{Text="Install for the current user. Budgets and preferences are preserved.\n安装到当前用户；保留预算和偏好设置。",Left=24,Top=70,Width=550,Height=50};
    var install=new Button{Text="安装 / 更新 · Install / Update",Left=24,Top=130,Width=270,Height=38};
    var uninstall=new Button{Text="卸载 · Uninstall",Left=310,Top=130,Width=260,Height=38};
    var output=new TextBox{Left=24,Top=185,Width=546,Height=145,Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,BackColor=Color.FromArgb(40,40,40),ForeColor=Color.White};
    Action<bool> run=async remove=>{
      install.Enabled=uninstall.Enabled=false;
      try{
        var root=Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
        var code=Path.Combine(root,"payload","resources","app");
        var info=new ProcessStartInfo(Path.Combine(code,"vendor","node.exe")){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
        info.Arguments="\""+Path.Combine(code,"scripts","install-win.mjs")+"\""+(remove?" --uninstall":" --payload \""+Path.Combine(root,"payload")+"\"");
        using(var p=Process.Start(info)){
          var stdout=p.StandardOutput.ReadToEndAsync();var stderr=p.StandardError.ReadToEndAsync();
          await System.Threading.Tasks.Task.Run(()=>p.WaitForExit());output.Text=(await stdout)+Environment.NewLine+(await stderr);
          if(p.ExitCode==0)output.AppendText(Environment.NewLine+"完成 / Complete");
        }
      }catch(Exception e){output.Text=e.Message;}finally{install.Enabled=uninstall.Enabled=true;}
    };
    install.Click+=(s,e)=>run(false);uninstall.Click+=(s,e)=>run(true);
    form.Controls.AddRange(new Control[]{title,note,install,uninstall,output});Application.Run(form);
  }
}
