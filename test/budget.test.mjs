import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {calculateBudget,effectiveWindow,savedBudget} from '../src/budget.mjs';
import {normalizePolicy,preflight} from '../src/policy.mjs';

const model={max_context_window:872000,effective_context_window_percent:95};
test('native K sliders keep exact thresholds, safe limits and a stable linked ratio',{skip:process.platform!=='darwin',timeout:60000},()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-sliders-'));
  try{
    fs.writeFileSync(path.join(temp,'main.swift'),`import Foundation
func budget(_ window:Int,_ compact:Int,_ percent:Int=95) throws -> BudgetPreview {try BudgetMath.sliderPreview(windowK:window,compactK:compact,effectivePercent:percent,maximumRawWindow:872000)}
func check(_ condition:Bool){precondition(condition)}
let p=try budget(700,630)
precondition(p.usableWindow==700000 && p.rawWindow==736843 && p.compact==630000)
let legacy=try budget(665,600)
precondition(legacy.rawWindow==700000 && legacy.compact==600000)
check(try BudgetMath.maximumSliderCompactK(windowK:828,effectivePercent:95,maximumRawWindow:872000)==784)
check(try budget(828,784).compact==784000)
check(try budget(2,1).compact==1000)
for (window,compact,percent) in [(829,700,95),(700,664,95),(700,631,100),(1,1,95),(2,0,95)] {
    var rejected=false;do{_ = try budget(window,compact,percent)}catch{rejected=true};precondition(rejected)
}
for window in [400,701,665,828,200,665] {
    let maximum=try BudgetMath.maximumSliderCompactK(windowK:window,effectivePercent:95,maximumRawWindow:872000)
    let compact=BudgetMath.linkedSliderCompactK(windowK:window,ratioNumerator:600,ratioDenominator:665,maximumK:maximum)
    precondition(compact==window*600/665)
    check(try budget(window,compact).compact%1000==0)
}
precondition(BudgetMath.linkedSliderCompactK(windowK:701,ratioNumerator:90,ratioDenominator:100,maximumK:664)==630)
precondition(BudgetMath.linkedSliderCompactK(windowK:700,ratioNumerator:94,ratioDenominator:100,maximumK:630)==630)
print("K slider math verified")
`);
    const binary=path.join(temp,'slider-math');
    const compiled=spawnSync('/usr/bin/xcrun',['swiftc',fileURLToPath(new URL('../macos/Localization.swift',import.meta.url)),fileURLToPath(new URL('../macos/BudgetMath.swift',import.meta.url)),path.join(temp,'main.swift'),'-o',binary],{encoding:'utf8',timeout:30000});assert.equal(compiled.status,0,compiled.stderr);
    const result=spawnSync(binary,[],{encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('700K usable at 90% compression means exactly 700K reported and a 630K threshold',()=>{
  const budget=calculateBudget({usableWindow:'700K',compactPercent:90},model);
  assert.equal(budget.window,736843);assert.equal(budget.usableWindow,700000);assert.equal(budget.compact,630000);
  assert.equal(budget.maximumUsableWindow,828400);assert.equal(budget.maxCompactPercent,94.73);
  const resized=calculateBudget({usableWindow:'400K',compactPercent:90},model);assert.equal(resized.compact,360000);
});
test('inverse conversion is exact and minimal for every supported usable percentage',()=>{
  for(let percent=1;percent<=100;percent++){
    const m={max_context_window:2000000,effective_context_window_percent:percent};
    const desired=effectiveWindow(m.max_context_window,percent)-1;
    const budget=calculateBudget({usableWindow:desired,compactPercent:90},m);
    assert.equal(effectiveWindow(budget.window,percent),desired);
    assert.ok(effectiveWindow(budget.window-1,percent)<desired);
    const plan=preflight({status:'idle',freshUsage:true,lastUsage:{totalTokens:0}},normalizePolicy({...budget,reserve:0}),m);
    assert.equal(plan.expectedWindow,desired);assert.equal(plan.effectiveCompact,budget.compact);
  }
});
test('limits are stated in usable tokens and invalid ratios cannot be silently clamped',()=>{
  assert.throws(()=>calculateBudget({usableWindow:828401},model),/828,400/);
  assert.throws(()=>calculateBudget({usableWindow:'700K',compactPercent:95},model),/94.73/);
  assert.throws(()=>calculateBudget({usableWindow:'700K',compactPercent:95},{...model,effective_context_window_percent:100}),/90/);
  for(const ratio of ['90.001','-1','Infinity',0,101])assert.throws(()=>calculateBudget({usableWindow:'700K',compactPercent:ratio},model));
  assert.throws(()=>calculateBudget({usableWindow:'700K'},null),/等待/);
  const small=calculateBudget({usableWindow:1001,compactPercent:90},{...model,effective_context_window_percent:100});assert.equal(small.compact,900);
});
test('legacy raw policies display their current usable capacity without changing saved budgets',()=>{
  const policy={window:700000,compact:600000};const before=structuredClone(policy);
  assert.deepEqual(savedBudget(policy,model),{usableWindow:665000,compact:600000,compactPercent:90.23});
  assert.deepEqual(policy,before);assert.equal(savedBudget(policy,null),null);
});
test('the native panel and controller use matching conversion, rounding and validation',{skip:process.platform!=='darwin',timeout:60000},()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-budget-'));
  const cases=[
    {usableWindow:'700K',compactPercent:90,percent:95,max:872000},
    {usableWindow:'400K',compactPercent:85,percent:95,max:872000},
    {usableWindow:'828400',compactPercent:94.73,percent:95,max:872000},
    {usableWindow:'1001',compactPercent:85.55,percent:95,max:872000},
    {usableWindow:'1001',compactPercent:90,percent:100,max:872000},
    {usableWindow:'800K',compactPercent:95,percent:80,max:1000000},
    {usableWindow:'700K',compactPercent:95,percent:95,max:872000},
    {usableWindow:'700K',compactPercent:90.001,percent:95,max:872000},
    {usableWindow:'828401',compactPercent:90,percent:95,max:872000},
    {usableWindow:'700K',compactPercent:90,percent:0,max:872000},
    {usableWindow:'broken',compactPercent:90,percent:95,max:872000}
  ];
  try{
    fs.writeFileSync(path.join(temp,'main.swift'),`import Foundation\nlet rows=try JSONSerialization.jsonObject(with:FileHandle.standardInput.readDataToEndOfFile()) as! [[String:Any]]\nvar results:[[String:Any]]=[]\nfor row in rows {do {let p=try BudgetMath.preview(usableWindow:BudgetMath.tokens(row["usableWindow"] as! String),compactPercent:row["compactPercent"] as! Double,effectivePercent:row["percent"] as! Int,maximumRawWindow:row["max"] as! Int);results.append(["window":p.rawWindow,"usableWindow":p.usableWindow,"compact":p.compact,"maxCompactPercent":p.maxCompactPercent])}catch{results.append(["error":true])}}\nFileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:results))\n`);
    const binary=path.join(temp,'budget-math');
    const compiled=spawnSync('/usr/bin/xcrun',['swiftc',fileURLToPath(new URL('../macos/Localization.swift',import.meta.url)),fileURLToPath(new URL('../macos/BudgetMath.swift',import.meta.url)),path.join(temp,'main.swift'),'-o',binary],{encoding:'utf8',timeout:30000});
    assert.equal(compiled.status,0,compiled.stderr);
    const result=spawnSync(binary,[],{input:JSON.stringify(cases),encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);
    const expected=cases.map(c=>{try{const b=calculateBudget(c,{max_context_window:c.max,effective_context_window_percent:c.percent});return {window:b.window,usableWindow:b.usableWindow,compact:b.compact,maxCompactPercent:b.maxCompactPercent};}catch{return {error:true};}});
    assert.deepEqual(JSON.parse(result.stdout),expected);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
