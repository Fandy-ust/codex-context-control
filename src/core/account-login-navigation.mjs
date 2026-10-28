const loginHosts=['auth.openai.com','auth0.openai.com','chatgpt.com','accounts.google.com','login.microsoftonline.com','login.live.com','appleid.apple.com'];
const verificationHosts=['sentinel.openai.com','challenges.cloudflare.com','www.google.com','www.gstatic.com','www.recaptcha.net','recaptcha.net','fpt.live.com','iframe.arkoselabs.com','sc.imp.live.com'];
const hostMatches=(host,hosts)=>hosts.some(value=>host===value||host.endsWith('.'+value));
export function allowedLoginNavigation(target,authorization,{kind='main',source=authorization}={}){
  try{
    const url=new URL(target),initial=new URL(authorization);
    if(url.href==='about:blank'||url.href==='about:srcdoc'){
      const origin=new URL(source);
      return kind!=='main'&&origin.protocol==='https:'&&!origin.username&&!origin.password&&hostMatches(origin.hostname,[...loginHosts,...verificationHosts]);
    }
    if(url.username||url.password)return false;
    const callbackValue=initial.searchParams.get('redirect_uri');
    if(callbackValue){const callback=new URL(callbackValue);if(callback.protocol==='http:'&&!callback.username&&!callback.password&&['127.0.0.1','localhost'].includes(callback.hostname)&&url.origin===callback.origin)return true;}
    return url.protocol==='https:'&&hostMatches(url.hostname,kind==='frame'?[...loginHosts,...verificationHosts]:loginHosts);
  }catch{return false;}
}
