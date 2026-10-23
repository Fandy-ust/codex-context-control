import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const repo='Fandy-ust/codex-context-control';
const args=new Set(process.argv.slice(2));
for(const arg of args)if(!['--archive','--apply'].includes(arg))throw Error('Usage: node scripts/maintain-releases.mjs [--archive] [--apply]');
const gh=(...args)=>execFileSync('gh',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
const releases=JSON.parse(gh('api','--paginate','--slurp',`repos/${repo}/releases?per_page=100`)).flat();
const latest=JSON.parse(gh('api',`repos/${repo}/releases/latest`)).tag_name;
const keep=new Set([latest,'v0.23.5-preview.1','v0.19.6-preview.1','v0.16.2-preview.1','demo-2026-10-17']);
const recent=releases.filter(r=>!r.draft&&!r.prerelease&&/^v\d+\.\d+\.\d+/.test(r.tag_name)).sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)).slice(0,5);
for(const r of recent)keep.add(r.tag_name);
// Protect concrete installer/release links from the public entry-point guides.
for(const file of ['README.md','README.zh-CN.md','docs/INSTALL_WINDOWS.md','docs/INSTALL_MAC.md','docs/en/INSTALL_WINDOWS.md','docs/en/INSTALL_MAC.md']){
 const text=fs.readFileSync(path.join(root,file),'utf8');
 for(const m of text.matchAll(/github\.com\/Fandy-ust\/codex-context-control\/releases\/(?:tag|download)\/([^/\s)]+)/g))keep.add(m[1]);
}
const remove=releases.filter(r=>!keep.has(r.tag_name));
const size=items=>items.reduce((n,r)=>n+r.assets.reduce((s,a)=>s+a.size,0),0);
const plan={repository:repo,latest,keep:releases.filter(r=>keep.has(r.tag_name)).map(r=>r.tag_name),remove:remove.map(r=>({tag:r.tag_name,draft:r.draft})),before:{releases:releases.length,bytes:size(releases)},after:{releases:releases.length-remove.length,bytes:size(releases.filter(r=>keep.has(r.tag_name)))}};
console.log(JSON.stringify(plan,null,2));

if(args.has('--archive')||args.has('--apply')){
 const backups=path.join(root,'build/release-backups');fs.mkdirSync(backups,{recursive:true});
 const backupFile=path.join(backups,new Date().toISOString().replace(/[:.]/g,'-')+'.json');
 const receipt={plan,releases,deleted:[]};fs.writeFileSync(backupFile,JSON.stringify(receipt,null,2)+'\n');
 const directory=path.join(root,'docs/releases/archive');fs.mkdirSync(directory,{recursive:true});
 const manifest=path.join(directory,'index.json');let entries=[];
 if(fs.existsSync(manifest))entries=JSON.parse(fs.readFileSync(manifest,'utf8')).releases;
 const all=new Map(entries.map(r=>[r.tag,r]));
 for(const r of remove.filter(r=>!r.draft)){
  const entry={tag:r.tag_name,name:r.name,publishedAt:r.published_at,source:`https://github.com/${repo}/tree/${r.tag_name}`,body:r.body??'',assets:r.assets.map(a=>({name:a.name,size:a.size,digest:a.digest??null}))};
  all.set(entry.tag,entry);
  fs.writeFileSync(path.join(directory,entry.tag+'.md'),`# ${entry.name}\n\nPublished: ${entry.publishedAt}\n\n> Historical release notes only. These installers were retired during release maintenance. Use the [latest release](https://github.com/${repo}/releases/latest) for downloads. Original download links below may no longer work.\n\n[Preserved source tag](${entry.source})\n\n## Original release notes\n\n${entry.body}\n`);
 }
 entries=[...all.values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
 fs.writeFileSync(manifest,JSON.stringify({repository:repo,releases:entries},null,2)+'\n');
 fs.writeFileSync(path.join(directory,'index.md'),`# 历史发布说明 / Historical release notes\n\n旧安装包已清理；Git 标签与发布说明继续保留。/ Retired installers are removed; source tags and release notes remain available.\n\n[当前下载 / Latest downloads](https://github.com/${repo}/releases/latest) · [版本保留规则 / Retention policy](../../RELEASE_POLICY.md)\n\n## 保留的下载版本 / Retained downloads\n\n${plan.keep.map(tag=>`- [${tag}](https://github.com/${repo}/releases/tag/${tag})`).join('\n')}\n\n## 已归档 / Archived\n\n| Version | Published (UTC) | Source |\n| --- | --- | --- |\n${entries.map(r=>`| [${r.tag}](${r.tag}.md) | ${r.publishedAt.slice(0,10)} | [tag](${r.source}) |`).join('\n')}\n`);
 console.log('Release metadata backup: '+backupFile);
 if(args.has('--apply')){
  const currentLatest=JSON.parse(gh('api',`repos/${repo}/releases/latest`)).tag_name;
  if(currentLatest!==latest)throw Error('Latest release changed; rerun the plan before deleting anything.');
  for(const r of remove){
   gh('release','delete',r.tag_name,'--yes','--repo',repo); // Deliberately omit --cleanup-tag.
   receipt.deleted.push(r.tag_name);fs.writeFileSync(backupFile,JSON.stringify(receipt,null,2)+'\n');
   console.log('Removed release; tag preserved: '+r.tag_name);
  }
 }
}
