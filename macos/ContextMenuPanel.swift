import AppKit

enum ContextMenuPlacement {
    static func frame(anchor:NSRect,size:NSSize,screen:NSRect)->NSRect {
        let margin:CGFloat=8
        let width=min(size.width,max(1,screen.width-margin*2))
        let top=min(anchor.minY-4,screen.maxY-margin)
        let height=min(size.height,max(1,top-screen.minY-margin))
        let x=max(screen.minX+margin,min(anchor.minX-8,screen.maxX-margin-width))
        let y=max(screen.minY+margin,top-height)
        return NSRect(x:x,y:y,width:width,height:height)
    }
}

@MainActor final class ContextMenuPanel:NSPanel {
    override var canBecomeKey:Bool {true}
    override var canBecomeMain:Bool {false}
}

// NSStatusBarButton does not retain its native pressed background from `state`
// alone. Tracking can also clear highlight after the action returns on mouse-up.
@MainActor final class StatusItemHighlight {
    private weak var button:NSStatusBarButton?
    private let isOpen:()->Bool
    private var lastSelected:Bool?
    init(button:NSStatusBarButton,isOpen:@escaping()->Bool){self.button=button;self.isOpen=isOpen}
    func refresh(){
        apply()
        DispatchQueue.main.async{[weak self] in self?.apply()}
    }
    private func apply(){
        let selected=isOpen()
        button?.state=selected ? .on:.off
        if selected || lastSelected != selected{button?.highlight(selected)}
        lastSelected=selected
    }
}
