// Viewport overlays blur only the content reaching a scroll boundary. Keeping
// them outside the scroller avoids changing its layout, focus or scroll range.
export function installScrollEdges(root){
 const selector='.main,.chat-list,.tray-list,.settings-body,.queue-model-options,.queue-model-panel,.queue-attachment-grid,textarea,pre,.table-scroll,.cost-scroll';
 const overlays=new Map();let frame=0;
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 const resize=new ResizeObserver(schedule);
 const mutations=new MutationObserver(schedule);
 mutations.observe(root,{childList:true,subtree:true});
 root.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);
 function update(){
  frame=0;const candidates=new Set(root.querySelectorAll(selector));
  for(const [element,edges] of overlays)if(!candidates.has(element)){edges.forEach(edge=>edge.remove());overlays.delete(element);resize.unobserve(element);}
  for(const element of candidates){
   let edges=overlays.get(element);
   if(!edges){edges=['top','bottom'].map(side=>{const edge=document.createElement('div');edge.className=`scroll-edge scroll-edge-${side}`;edge.setAttribute('aria-hidden','true');document.body.append(edge);return edge;});overlays.set(element,edges);resize.observe(element);}
   const style=getComputedStyle(element),rect=element.getBoundingClientRect();
   const scrollable=/(auto|scroll)/.test(style.overflowY)&&element.scrollHeight>element.clientHeight+1;
   const visible=scrollable&&rect.width>0&&rect.height>0&&!element.closest('[inert]');
   const depth=Math.min(element.matches('.chat-list,.tray-list')?28:14,element.clientHeight/5);
   const left=rect.left+element.clientLeft,bottom=rect.top+element.clientTop+element.clientHeight;
   let top=rect.top+element.clientTop;
   // Sticky navigation controls stay sharp; content fades immediately below.
   for(const heading of element.querySelectorAll('.qa-heading,.details-toolbar,.queue-header')){
    const bounds=heading.getBoundingClientRect();if(bounds.top<=top+1&&bounds.bottom>top)top=bounds.bottom;
   }
   let clipTop=0,clipBottom=innerHeight;
   for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){if(/auto|scroll|hidden|clip/.test(getComputedStyle(ancestor).overflowY)){const bounds=ancestor.getBoundingClientRect();clipTop=Math.max(clipTop,bounds.top);clipBottom=Math.min(clipBottom,bounds.bottom);}}
   let color='rgb(24, 24, 24)';
   for(let ancestor=element;ancestor;ancestor=ancestor.parentElement){const bg=getComputedStyle(ancestor).backgroundColor;if(/^rgb\(/.test(bg)){color=bg;break;}}
   edges.forEach((edge,index)=>{
    const edgeTop=index===0?top:bottom-depth;
    const active=visible&&edgeTop>=clipTop&&edgeTop+depth<=clipBottom&&(index===0?element.scrollTop>1:element.scrollHeight-element.clientHeight-element.scrollTop>1);
    edge.hidden=!active;
    edge.dataset.surface=element.classList[0]||element.tagName.toLowerCase();
    edge.style.setProperty('--edge-background',color);
    Object.assign(edge.style,{left:`${left}px`,top:`${edgeTop}px`,width:`${element.clientWidth}px`,height:`${depth}px`,zIndex:element.closest('.settings-dialog')?'60':element.closest('.queue-model-panel')?'70':'40'});
   });
  }
 }
 schedule();
 return {refresh:schedule,dispose(){cancelAnimationFrame(frame);mutations.disconnect();resize.disconnect();root.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);for(const edges of overlays.values())edges.forEach(edge=>edge.remove());overlays.clear();}};
}
