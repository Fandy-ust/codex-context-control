import {spawn,spawnSync} from 'node:child_process';
import path from 'node:path';
import {ensureDaemon} from './service.mjs';
import {settings} from './paths.mjs';

const s=settings();if(!s.desktopExecutable||!s.shim)throw new Error('请先安装 Context Control');
const check=spawnSync('/usr/bin/pgrep',['-x',path.basename(s.desktopExecutable)],{encoding:'utf8'});
if(check.status===0){
  spawnSync('/usr/bin/osascript',['-e','display dialog "请先正常退出当前 Codex／ChatGPT 客户端，再通过 Codex Context Launcher 启动。正在运行的聊天不会被自动关闭。" buttons {"好"} default button "好"']);
}else{
  await ensureDaemon();const child=spawn(s.desktopExecutable,process.argv.slice(2),{env:{...process.env,CODEX_CLI_PATH:s.shim},detached:true,stdio:'ignore'});child.unref();
}
