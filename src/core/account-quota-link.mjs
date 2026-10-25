const email=value=>typeof value==='string'?value.trim().toLowerCase():'';

// Link display observations to saved sign-ins, never credentials. An email shared
// by multiple workspaces is ambiguous unless the observation identifies one.
export function accountQuotaViews(login,quota){
  const profiles=login?.profiles||[],accounts=quota?.accounts||[],observed=new Map();
  const linked=accounts.map(account=>{
    const address=email(account.email||account.label);
    if(!address)return {...account,loginId:null};
    const matching=profiles.filter(profile=>email(profile.email)===address&&(!account.workspace||profile.workspace===account.workspace));
    const peers=accounts.filter(other=>email(other.email||other.label)===address&&(!account.workspace||other.workspace===account.workspace));
    if(matching.length!==1||peers.length!==1)return {...account,loginId:null};
    const result={...account,loginId:matching[0].id};observed.set(matching[0].id,result);return result;
  });
  return {login:{...login,profiles:profiles.map(profile=>({...profile,quota:observed.get(profile.id)||null}))},quota:{...quota,accountSwitchBusy:login?.busy===true,accounts:linked}};
}
