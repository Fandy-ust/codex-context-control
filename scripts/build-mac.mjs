import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const repo=fileURLToPath(new URL('../',import.meta.url));const out=path.join(repo,'build/Codex Context Control.app/Contents');
fs.mkdirSync(path.join(out,'MacOS'),{recursive:true});
const target=`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macos14.0`;
const result=spawnSync('xcrun',['swiftc','-parse-as-library','-O','-target',target,path.join(repo,'macos/BudgetMath.swift'),path.join(repo,'macos/ContextControl.swift'),'-o',path.join(out,'MacOS/ContextControl'),'-framework','SwiftUI','-framework','AppKit'],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
const plist=`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>Codex Context Control</string><key>CFBundleDisplayName</key><string>Codex Context Control</string><key>CFBundleIdentifier</key><string>io.github.codex-context-control.panel</string><key>CFBundleExecutable</key><string>ContextControl</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.4.0</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`;
fs.writeFileSync(path.join(out,'Info.plist'),plist);console.log('Built native macOS control panel.');
