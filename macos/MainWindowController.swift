import SwiftUI
import AppKit

/// Closing or hiding the main window never disposes the menu-bar entry.
@MainActor final class MainWindowController:NSObject,NSWindowDelegate {
    private let model:Controller
    private(set) var window:NSWindow?
    var onVisibilityChanged:((Bool)->Void)?
    init(model:Controller){self.model=model}
    var isVisible:Bool{window.map{$0.isVisible && !$0.isMiniaturized} ?? false}
    var isActivelyVisible:Bool{isVisible && window?.occlusionState.contains(.visible)==true}
    func show(){
        if window==nil{
            let next=NSWindow(contentRect:NSRect(x:0,y:0,width:1040,height:760),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
            next.title="Context Manager";next.minSize=NSSize(width:960,height:700)
            next.titleVisibility = .visible;next.titlebarAppearsTransparent=false
            next.appearance=NSAppearance(named:.darkAqua);next.backgroundColor=NSColor(white:0.095,alpha:1)
            next.contentView=NSHostingView(rootView:ContentView(model:model));next.isReleasedWhenClosed=false
            next.delegate=self;next.center();next.setFrameAutosaveName("ContextControlSettings");window=next
        }
        window?.deminiaturize(nil);window?.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps:true);onVisibilityChanged?(true)
    }
    func toggle(){if isVisible && window?.isKeyWindow==true{hide()}else{show()}}
    func hide(){window?.orderOut(nil);onVisibilityChanged?(false)}
    func windowWillClose(_ notification:Notification){onVisibilityChanged?(false)}
    func windowDidMiniaturize(_ notification:Notification){onVisibilityChanged?(false)}
    func windowDidDeminiaturize(_ notification:Notification){onVisibilityChanged?(true)}
}
