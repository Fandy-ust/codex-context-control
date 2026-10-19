export const QUEUE_RUNTIME_RESTART='当前 Codex 接入版本不支持任务队列，请完整退出并重新打开 Codex。';
export function supportsTaskQueues(bridge){
  if(!bridge)return false;
  if(bridge.taskQueueVersion!=null)return bridge.taskQueueVersion===4;
  // Require task permission support as well as native queue commands.
  const version=/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(bridge.version??'');
  return !!version&&(Number(version[1])>0||Number(version[2])>22||Number(version[2])===22&&Number(version[3])>=4);
}
