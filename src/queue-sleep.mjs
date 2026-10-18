import {spawn} from 'node:child_process';

// A child-held OS assertion also disappears when the daemon exits unexpectedly.
export function createQueueSleepInhibitor(){
  let child;
  return enabled=>{
    if(!enabled){child?.stdin?.end();child?.kill();child=null;return;}
    if(child)return;
    if(process.platform==='darwin')child=spawn('/usr/bin/caffeinate',['-i','-w',String(process.pid)],{stdio:['pipe','ignore','ignore']});
    else if(process.platform==='win32')child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type -Namespace QueueGuard -Name Power -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'; [QueueGuard.Power]::SetThreadExecutionState(2147483649) | Out-Null; try { [Console]::In.ReadToEnd() | Out-Null } finally { [QueueGuard.Power]::SetThreadExecutionState(2147483648) | Out-Null }`],{windowsHide:true,stdio:['pipe','ignore','ignore']});
    const owned=child;child?.once('error',()=>{if(child===owned)child=null;});child?.once('exit',()=>{if(child===owned)child=null;});
  };
}
