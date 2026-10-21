// Own the notification entry independently of windows and asynchronous refreshes.
export function createTrayController({create,render,handlers={}}){
  let entry=null,running=false,pending={remaining:null,stale:true,dark:true,tooltip:'Context Manager'},key=null;
  function update(value={}){
    pending={...pending,...value};if(!running)return;
    const nextKey=JSON.stringify([pending.remaining,pending.stale,pending.dark]);
    if(!entry||entry.isDestroyed()){
      const image=render(pending);entry=create(image);key=nextKey;
      for(const [event,callback]of Object.entries(handlers))entry.on(event,callback);
    }else if(key!==nextKey){entry.setImage(render(pending));key=nextKey;}
    entry.setToolTip(pending.tooltip);
  }
  return {
    start(){running=true;update();},update,
    repair(){if(!running)return;if(entry&&!entry.isDestroyed())entry.destroy();entry=null;key=null;update();},
    stop(){running=false;if(entry&&!entry.isDestroyed())entry.destroy();entry=null;key=null;},
    get entry(){return entry;},
    get ready(){return running&&!!entry&&!entry.isDestroyed();}
  };
}
