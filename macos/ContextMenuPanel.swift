import AppKit

enum ContextMenuPlacement {
    static func frame(anchor:NSRect,size:NSSize,screen:NSRect)->NSRect {
        let margin:CGFloat=8
        let width=min(size.width,max(1,screen.width-margin*2))
        let top=min(anchor.minY-4,screen.maxY-margin)
        let height=min(size.height,max(1,top-screen.minY-margin))
        let x=max(screen.minX+margin,min(anchor.minX,screen.maxX-margin-width))
        let y=max(screen.minY+margin,top-height)
        return NSRect(x:x,y:y,width:width,height:height)
    }
}

@MainActor final class ContextMenuPanel:NSPanel {
    override var canBecomeKey:Bool {true}
    override var canBecomeMain:Bool {false}
}
