// Only explicitly supported native commands are executable queue commands.
export function taskCommand(prompt){
 const text=prompt.trim();if(!/^\/[a-z][\w-]*(?:\s|$)/i.test(text))return null;
 const [name,...args]=text.split(/\s+/);if(name.toLowerCase()!=='/compact')throw Error('暂不支持此队列指令：'+name);
 if(args.length)throw Error('/compact 请单独作为一项任务，不要附加提示词');
 return {type:'compact'};
}
