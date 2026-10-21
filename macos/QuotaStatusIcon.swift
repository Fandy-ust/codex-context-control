import AppKit

@MainActor func quotaBarsStatusImage(bucket:QuotaBucket?,stale:Bool)->NSImage {

    let remaining=[bucket?.primary,bucket?.secondary].compactMap{$0?.remainingPercent}.filter{$0.isFinite}.min().map{max(0,min(1,$0/100))}
    let image=NSImage(size:NSSize(width:44,height:24));image.lockFocus()
    let opacity:CGFloat=remaining == nil ? 0.75:stale ? 0.65:1
    let bolt=NSBezierPath();bolt.move(to:NSPoint(x:18,y:23));bolt.line(to:NSPoint(x:2,y:10));bolt.line(to:NSPoint(x:10,y:10));bolt.line(to:NSPoint(x:5,y:0));bolt.line(to:NSPoint(x:23,y:14));bolt.line(to:NSPoint(x:14,y:14));bolt.close()
    for x:CGFloat in [1,4.2,7.4,10.6,13.8,17,20.2] {
        let strip=NSBezierPath(rect:NSRect(x:x,y:0,width:2.7,height:24))
        NSGraphicsContext.saveGraphicsState();strip.addClip()
        NSGraphicsContext.saveGraphicsState()
        bolt.lineWidth=0.7;NSColor.black.withAlphaComponent(opacity*(remaining == nil ? 0.9:0.45)).setStroke();bolt.stroke()
        bolt.addClip();strip.lineWidth=0.6;strip.stroke()
        NSGraphicsContext.restoreGraphicsState();bolt.addClip()
        if let remaining,remaining>0{NSColor.black.withAlphaComponent(opacity).setFill();NSBezierPath(rect:NSRect(x:x,y:0,width:2.7,height:24*remaining)).fill()}
        NSGraphicsContext.restoreGraphicsState()
    }
    let label=remaining.map{String(format:"%.0f%%",$0*100)} ?? "—"
    let font=NSFont.monospacedDigitSystemFont(ofSize:9,weight:.semibold)
    let attributes:[NSAttributedString.Key:Any]=[.font:font,.foregroundColor:NSColor.black]
    let text=label as NSString,measured=text.size(withAttributes:attributes)
    let x:CGFloat=21.5+(22-measured.width)/2
    text.draw(at:NSPoint(x:x,y:0.5),withAttributes:[.font:font,.foregroundColor:NSColor.black.withAlphaComponent(opacity)])
    image.unlockFocus();image.isTemplate=true;return image
}

