import SwiftUI
import AppKit

// Let NSApplicationMain initialize AppKit before creating NSApplication or its
// delegate. A manual shared/run entry skips part of the application check-in.
@objc(ContextControlApplication) @MainActor final class ContextControlApplication:NSApplication {
    private var controllerDelegate:ContextControlApp?
    override init(){
        super.init()
        if Bundle.main.bundleIdentifier==ApplicationPreferences.productID{ApplicationPreferences.migrate()}
        let owner=ContextControlApp();controllerDelegate=owner;delegate=owner
    }
    required init?(coder:NSCoder){fatalError("ContextControlApplication uses programmatic initialization")}
}

@main @MainActor final class ContextControlApp:NSObject,NSApplicationDelegate,NSWindowDelegate {
    private let model=Controller()
    private lazy var statusController=StatusItemController{[weak self] in self?.toggleContextPopover()}
    private lazy var mainWindow=MainWindowController(model:model)
    private var started=false
    private var shortcutManager:GlobalShortcutManager?
    private var refreshTask:Task<Void,Never>?
    private var refreshTimer:Timer?
    private var refreshInProgress=false
    private var refreshPending=false
    private var lastServiceStart=Date.distantPast
    private var serviceStarter:Process?
    private var menuPanel:ContextMenuPanel?
    private var localMenuMonitor:Any?
    private var globalMenuMonitor:Any?
    private let background=CommandLine.arguments.contains("--background")
    private var lastStatus:Data?
    private var languageObservers:[NSObjectProtocol]=[]

    static func main(){
        _ = NSApplicationMain(CommandLine.argc,CommandLine.unsafeArgv)
    }
    func applicationDidFinishLaunching(_ notification:Notification){
        guard !started else{return};started=true
        statusController.isMenuOpen={[weak self] in self?.menuPanel?.isVisible==true}
        statusController.beforeRebuild={[weak self] in self?.closeContextMenu()}
        statusController.onChange={[weak self] in self?.publishStatus()}
        mainWindow.onVisibilityChanged={[weak self] visible in self?.publishStatus(windowVisible:visible)}
        statusController.start()
        updateStatusIcon()
        startLocalService()
        model.loadGlobalShortcutSettings()
        let hotKeyManager=GlobalShortcutManager{[weak self] in self?.toggleMainWindow()}
        shortcutManager=hotKeyManager
        model.onGlobalShortcutChange={[weak self] key,enabled in self?.shortcutManager?.configure(key,enabled:enabled) ?? (false,L("无法注册系统快捷键"))}
        model.onGlobalShortcutRecording={[weak self] recording in
            guard let self,let result=self.shortcutManager?.suspend(recording) else{return}
            self.model.globalShortcutRegistered=result.registered;self.model.globalShortcutError=result.error
        }
        let shortcutStatus=hotKeyManager.configure(model.globalShortcut,enabled:model.globalShortcutEnabled)
        model.globalShortcutRegistered=shortcutStatus.registered;model.globalShortcutError=shortcutStatus.error
        installMainMenu()
        for name in [Localization.didChange,Notification.Name.NSSystemTimeZoneDidChange]{
            languageObservers.append(NotificationCenter.default.addObserver(forName:name,object:nil,queue:.main){[weak self] _ in
                Task{@MainActor [weak self] in self?.installMainMenu();self?.updateStatusIcon()}
            })
        }
        if !background{showSettings()}
        publishStatus()
        refreshNow()
    }
    private func refreshNow(){
        guard started else{return}
        refreshTimer?.invalidate();refreshTimer=nil
        if refreshInProgress{refreshPending=true;return}
        refreshInProgress=true
        refreshTask=Task{[weak self] in
            guard let self else{return}
            await model.refresh()
            guard !Task.isCancelled else{refreshInProgress=false;return}
            updateStatusIcon()
            if menuPanel?.isVisible==true,!model.menuDragInProgress,NSEvent.pressedMouseButtons==0{positionContextMenu()}
            publishStatus()
            if !model.serviceAvailable && Date().timeIntervalSince(lastServiceStart)>=15{startLocalService()}
            refreshInProgress=false
            if refreshPending{refreshPending=false;refreshNow();return}
            let visible=mainWindow.isActivelyVisible
            let delay=RefreshSchedule.interval(menuVisible:menuPanel?.isVisible==true,settingsVisible:visible,runningChats:model.runningChats.count,connected:model.bridgeCount>0,serviceAvailable:model.serviceAvailable)
            let timer=Timer(timeInterval:delay,repeats:false){[weak self] _ in Task{@MainActor [weak self] in self?.refreshNow()}}
            timer.tolerance=RefreshSchedule.tolerance(for:delay);refreshTimer=timer;RunLoop.main.add(timer,forMode:.common)
        }
    }
    func applicationDidBecomeActive(_ notification:Notification){refreshNow()}
    private func updateStatusIcon(){
        let quotaSummary=model.selectedQuota.map{bucket in [bucket.primary,bucket.secondary].compactMap{$0}.map{L("{0}剩余 {1}%",quotaPeriod($0),Int($0.remainingPercent.rounded()))}.joined(separator:" · ")} ?? L("额度暂不可用")
        let quotaStale = !model.serviceAvailable || model.quota?.presentationStale != false
        let quotaTooltip=quotaStale ? L("上次记录，待刷新")+" · "+quotaSummary:quotaSummary
        let busiest=model.busiestContext
        let summary=model.runningChats.isEmpty ? (model.serviceAvailable ? L("暂无运行中的聊天"):L("等待连接")) : L("{0} 个运行中 · {1}", model.runningChats.count, busiest.map{L("最高占用 {0}", $0.contextPercentage)} ?? L("等待用量读回"))
        statusController.update(bucket:model.selectedQuota,stale:quotaStale,tooltip:L("Codex 额度 · {0}",quotaTooltip)+"\nContext Manager · \(summary)")
    }
    @objc private func toggleContextPopover(){
        refreshNow()
        if menuPanel?.isVisible==true{closeContextMenu();return}
        guard statusController.button != nil else{return}
        Task{await model.refreshQuota();updateStatusIcon()}
        if menuPanel==nil{
            let panel=ContextMenuPanel(contentRect:.zero,styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
            panel.isReleasedWhenClosed=false;panel.isFloatingPanel=true;panel.hidesOnDeactivate=false;panel.delegate=self
            panel.level = .popUpMenu;panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary]
            panel.backgroundColor = .clear;panel.isOpaque=false;panel.hasShadow=true;panel.animationBehavior = .none
            menuPanel=panel
        }
        let backdrop=NSVisualEffectView();backdrop.material = .popover;backdrop.blendingMode = .behindWindow;backdrop.state = .active
        backdrop.wantsLayer=true;backdrop.layer?.cornerRadius=12;backdrop.layer?.masksToBounds=true
        let host=NSHostingView(rootView:ContextMenuView(model:model,openChat:{[weak self] id in
            guard let self else{return};self.model.selectedID=id;self.model.fill();self.showSettings()
        },openSettings:{[weak self] in self?.showSettings()},quit:{[weak self] in self?.quitEntry()}))
        host.sizingOptions=[]
        host.translatesAutoresizingMaskIntoConstraints=false;backdrop.addSubview(host)
        NSLayoutConstraint.activate([host.leadingAnchor.constraint(equalTo:backdrop.leadingAnchor),host.trailingAnchor.constraint(equalTo:backdrop.trailingAnchor),host.topAnchor.constraint(equalTo:backdrop.topAnchor),host.bottomAnchor.constraint(equalTo:backdrop.bottomAnchor)])
        menuPanel?.contentView=backdrop;positionContextMenu();menuPanel?.orderFrontRegardless();menuPanel?.makeKey()
        statusController.refreshHighlight()
        localMenuMonitor=NSEvent.addLocalMonitorForEvents(matching:[.leftMouseDown,.rightMouseDown,.keyDown]){[weak self] event in
            guard let self,self.menuPanel?.isVisible==true else{return event}
            if event.type == .keyDown{if event.keyCode==53{self.closeContextMenu();return nil};return event}
            if event.window !== self.menuPanel && event.window !== self.statusController.button?.window{self.closeContextMenu()}
            return event
        }
        globalMenuMonitor=NSEvent.addGlobalMonitorForEvents(matching:[.leftMouseDown,.rightMouseDown]){[weak self] _ in Task{@MainActor in
            guard let self else{return}
            if let button=self.statusController.button,let window=button.window,window.convertToScreen(button.convert(button.bounds,to:nil)).contains(NSEvent.mouseLocation){return}
            self.closeContextMenu()
        }}
    }
    private func positionContextMenu(){
        guard let button=statusController.button,let window=button.window,let screen=window.screen ?? NSScreen.main else{return}
        let anchor=window.convertToScreen(button.convert(button.bounds,to:nil))
        let heightLimit=max(1,min(560,min(anchor.minY-4,screen.visibleFrame.maxY-8)-screen.visibleFrame.minY-8))
        if model.menuHeightLimit != heightLimit{model.menuHeightLimit=heightLimit}
        let frame=ContextMenuPlacement.frame(anchor:anchor,size:NSSize(width:400,height:model.contextMenuHeight),screen:screen.visibleFrame)
        if menuPanel?.frame != frame{menuPanel?.setFrame(frame,display:true)}
    }
    private func closeContextMenu(){
        model.menuDragInProgress=false
        menuPanel?.orderOut(nil);menuPanel?.contentView=nil
        statusController.refreshHighlight()
        if let localMenuMonitor{NSEvent.removeMonitor(localMenuMonitor);self.localMenuMonitor=nil}
        if let globalMenuMonitor{NSEvent.removeMonitor(globalMenuMonitor);self.globalMenuMonitor=nil}
    }
    private func startLocalService(){
        lastServiceStart=Date()
        // The app itself stays the native CFBundleExecutable. Starting Node
        // from a shell entrypoint prevents reliable Launch Services attribution.
        guard let data=try? Data(contentsOf:model.home.appendingPathComponent("settings.json")),
              let settings=try? JSONDecoder().decode(ServiceSettings.self,from:data) else{return}
        let cli=model.home.appendingPathComponent("code/src/cli.mjs")
        guard FileManager.default.fileExists(atPath:cli.path) else{return}
        let process=Process();process.executableURL=URL(fileURLWithPath:settings.node)
        process.arguments=[cli.path,"start"];process.standardOutput=FileHandle.nullDevice;process.standardError=FileHandle.nullDevice
        do{try process.run();serviceStarter=process}catch{model.notice=L("无法启动本地服务：{0}", error.localizedDescription)}
    }
    private func installMainMenu(){
        let bar=NSMenu(),appItem=NSMenuItem(),appMenu=NSMenu()
        let openItem=appMenu.addItem(withTitle:L("打开主窗口"),action:#selector(showSettings),keyEquivalent:"")
        openItem.target=self
        appMenu.addItem(withTitle:L("恢复菜单栏入口"),action:#selector(restoreStatusItem),keyEquivalent:"").target=self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle:L("退出 Context Manager"),action:#selector(quitEntry),keyEquivalent:"q").target=self
        appItem.submenu=appMenu;bar.addItem(appItem)
        let editItem=NSMenuItem(title:L("编辑"),action:nil,keyEquivalent:""),edit=NSMenu(title:L("编辑"))
        for (title,action,key) in [(L("撤销"),"undo:","z"),(L("重做"),"redo:","Z"),(L("剪切"),"cut:","x"),(L("复制"),"copy:","c"),(L("粘贴"),"paste:","v"),(L("全选"),"selectAll:","a")]{edit.addItem(withTitle:title,action:Selector(action),keyEquivalent:key)}
        editItem.submenu=edit;bar.addItem(editItem);NSApplication.shared.mainMenu=bar
    }
    @objc private func showSettings(){closeContextMenu();mainWindow.show();refreshNow()}
    private func toggleMainWindow(){closeContextMenu();mainWindow.toggle();refreshNow()}
    @objc private func restoreStatusItem(){statusController.repair(rebuild:true);updateStatusIcon();publishStatus()}
    @objc private func openCodex(){model.launchCodex()}
    @objc private func quitEntry(){NSApplication.shared.terminate(nil)}
    func applicationShouldHandleReopen(_ sender:NSApplication,hasVisibleWindows:Bool)->Bool{restoreStatusItem();showSettings();return false}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool{false}
    func windowDidResignKey(_ notification:Notification){
        guard notification.object as? NSWindow === menuPanel else{return}
        DispatchQueue.main.async{[weak self] in if self?.menuPanel?.isKeyWindow==false{self?.closeContextMenu()}}
    }
    private func publishStatus(windowVisible:Bool?=nil){
        guard started else{return}
        var state=statusController.diagnostics
        state.merge(["quotaIntegrated":true,"pid":ProcessInfo.processInfo.processIdentifier,"bundleIdentifier":Bundle.main.bundleIdentifier ?? "","windowVisible":windowVisible ?? mainWindow.isVisible,"bridgeCount":model.bridgeCount,"startedInBackground":background,"runningChats":model.runningChats.count,"highestContextPercent":model.busiestContext?.contextFraction.map{Int(($0*100).rounded())} as Any? ?? NSNull()],uniquingKeysWith:{$1})
        guard let data=try? JSONSerialization.data(withJSONObject:state,options:.sortedKeys),data != lastStatus else{return}
        do {
            try FileManager.default.createDirectory(at:model.home,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            let url=model.home.appendingPathComponent("ui-status.json");try data.write(to:url,options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path);lastStatus=data
        }catch{}
    }
    func applicationWillTerminate(_ notification:Notification){started=false;closeContextMenu();statusController.stop();refreshTimer?.invalidate();refreshTask?.cancel();shortcutManager?.dispose();try? FileManager.default.removeItem(at:model.home.appendingPathComponent("ui-status.json"))}
}
