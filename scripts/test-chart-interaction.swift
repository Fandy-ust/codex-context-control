import AppKit
import SwiftUI
@MainActor final class Controller:ObservableObject {
    func api(_ path:String,body:[String:Any]) async throws -> Data {throw CocoaError(.fileReadUnknown)}
}
@main @MainActor struct ChartInteractionSmoke {
    static func main() throws {
        let stats=try JSONDecoder().decode(ContextStatistics.self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))
        let app=NSApplication.shared;app.setActivationPolicy(.prohibited)
        let view=NSHostingView(rootView:ContextResponseChart(responses:stats.responses,events:stats.timelineEvents,revision:stats.generatedAt).equatable().padding(20).frame(width:900).preferredColorScheme(.dark))
        let window=NSWindow(contentRect:NSRect(x:0,y:0,width:900,height:750),styleMask:[.borderless],backing:.buffered,defer:false);window.contentView=view;window.display()
        Task{@MainActor in
            try? await Task.sleep(for:.seconds(1))
            let before=ChartInteractionProbe.chartBuilds
            let positions=stats.responses.suffix(100).map(\.position)
            for position in positions{ChartInteractionProbe.hover(position);try? await Task.sleep(for:.milliseconds(2))}
            if let first=stats.responses.first {ChartInteractionProbe.pin(first.id);precondition(ChartInteractionProbe.selectedID==first.id)}
            try? await Task.sleep(for:.milliseconds(100))
            let after=ChartInteractionProbe.chartBuilds
            precondition(before>0&&after==before,"Hover rebuilt the chart body: \(before) -> \(after)")
            print("\(positions.count) hover selections and pin passed; chart body builds stayed at \(after).")
            app.terminate(nil)
        }
        app.run()
    }
}
