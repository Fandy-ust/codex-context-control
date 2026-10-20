import AppKit
import SwiftUI

// Apply the same boundary treatment to every native vertical scroll surface.
struct ScrollEdgeStyle:NSViewRepresentable {
    var depth:CGFloat=14
    func makeNSView(context:Context)->ScrollEdgeProbe {ScrollEdgeProbe(depth:depth)}
    func updateNSView(_ view:ScrollEdgeProbe,context:Context){view.schedule()}
    static func dismantleNSView(_ view:ScrollEdgeProbe,coordinator:()){view.detach()}
}
final class ScrollEdgeGlass:NSVisualEffectView {
    override func hitTest(_ point:NSPoint)->NSView? {nil}
}
final class ScrollEdgeProbe:NSView {
    let depth:CGFloat
    private weak var scroll:NSScrollView?
    private var edges:[ScrollEdgeGlass]=[]
    private var observers:[NSObjectProtocol]=[]
    private var attached=true
    init(depth:CGFloat){self.depth=depth;super.init(frame:.zero)}
    required init?(coder:NSCoder){fatalError("init(coder:) has not been implemented")}
    override func hitTest(_ point:NSPoint)->NSView? {nil}
    override func viewDidMoveToWindow(){super.viewDidMoveToWindow();schedule()}
    override func viewDidMoveToSuperview(){super.viewDidMoveToSuperview();schedule()}
    func schedule(){DispatchQueue.main.async{[weak self] in self?.configure()}}
    private func configure(){
        guard attached,let target=enclosingScrollView else{return}
        if scroll !== target {
            detachViews();scroll=target
            edges=(0..<2).map{_ in let edge=ScrollEdgeGlass();edge.material = .hudWindow;edge.blendingMode = .withinWindow;edge.state = .active;edge.wantsLayer=true;target.addSubview(edge,positioned:.above,relativeTo:nil);return edge}
            target.contentView.postsBoundsChangedNotifications=true
            target.contentView.postsFrameChangedNotifications=true
            for name in [NSView.boundsDidChangeNotification,NSView.frameDidChangeNotification]{observers.append(NotificationCenter.default.addObserver(forName:name,object:target.contentView,queue:.main){[weak self] _ in self?.updateEdges()})}
        }
        updateEdges()
    }
    private func updateEdges(){
        guard let scroll,let document=scroll.documentView,edges.count==2 else{return}
        let clip=scroll.contentView,viewport=scroll.convert(clip.bounds,from:clip),height=min(depth,viewport.height/5)
        let offset=document.isFlipped ? clip.bounds.minY:document.bounds.height-clip.bounds.maxY
        let remaining=document.bounds.height-clip.bounds.height-offset
        for (index,edge) in edges.enumerated(){
            let top=index==0
            edge.isHidden=(top ? offset:remaining)<=1 || !scroll.hasVerticalScroller
            edge.frame=NSRect(x:viewport.minX,y:top ? (scroll.isFlipped ? viewport.minY:viewport.maxY-height):(scroll.isFlipped ? viewport.maxY-height:viewport.minY),width:viewport.width,height:height)
            let mask=CAGradientLayer();mask.frame=edge.bounds;mask.colors=[NSColor.black.cgColor,NSColor.black.withAlphaComponent(0.85).cgColor,NSColor.black.withAlphaComponent(0.3).cgColor,NSColor.clear.cgColor];mask.locations=[0,0.2,0.6,1]
            mask.startPoint=CGPoint(x:0.5,y:top ? 1:0);mask.endPoint=CGPoint(x:0.5,y:top ? 0:1);edge.layer?.mask=mask
        }
    }
    private func detachViews(){for token in observers{NotificationCenter.default.removeObserver(token)};observers=[];for edge in edges{edge.removeFromSuperview()};edges=[];scroll=nil}
    func detach(){attached=false;detachViews()}
}
extension View {
    func softScrollEdges(_ depth:CGFloat=14)->some View {background(ScrollEdgeStyle(depth:depth).frame(width:0,height:0))}
}

// A fixed six-point gutter with a three-point grey track. Keep AppKit's native
// wheel, drag, keyboard and accessibility behavior, without overlay expansion.
final class SidebarScroller:NSScroller {
    override class func scrollerWidth(for controlSize:NSControl.ControlSize,scrollerStyle:NSScroller.Style)->CGFloat {6}
    override class var isCompatibleWithOverlayScrollers:Bool {false}
    override func rect(for partCode:NSScroller.Part)->NSRect {
        let rect=super.rect(for:partCode)
        guard !rect.isEmpty else{return rect}
        switch partCode {
        case .knob,.knobSlot,.decrementPage,.incrementPage:
            return NSRect(x:bounds.minX,y:rect.minY,width:bounds.width,height:rect.height)
        default:return rect
        }
    }
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
