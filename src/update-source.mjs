import {repository} from './core/update-artifact.mjs';
export {repository,manifestCandidate} from './core/update-artifact.mjs';
export const releaseManifestURL=repository+'releases/latest/download/update.json';
export const releaseMatrixURL=repository+'releases/latest/download/update-v2.json';
export const releaseAPI='https://api.github.com/repos/Fandy-ust/codex-context-control/releases/latest';
export async function updateSourceError(response,source,now){
 const header=name=>response.headers?.get?.(name),status=response.status;let message='';
 try{message=String((await response.json()).message??'').slice(0,1000);}catch{}
 const limited=status===429||header('x-ratelimit-remaining')==='0'||/rate limit/i.test(message);
 const retry=header('retry-after');let retryAt=now+60000;
 if(retry){const seconds=Number(retry);const date=Number.isFinite(seconds)?now+Math.max(0,seconds)*1000:Date.parse(retry);if(Number.isFinite(date))retryAt=Math.max(retryAt,date);}
 const reset=Number(header('x-ratelimit-reset'))*1000;if(limited&&Number.isFinite(reset)&&reset>now)retryAt=Math.max(retryAt,reset);
 const error=limited?'GitHub 请求已限流，请稍后重试或从发布页下载。':status===403?'更新检查被拒绝（HTTP 403），请检查网络或从发布页下载。':`更新来源暂不可用（HTTP ${status}），可从发布页下载。`;
 return Object.assign(Error(error),{retryAt:Math.ceil(retryAt),code:limited?'rate_limited':status===403?'forbidden':'http_error',source,status});
}
