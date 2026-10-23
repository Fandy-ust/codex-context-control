import {resetNotificationText} from '../src/core/quota-reset-notifications.mjs';

// Persist before delivery so reloads and tray/main-window refreshes cannot repeat.
export function createResetNotifier({read,save,show,now=Date.now}){
  let seen=read()?.id??null;
  return {observe(event,{enabled=true,stale=false}={}){
    if(!event||event.id===seen)return;
    if(enabled&&(stale||now()<event.deliverAfter))return;
    seen=event.id;save({id:seen});
    if(!enabled||now()-event.at>10*60000)return;
    show(resetNotificationText(event.roles));
  }};
}
