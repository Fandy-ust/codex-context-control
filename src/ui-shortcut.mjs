export const DEFAULT_SHORTCUT='Control+Shift+M';
const modifiers=['Control','Alt','Shift','Super'];
const aliases={ctrl:'Control',control:'Control',alt:'Alt',option:'Alt',shift:'Shift',win:'Super',windows:'Super',meta:'Super',super:'Super',cmd:'Super',command:'Super'};
const keys={space:'Space',tab:'Tab',enter:'Enter',return:'Enter',esc:'Escape',escape:'Escape',backspace:'Backspace',delete:'Delete',insert:'Insert',home:'Home',end:'End',pageup:'PageUp',pagedown:'PageDown',up:'Up',down:'Down',left:'Left',right:'Right',plus:'Plus'};
export function normalizeShortcut(value){
  if(typeof value!=='string'||value.length>100)throw Error('请输入有效的快捷键');
  const parts=value.split('+').map(p=>p.trim());if(parts.some(p=>!p))throw Error('请输入有效的快捷键');
  const mods=new Set();let key=null;
  for(const part of parts){const modifier=aliases[part.toLowerCase()];if(modifier){if(mods.has(modifier))throw Error('快捷键不能重复修饰键');mods.add(modifier);continue;}
    const candidate=keys[part.toLowerCase()]||(/^[a-z0-9]$/i.test(part)?part.toUpperCase():/^f(?:[1-9]|1\d|2[0-4])$/i.test(part)?part.toUpperCase():part==='-'?'-':null);
    if(!candidate||key)throw Error('快捷键需要一个按键和可选的修饰键');key=candidate;
  }
  if(!key)throw Error('快捷键需要一个按键和可选的修饰键');
  if(!mods.has('Control')&&!mods.has('Alt')&&!mods.has('Super')&&!/^F\d+$/.test(key))throw Error('请使用 Ctrl、Alt 或 Win 组合，或 F1–F24 功能键');
  return [...modifiers.filter(m=>mods.has(m)),key].join('+');
}
export const shortcutLabel=value=>value.replaceAll('Control','Ctrl').replaceAll('Super','Win').split('+').join(' + ');
export function shortcutFromEvent(event){
  if(['Control','Alt','Shift','Meta'].includes(event.key)||event.repeat)return null;
  const key=/^Key[A-Z]$/.test(event.code)?event.code.slice(3):/^Digit\d$/.test(event.code)?event.code.slice(5):event.key===' '?'Space':event.key==='+'?'Plus':event.key?.replace(/^Arrow/,'');
  return normalizeShortcut([event.ctrlKey?'Control':null,event.altKey?'Alt':null,event.shiftKey?'Shift':null,event.metaKey?'Super':null,key].filter(Boolean).join('+'));
}
export function createShortcutManager({read,write,register,unregister,onTrigger,inactive=false}){
  let current={accelerator:DEFAULT_SHORTCUT,enabled:true},registered=false,error=null;
  const status=()=>({...current,registered,error,defaultAccelerator:DEFAULT_SHORTCUT,inactive});
  const document=()=>{try{return read()||{};}catch{return {};}};
  return {
    status,
    start(){const saved=document().shortcut;try{const accelerator=saved?.accelerator===''?'':normalizeShortcut(saved?.accelerator??DEFAULT_SHORTCUT);current={accelerator,enabled:accelerator!==''&&saved?.enabled!==false};}catch{current={accelerator:DEFAULT_SHORTCUT,enabled:true};}
      if(current.enabled&&!inactive){try{registered=register(current.accelerator,onTrigger)===true;}catch{registered=false;}if(!registered)error='快捷键已被占用，请选择其他组合';}return status();},
    set(input){const accelerator=typeof input.accelerator==='string'&&input.accelerator.trim()===''?'':normalizeShortcut(input.accelerator),next={accelerator,enabled:accelerator!==''&&input.enabled!==false},same=next.accelerator===current.accelerator;
      let nextRegistered=registered&&same&&next.enabled,newBinding=false;
      if(next.enabled&&!inactive&&!nextRegistered){try{nextRegistered=register(next.accelerator,onTrigger)===true;}catch{nextRegistered=false;}if(!nextRegistered)throw Error('快捷键已被占用，请选择其他组合');newBinding=true;}
      try{const doc=document();write({...doc,version:Math.max(1,Number.isSafeInteger(doc.version)?doc.version:1),shortcut:{...doc.shortcut,...next}});}catch(e){if(newBinding)unregister(next.accelerator);throw e;}
      if(registered&&(!same||!next.enabled))unregister(current.accelerator);
      current=next;registered=nextRegistered;error=null;return status();
    },
    dispose(){if(registered)unregister(current.accelerator);registered=false;}
  };
}
