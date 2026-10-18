const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// Migrations are additive and never downgrade a future document's marker.
// Reject invalid documents before any write instead of silently resetting data.
export function normalizeStateDocument(value){
 if(!object(value)||(Object.hasOwn(value,'policies')&&!object(value.policies))||(Object.hasOwn(value,'threads')&&!object(value.threads)))throw Error('Invalid saved controller state');
 const oldVersion=value.version??1;
 if(!Number.isSafeInteger(oldVersion)||oldVersion<0)throw Error('Invalid controller state schema version');
 const threads=Object.fromEntries(Object.entries(value.threads??{}).map(([id,original])=>{
  if(!object(original))throw Error('Invalid saved thread metadata');
  const thread={...original};
  if(oldVersion<2||(thread.name&&(thread.name.length>120||/[\r\n]/.test(thread.name))))thread.name=null;
  return [id,thread];
 }));
 return {...value,version:Math.max(2,oldVersion),policies:{...value.policies},threads};
}
