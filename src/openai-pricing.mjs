export const openaiPricePage='https://developers.openai.com/api/docs/pricing';
export const openaiPriceMarkdown=openaiPricePage+'.md';

const tiers=new Map([
  ['### Standard pricing data','standard'],
  ['### Flex pricing data','flex'],
  ['### Fast pricing data','fast']
]);
const header=['model',...['short','long'].flatMap(band=>['input','output','cached input','30m write','12h write'].map(rate=>band+' context '+rate))];
const dollars=value=>/^\$\d+(?:\.\d+)?$/.test(value)?Number(value.slice(1)):NaN;

export function parseOpenAIPrices(markdown,longContextAbove){
  const unit=markdown.includes('Prices per 1M tokens.');
  const threshold=/^Short context: ≤([\d,]+)K? input tokens\. Long context: >\1(K?) input tokens\.$/mi.exec(markdown);
  if(!unit||!threshold||Number(threshold[1].replaceAll(',',''))*(threshold[2]?1000:1)!==longContextAbove)return null;
  const models=Object.create(null);
  let tier,columns=null;
  for(const line of markdown.split(/\r?\n/)){
    const text=line.trim();
    if(text.startsWith('#')){tier=tiers.get(text);columns=null;continue;}
    if(!tier||!text.startsWith('|')||!text.endsWith('|'))continue;
    const cells=text.slice(1,-1).split('|').map(cell=>cell.trim());
    if(cells[0].toLowerCase()==='model'){
      const labels=cells.map(cell=>cell.toLowerCase());
      columns=labels.length===header.length&&header.every(label=>labels.includes(label))?header.map(label=>labels.indexOf(label)):null;
      continue;
    }
    const id=cells[0];
    if(!columns||cells.length!==header.length||!/^gpt-[\w.-]+$/.test(id))continue;
    // The estimator uses the published 30-minute cache-write rate.
    const short=[1,3,4,2].map(index=>dollars(cells[columns[index]]));
    const long=[6,8,9,7].map(index=>dollars(cells[columns[index]]));
    if(![...short,...long].every(Number.isFinite))continue;
    (models[id]??={})[tier]={short,long};
  }
  return Object.fromEntries(Object.entries(models).filter(([,rates])=>rates.standard));
}
