import {setTimeout as delay} from 'node:timers/promises';
const API='https://api.github.com';
export function githubSync(config,token,{fetcher=fetch,signal,writeDelay=1000}={}){
  const headers={Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'Context-Manager-Sync'};
  async function json(route,method='GET',body,missing=false){
    const response=await fetcher(API+route,{method,headers,redirect:'error',signal,...(body?{body:JSON.stringify(body)}:{})});
    if(missing&&response.status===404)return null;
    if(!response.ok){const error=Error(`GitHub API ${response.status}${response.status===403||response.status===429?'（权限不足或请求过于频繁，请稍后重试）':''}`);error.status=response.status;throw error;}
    if(Number(response.headers.get('content-length'))>64*1024*1024)throw Error('GitHub sync response too large');
    const reader=response.body.getReader();let size=0;const chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>64*1024*1024)throw Error('GitHub sync response too large');chunks.push(value);}}finally{await reader.cancel();}
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  const repo=`/repos/${config.repository}`,directory=`context-manager-v1/${config.group}`;
  let gist,lastWrite=0;
  async function throttle(){const remaining=writeDelay-(Date.now()-lastWrite);if(remaining>0)await delay(remaining,undefined,{signal});lastWrite=Date.now();}
  return {
    async init(){
      if(config.provider==='gist'){
        if(!config.gistId)throw Error('请先创建或填写 Secret Gist ID');
        gist=await json(`/gists/${config.gistId}`);if(gist.public!==false)throw Error('请使用 Secret Gist');
        if(gist.truncated)throw Error('Gist 文件列表不完整，请改用私有仓库或新的 Gist');
      }else{const info=await json(repo);if(info.private!==true)throw Error('同步仓库必须是私有仓库');}
    },
    async manifests(){
      const pattern=new RegExp(`^cm1-${config.group}-([a-f0-9]{32})-manifest\\.json$`);
      if(gist)return Object.keys(gist.files).filter(n=>pattern.test(n)).map(n=>({name:n,device:n.match(pattern)[1],revision:gist.files[n].raw_url}));
      const files=await json(`${repo}/contents/${directory}`, 'GET',undefined,true)||[];
      if(!Array.isArray(files)||files.length>=1000)throw Error('Invalid sync manifest directory');
      return files.filter(f=>/^manifest-[a-f0-9]{32}\.json$/.test(f.name)).map(f=>({name:f.name,device:f.name.slice(9,-5),revision:f.sha}));
    },
    manifestName(device){return gist?`cm1-${config.group}-${device}-manifest.json`:`manifest-${device}.json`;},
    chunkName(device,hash){return gist?`cm1-${config.group}-${device}-${hash}.json`:`chunks/${device}/${hash}.json`;},
    async read(name){
      if(gist){const f=gist.files[name];if(!f)throw Error('Missing sync file');if(f.truncated||typeof f.content!=='string'){
        const url=new URL(f.raw_url);if(url.protocol!=='https:'||url.hostname!=='gist.githubusercontent.com')throw Error('Invalid Gist raw URL');
        const r=await fetcher(url,{signal,redirect:'error'});if(!r.ok)throw Error('Cannot read encrypted Gist file');
        const reader=r.body.getReader();let size=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512000)throw Error('Sync file too large');chunks.push(value);}}finally{await reader.cancel();}return Buffer.concat(chunks).toString();
      }return f.content;}
      const f=await json(`${repo}/contents/${directory}/${name}`);if(f.encoding!=='base64'||f.size>512000)throw Error('Invalid sync file');return Buffer.from(f.content,'base64').toString();
    },
    async write(name,content){
      await throttle();
      if(Buffer.byteLength(content)>512000)throw Error('Sync file too large');
      if(gist){await json(`/gists/${config.gistId}`,'PATCH',{files:{[name]:{content}}});return;}
      const route=`${repo}/contents/${directory}/${name}`;
      for(let attempt=0;attempt<3;attempt++){
        const old=await json(route,'GET',undefined,true);
        try{await json(route,'PUT',{message:'Sync Context Manager statistics',content:Buffer.from(content).toString('base64'),...(old?{sha:old.sha}:{})});return;}
        catch(error){if(![409,422].includes(error.status)||attempt===2)throw error;}
      }
    },
    async remove(name){
      await throttle();
      if(gist){await json(`/gists/${config.gistId}`,'PATCH',{files:{[name]:null}});return;}
      const route=`${repo}/contents/${directory}/${name}`,old=await json(route,'GET',undefined,true);
      if(old)await json(route,'DELETE',{message:'Prune superseded Context Manager sync shard',sha:old.sha});
    },
    async createGist(){const result=await json('/gists','POST',{description:'Context Manager encrypted statistics',public:false,files:{'context-manager.txt':{content:'Encrypted numeric statistics. See Context Manager cloud sync documentation.'}}});return result.id;}
  };
}
