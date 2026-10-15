// Offline native chart smoke test. Compiled with ContextDetails and ContextCharts.
import AppKit
import SwiftUI

@MainActor final class Controller:ObservableObject {
    func api(_ path:String,body:[String:Any]) async throws -> Data {throw CocoaError(.fileReadUnknown)}
}
@main @MainActor struct ChartSmoke {
    static func main() throws {
        let arguments=CommandLine.arguments
        guard arguments.count==3 else{fatalError("Usage: chart-smoke aggregate.json output.png")}
        let stats=try JSONDecoder().decode(ContextStatistics.self,from:Data(contentsOf:URL(fileURLWithPath:arguments[1])))
        let app=NSApplication.shared;app.setActivationPolicy(.prohibited)
        let view=NSHostingView(rootView:VStack(alignment:.leading,spacing:16){ContextSummaryView(statistics:stats);ContextResponseChart(responses:stats.responses,events:stats.timelineEvents,revision:stats.threadId+":"+stats.generatedAt).equatable()}.padding(24).frame(width:900).background(Color(white:0.095)).preferredColorScheme(.dark))
        let window=NSWindow(contentRect:NSRect(x:0,y:0,width:900,height:1220),styleMask:[.borderless],backing:.buffered,defer:false)
        window.contentView=view;window.display()
        DispatchQueue.main.asyncAfter(deadline:.now()+2){
            view.layoutSubtreeIfNeeded();view.display()
            guard let bitmap=view.bitmapImageRepForCachingDisplay(in:view.bounds) else{fatalError("No bitmap")}
            view.cacheDisplay(in:view.bounds,to:bitmap)
            do {try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:arguments[2]))}catch{fatalError("Cannot write image")}
            app.terminate(nil)
        }
        app.run()
    }
}
