// Keep startup visible even when a module or the initial service request fails.
const startup=document.querySelector('[data-startup]');
const status=startup.querySelector('[data-startup-status]');
const retry=startup.querySelector('[data-startup-retry]');
retry.addEventListener('click',()=>location.reload());
const slow=setTimeout(()=>{
  if(!startup.isConnected)return;
  status.textContent='仍在连接本地服务，可重新加载界面 / Connecting to the local service; you can reload the interface.';
  retry.hidden=false;
},10000);
try{await import('./app.mjs');}catch{
  if(startup.isConnected){
    status.textContent='界面加载失败，请重新加载 / Interface failed to load. Please reload.';
    retry.hidden=false;
  }
}finally{clearTimeout(slow);}
