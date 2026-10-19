import AppKit
import SwiftUI

// A fixed six-point gutter with a three-point grey track. Keep AppKit's native
// wheel, drag, keyboard and accessibility behavior, without overlay expansion.
final class SidebarScroller:NSScroller {
    override class func scrollerWidth(for controlSize:NSControl.ControlSize,scrollerStyle:NSScroller.Style)->CGFloat {6}
    override class var isCompatibleWithOverlayScrollers:Bool {false}
    override func drawKnobSlot(in slotRect:NSRect,highlight:Bool){
        NSColor(calibratedWhite:0.17,alpha:1).setFill()
        NSBezierPath(roundedRect:NSRect(x:bounds.midX-1.5,y:bounds.minY+2,width:3,height:max(0,bounds.height-4)),xRadius:1.5,yRadius:1.5).fill()
    }
    override func drawKnob(){
        guard isEnabled,knobProportion<1 else{return}
        let knob=rect(for:.knob)
        NSColor(calibratedWhite:0.39,alpha:1).setFill()
        NSBezierPath(roundedRect:NSRect(x:bounds.midX-1.5,y:knob.minY,width:3,height:knob.height),xRadius:1.5,yRadius:1.5).fill()
    }
}

struct SidebarScrollStyle:NSViewRepresentable {
    func makeNSView(context:Context)->SidebarScrollProbe {SidebarScrollProbe()}
    func updateNSView(_ view:SidebarScrollProbe,context:Context){view.scheduleConfiguration()}
    static func dismantleNSView(_ view:SidebarScrollProbe,coordinator:()){view.detach()}
}

final class SidebarScrollProbe:NSView {
    private weak var scroll:NSScrollView?
    private var originalScroller:NSScroller?
    private var originalStyle:NSScroller.Style = .legacy
    private var originalAutohide=true
    private var attached=true
    override func hitTest(_ point:NSPoint)->NSView? {nil}
    override func viewDidMoveToSuperview(){super.viewDidMoveToSuperview();scheduleConfiguration()}
    override func viewDidMoveToWindow(){super.viewDidMoveToWindow();scheduleConfiguration()}
    func scheduleConfiguration(){
        DispatchQueue.main.async{[weak self] in self?.configure()}
    }
    private func configure(){
        guard attached,let target=enclosingScrollView else{return}
        if scroll !== target {
            restore();scroll=target;originalScroller=target.verticalScroller
            originalStyle=target.scrollerStyle;originalAutohide=target.autohidesScrollers
        }
        var changed=false
        if !(target.verticalScroller is SidebarScroller){target.verticalScroller=SidebarScroller();changed=true}
        if target.scrollerStyle != .legacy{target.scrollerStyle = .legacy;changed=true}
        if target.autohidesScrollers{target.autohidesScrollers=false;changed=true}
        if changed{target.tile()}
    }
    private func restore(){
        if let scroll,scroll.verticalScroller is SidebarScroller {
            scroll.verticalScroller=originalScroller;scroll.scrollerStyle=originalStyle;scroll.autohidesScrollers=originalAutohide
        }
        scroll=nil;originalScroller=nil
    }
    func detach(){attached=false;restore()}
}
