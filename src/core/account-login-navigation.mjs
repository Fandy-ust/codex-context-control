export function allowedLoginNavigation(target,authorization){
  try{const url=new URL(target),initial=new URL(authorization),callback=new URL(initial.searchParams.get('redirect_uri'));
    if(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(callback.hostname)&&url.origin===callback.origin)return true;
    const domains=['auth.openai.com','chatgpt.com','accounts.google.com','login.microsoftonline.com','login.live.com','appleid.apple.com'];
    return url.protocol==='https:'&&!url.username&&!url.password&&domains.some(host=>url.hostname===host||url.hostname.endsWith('.'+host));
  }catch{return false;}
}
