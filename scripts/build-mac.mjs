import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const repo=fileURLToPath(new URL('../',import.meta.url));const out=path.join(repo,'build/Codex Context Control.app/Contents');
const version=JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).version;
fs.rmSync(path.dirname(out),{recursive:true,force:true});
fs.mkdirSync(path.join(out,'MacOS'),{recursive:true});
const target=`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos14.0`;
const result=spawnSync('xcrun',['swiftc','-parse-as-library','-O','-target',target,path.join(repo,'macos/BudgetMath.swift'),path.join(repo,'macos/MaxContextFlow.swift'),path.join(repo,'macos/NewChatDefaults.swift'),path.join(repo,'macos/ContextDetails.swift'),path.join(repo,'macos/ContextCharts.swift'),path.join(repo,'macos/ContextControl.swift'),path.join(repo,'macos/ContextMenu.swift'),path.join(repo,'macos/MenuBudget.swift'),path.join(repo,'macos/ContextMenuPanel.swift'),path.join(repo,'macos/MenuDragUpdates.swift'),path.join(repo,'macos/MenuHoverSelection.swift'),'-o',path.join(out,'MacOS/ContextControl'),'-framework','SwiftUI','-framework','AppKit'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>Context Manager</string><key>CFBundleDisplayName</key><string>Context Manager</string><key>CFBundleIdentifier</key><string>io.github.codex-context-control.panel</string><key>CFBundleExecutable</key><string>ContextControl</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`;
fs.writeFileSync(path.join(out,'Info.plist'),plist);
const signed=spawnSync('/usr/bin/codesign',['--force','--sign','-',path.dirname(out)],{stdio:'inherit'});
if(signed.status!==0)process.exit(signed.status||1);
console.log('Built and locally signed native macOS control panel.');
