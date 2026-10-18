// Keep Chromium's wheel gesture attached to the same scroll container until idle.
export function scrollActivity({onStart,onIdle,delay=180,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let timer=null,active=false;
  return {
    get active(){return active;},
    touch(){
      if(timer!=null)clearTimer(timer);
      const starting=!active;active=true;
      if(starting)onStart();
      timer=setTimer(()=>{timer=null;active=false;onIdle();},delay);
    }
  };
}
