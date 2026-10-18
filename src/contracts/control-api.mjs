import fs from 'node:fs';
const spec=JSON.parse(fs.readFileSync(new URL('./control-api.json',import.meta.url),'utf8'));
export const CONTROL_API_VERSION=spec.version;
export const CONTROL_ROUTES=Object.freeze(Object.fromEntries(Object.entries(spec.routes).map(([name,route])=>[name,Object.freeze(route)])));
const operations=new Map(Object.entries(CONTROL_ROUTES).map(([name,r])=>[r.method+' '+r.path,name]));
export function controlOperation(method,path){return operations.get(method+' '+path)??null;}
export function assertControlOperation(action){if(!Object.hasOwn(CONTROL_ROUTES,action))throw Error('Unknown control operation');return CONTROL_ROUTES[action];}
