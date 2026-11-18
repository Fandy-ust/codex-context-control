import fs from 'node:fs';
import path from 'node:path';
import {root,readJSON,atomicJSON} from './paths.mjs';
import {openaiPricePage,openaiPriceMarkdown,parseOpenAIPrices} from './openai-pricing.mjs';

export const bundledPrices=JSON.parse(fs.readFileSync(new URL('./api-prices.json',import.meta.url),'utf8'));
const priceFile=home=>path.join(home,'model-prices.json');
const entries=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value):[];
const validRates=rates=>Array.isArray(rates)&&rates.length===4&&rates.every(rate=>rate===null||Number.isFinite(rate)&&rate>=0);

function validBook(book){
  const models=entries(book?.models);
  return book?.currency==='USD'&&book.unitTokens===1000000&&Number.isSafeInteger(book.longContextAbove)&&book.longContextAbove>0
    &&typeof book.source==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(book.checkedAt)&&models.length>0
    &&models.every(([id,tiers])=>/^[\w.-]+$/.test(id)&&Object.hasOwn(tiers??{},'standard')&&entries(tiers).every(([tier,bands])=>
      ['standard','fast','flex','ultrafast'].includes(tier)&&validRates(bands?.short)&&validRates(bands?.long)));
}

export function readModelPrices(home=root){
  try{
    const book=JSON.parse(fs.readFileSync(priceFile(home),'utf8'));
    if(validBook(book)&&book.checkedAt>=bundledPrices.checkedAt)return book;
  }catch{/* Use the bundled table when local data is missing or unreadable. */}
  return bundledPrices;
}

const modeFile=()=>path.join(root,'cost-estimate-preferences.json');
export function costPricingMode(){
  try{return readJSON(modeFile(),{}).mode==='flat'?'flat':'api';}
  catch{return 'api';}
}
export function setCostPricingMode(mode){
  if(mode!=='api'&&mode!=='flat')throw Error('费用估算模式无效');
  atomicJSON(modeFile(),{mode});
  return {mode};
}

export function createModelPriceUpdater({home=root,fetcher=fetch,now=()=>new Date()}={}){
  const attemptFile=path.join(home,'model-prices-attempt.json');
  let pending;
  async function download(){
    const response=await fetcher(openaiPriceMarkdown,{signal:AbortSignal.timeout(15000),redirect:'error',cache:'no-store'});
    if(!response.ok)throw Error('无法下载模型价格列表，请稍后重试');
    const current=readModelPrices(home);
    const official=parseOpenAIPrices(await response.text(),current.longContextAbove);
    if(!official||!Object.keys(official).length)throw Error('下载的模型价格列表无效');
    const models={...current.models};
    const updatedModels=[];
    for(const [id,rates] of Object.entries(official)){
      const previous=Object.hasOwn(models,id)?models[id]:{};
      if(Object.entries(rates).some(([tier,price])=>
        ['short','long'].some(band=>price[band].some((rate,index)=>rate!==previous[tier]?.[band]?.[index]))))updatedModels.push(id);
      models[id]={...previous,...rates};
    }
    const book={...current,checkedAt:now().toISOString().slice(0,10),source:openaiPricePage,models};
    atomicJSON(priceFile(home),book);
    return {count:Object.keys(official).length,updatedModels};
  }
  return function refresh({automatic=false,models=[]}={}){
    if(pending)return pending;
    if(automatic){
      const book=readModelPrices(home);
      if(book!==bundledPrices&&!models.some(model=>!Object.hasOwn(book.models,model)))return;
      const clock=now();
      const day=[clock.getFullYear(),clock.getMonth()+1,clock.getDate()].join('-');
      if(readJSON(attemptFile,{})?.day===day)return;
      // Persist before making the request, so restarts and failures count too.
      atomicJSON(attemptFile,{day});
    }
    pending=download().finally(()=>{pending=null;});
    return pending;
  };
}
