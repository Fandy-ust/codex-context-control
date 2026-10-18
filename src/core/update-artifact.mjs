export const repository='https://github.com/Fandy-ust/codex-context-control/';
export const MAX_UPDATE_BYTES=256*1024*1024;
export function newerVersion(candidate,current){
 if(!/^\d+\.\d+\.\d+$/.test(candidate)||!/^\d+\.\d+\.\d+$/.test(current))return false;
 const a=candidate.split('.').map(Number),b=current.split('.').map(Number);
 for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;
}
export function artifactFilename(version,{platform='darwin',arch='arm64'}={}){
 if(!/^\d+\.\d+\.\d+$/.test(version)||!['arm64','x64'].includes(arch)||!['darwin','win32'].includes(platform))return null;
 return `Context-Manager-${version}-${platform==='darwin'?'macos':'windows'}-${arch}.${platform==='darwin'?'dmg':'zip'}`;
}
export function artifactForTarget(candidate,target){return !!candidate&&candidate.filename===artifactFilename(candidate.version,target);}
export function manifestCandidate(doc,target={platform:'darwin',arch:'arm64'}){
 const version=doc?.version,tag=doc?.tag;
 if(![1,2].includes(doc?.schemaVersion)||typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version)||typeof tag!=='string'||tag.match(/^v(\d+\.\d+\.\d+)(?:-preview\.\d+)?$/)?.[1]!==version)throw Error('版本文件格式无效');
 if(doc.schemaVersion===1&&!new RegExp('^Context-Manager-'+version.replaceAll('.','\\.')+'-(macos-(arm64|x64)\\.dmg|windows-(arm64|x64)\\.zip)$').test(doc.filename??''))throw Error('版本文件内容不完整');
 if(doc.schemaVersion===2&&(!doc.assets||typeof doc.assets!=='object'||Array.isArray(doc.assets)))throw Error('版本文件内容不完整');
 const filename=artifactFilename(version,target);if(!filename)return null;
 const entry=doc.schemaVersion===1?(doc.filename===filename?doc:null):doc.assets?.[`${target.platform}-${target.arch}`];
 if(!entry)return null;
 if(entry.filename!==filename||!Number.isSafeInteger(entry.size)||entry.size<=0||entry.size>MAX_UPDATE_BYTES||typeof entry.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(entry.sha256))throw Error('版本文件内容不完整');
 const prefix=repository+'releases/download/'+tag+'/';
 return {version,filename,size:entry.size,sha256:entry.sha256.toLowerCase(),url:prefix+filename,checksumURL:prefix+filename+'.sha256',releaseURL:repository+'releases/tag/'+tag};
}
export function releaseUpdate(release,current,target={platform:'darwin',arch:'arm64'}){
 if(release.draft||release.prerelease)return null;
 const version=release.tag_name?.match(/^v(\d+\.\d+\.\d+)(?:-preview\.\d+)?$/)?.[1];
 if(!version||!newerVersion(version,current))return null;
 const filename=artifactFilename(version,target);if(!filename)return null;
 const asset=name=>release.assets?.find(a=>a.name===name&&a.state==='uploaded');
 const image=asset(filename),checksum=asset(filename+'.sha256');if(!image&&!checksum)return null;
 const prefix=repository+'releases/download/'+release.tag_name+'/';
 if(!image||!checksum||image.browser_download_url!==prefix+filename||checksum.browser_download_url!==prefix+filename+'.sha256'||!Number.isSafeInteger(image.size)||image.size<=0||image.size>MAX_UPDATE_BYTES)throw Error('更新文件信息无效');
 return {version,filename,url:image.browser_download_url,checksumURL:checksum.browser_download_url,size:image.size,releaseURL:repository+'releases/tag/'+release.tag_name};
}
