import {spawnSync} from 'node:child_process';
const target=`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos14.0`;
for(const [command,args] of [
  ['xcrun',['swiftc','-D','DEBUG','-parse-as-library','-target',target,'macos/Localization.swift','macos/ContextDetails.swift','macos/ContextCharts.swift','macos/TimelineData.swift','macos/TimelineInteraction.swift','macos/MenuDragUpdates.swift','scripts/test-chart-interaction.swift','-o','build/chart-interaction','-framework','SwiftUI','-framework','AppKit']],
  ['build/chart-interaction',[process.argv[2]??'build/chart-fixture.json']]
]){const result=spawnSync(command,args,{stdio:'inherit',timeout:60000});if(result.status!==0)process.exit(result.status||1);}
