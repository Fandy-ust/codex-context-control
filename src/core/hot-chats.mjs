export const HOT_CHAT_LIMIT=20;
export const visibleChat=t=>t&&!t.archived&&t.ephemeral!==true&&t.canAcceptDirectInput!==false&&(t.threadSource==null||t.threadSource==='user');

// Select before hydrating cached usage, model information or sidebar state.
// Safety-critical/current selections are explicit exceptions to the recent cap.
export function hotChatIds(threads,{requiredIds=[],compare=()=>0}={}){
 const sorted=threads.filter(visibleChat).sort(compare),known=new Set(sorted.map(t=>t.id)),ids=new Set(sorted.slice(0,HOT_CHAT_LIMIT).map(t=>t.id));
 for(const id of requiredIds)if(known.has(id))ids.add(id);
 return sorted.filter(t=>ids.has(t.id)).map(t=>t.id);
}
