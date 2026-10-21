import AppKit

/// Owns the menu-bar entry independently of windows, service requests and hotkeys.
/// Rendering is committed only after a real button has received a valid image.
@MainActor final class StatusItemController:NSObject {
    private let statusBar:NSStatusBar
    private let renderer:(QuotaBucket?,Bool)->NSImage?
    private let onClick:()->Void
    private(set) var item:NSStatusItem?
    private var highlight:StatusItemHighlight?
    private var running=false
    private var bucket:QuotaBucket?
    private var stale=true
    private var tooltip="Context Manager"
    private var renderedBucket:QuotaBucket?
    private var renderedStale:Bool?
    private var renderedButton:ObjectIdentifier?
    private var rendered=false
    private var workspaceObservers:[NSObjectProtocol]=[]
    private var appObservers:[NSObjectProtocol]=[]
    private(set) var repairs=0
    private(set) var imageSource="pending"
    var isMenuOpen:()->Bool = {false}
    var beforeRebuild:(()->Void)?
    var onChange:(()->Void)?
    var button:NSStatusBarButton?{item?.button}
    init(statusBar:NSStatusBar = .system,renderer:((QuotaBucket?,Bool)->NSImage?)? = nil,onClick:@escaping()->Void){
        self.statusBar=statusBar;self.renderer=renderer ?? {quotaBarsStatusImage(bucket:$0,stale:$1)};self.onClick=onClick
        super.init()
    }
    func start(){
        guard !running else{repair();return}
        running=true
        install()
        let center=NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didWakeNotification,NSWorkspace.sessionDidBecomeActiveNotification]{
            workspaceObservers.append(center.addObserver(forName:name,object:nil,queue:.main){[weak self] _ in Task{@MainActor [weak self] in self?.repair()}})
        }
        appObservers.append(NotificationCenter.default.addObserver(forName:NSApplication.didChangeScreenParametersNotification,object:nil,queue:.main){[weak self] _ in Task{@MainActor [weak self] in self?.repair()}})
    }
    func update(bucket:QuotaBucket?,stale:Bool,tooltip:String){
        self.bucket=bucket;self.stale=stale;self.tooltip=tooltip
        guard running else{return}
        if item?.button==nil{repair(rebuild:true);return}
        drawIfNeeded()
    }
    func repair(rebuild:Bool=false){
        guard running else{return}
        if rebuild || item?.button==nil {
            beforeRebuild?()
            if let item{statusBar.removeStatusItem(item)}
            item=nil;highlight=nil;repairs+=1;install()
        }else{rendered=false;drawIfNeeded()}
        onChange?()
    }
    private func install(){
        guard running else{return}
        if item==nil{
            let entry=statusBar.statusItem(withLength:44)
            entry.autosaveName="ContextManager.Quota"
            entry.behavior=[]
            item=entry
        }
        rendered=false;drawIfNeeded()
    }
    private func drawIfNeeded(){
        guard let item,let button=item.button else{return}
        let changed=renderedButton != ObjectIdentifier(button)
        let damaged=button.image?.isValid != true || button.isHidden || button.alphaValue<1 || !item.isVisible
        if changed{
            button.imagePosition = .imageOnly;button.imageScaling = .scaleProportionallyDown
            button.setButtonType(.pushOnPushOff);button.target=self;button.action=#selector(clicked)
            highlight=StatusItemHighlight(button:button,isOpen:{[weak self] in self?.isMenuOpen()==true})
        }
        if !rendered || changed || damaged || renderedBucket != bucket || renderedStale != stale{
            let proposed=renderer(bucket,stale)
            let valid=proposed?.isValid==true && (proposed?.size.width ?? 0)>0 && (proposed?.size.height ?? 0)>0
            let image=valid ? proposed:NSImage(systemSymbolName:"bolt.fill",accessibilityDescription:"Context Manager")
            image?.isTemplate=true;button.image=image
            button.title=image==nil ? "⚡":""
            button.isHidden=false;button.alphaValue=1;item.isVisible=true
            imageSource=valid ? "quota":image==nil ? "text":"fallback"
            rendered=valid;renderedBucket=bucket;renderedStale=stale;renderedButton=ObjectIdentifier(button)
            if damaged && !changed{repairs+=1}
        }
        button.toolTip=tooltip;button.setAccessibilityLabel(tooltip);highlight?.refresh()
    }
    func refreshHighlight(){highlight?.refresh()}
    @objc private func clicked(){onClick()}
    var diagnostics:[String:Any]{
        let window=button?.window,frame=window?.frame ?? .zero
        let drawable=button?.image?.isValid==true || !(button?.title.isEmpty ?? true)
        let placed=Self.isInMenuBar(frame,screens:NSScreen.screens.map{$0.frame},thickness:statusBar.thickness)
        return ["menuReady":running && item?.isVisible==true && drawable && button?.isHidden==false,
                "menuImageReady":drawable,"menuImageSource":imageSource,"menuRepairs":repairs,
                "menuWindowVisible":window?.isVisible==true,"menuOnScreen":NSNull(),
                "menuWindowAtScreenTop":placed,"menuVisibilityEvidence":"unverified",
                "menuScreens":NSScreen.screens.map{["x":$0.frame.minX,"y":$0.frame.minY,"width":$0.frame.width,"height":$0.frame.height]},
                "menuFrame":["x":frame.origin.x,"y":frame.origin.y,"width":frame.width,"height":frame.height],
                "statusTitle":button?.title ?? ""]
    }
    // Geometry is diagnostic only: hosted status items can report coordinates
    // outside NSScreen, and isVisible stays true when macOS blocks the host.
    static func isInMenuBar(_ frame:NSRect,screens:[NSRect],thickness:CGFloat)->Bool{
        guard frame.width>0,frame.height>0 else{return false}
        return screens.contains{screen in
            frame.minX>=screen.minX && frame.maxX<=screen.maxX &&
            abs(frame.maxY-screen.maxY)<=2 && frame.height<=max(thickness,40)+2
        }
    }
    func stop(){
        running=false
        workspaceObservers.forEach{NSWorkspace.shared.notificationCenter.removeObserver($0)};workspaceObservers=[]
        appObservers.forEach{NotificationCenter.default.removeObserver($0)};appObservers=[]
        if let item{statusBar.removeStatusItem(item)}
        item=nil;highlight=nil;rendered=false;renderedButton=nil;imageSource="stopped"
    }
}
