import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('native identity migration preserves old window/sidebar preferences and newer choices exactly once',{skip:process.platform!=='darwin',timeout:30000},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ctc-native-prefs-')),source=path.join(dir,'Check.swift'),binary=path.join(dir,'check');
 try{
 fs.writeFileSync(source,String.raw`
import Foundation
@main struct Check{
 static func main(){
  let prefix="io.github.codex-context-control.preference-test."+UUID().uuidString
  let legacy=prefix+".old",current=prefix+".current",empty=prefix+".empty"
  let defaults=UserDefaults(suiteName:current)!
  defer{for name in [legacy,current,empty]{defaults.removePersistentDomain(forName:name)}}
  defaults.setPersistentDomain(["NSWindow Frame ContextControlSettings":"10 20 1000 760","project-sidebar-expanded":"[project-a]","recent-sidebar-expanded":true,"future-field":Data([1,2,3])],forName:legacy)
  defaults.setPersistentDomain(["recent-sidebar-expanded":false,"new-only":17],forName:current)
  ApplicationPreferences.migrate(defaults:defaults,identifier:current,legacy:legacy)
  let migrated=defaults.persistentDomain(forName:current)!
  precondition(migrated["NSWindow Frame ContextControlSettings"] as? String=="10 20 1000 760")
  precondition(migrated["project-sidebar-expanded"] as? String=="[project-a]")
  precondition(migrated["recent-sidebar-expanded"] as? Bool==false && migrated["new-only"] as? Int==17)
  precondition(migrated["future-field"] as? Data==Data([1,2,3]))
  defaults.setPersistentDomain(["project-sidebar-expanded":"changed old value"],forName:legacy)
  ApplicationPreferences.migrate(defaults:defaults,identifier:current,legacy:legacy)
  precondition((defaults.persistentDomain(forName:current)! as NSDictionary).isEqual(to:migrated))
  ApplicationPreferences.migrate(defaults:defaults,identifier:empty,legacy:prefix+".missing")
  precondition(defaults.persistentDomain(forName:empty)?.count==1)
  print("window and sidebar inheritance, existing preferences and idempotency passed")
 }
}
`);
 let r=spawnSync('xcrun',['swiftc','-parse-as-library',fileURLToPath(new URL('../macos/ApplicationPreferences.swift',import.meta.url)),source,'-o',binary],{encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);r=spawnSync(binary,[],{encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stdout+r.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
