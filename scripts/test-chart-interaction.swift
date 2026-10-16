import AppKit
import SwiftUI
@MainActor final class Controller:ObservableObject {
    func api(_ path:String,body:[String:Any]) async throws -> Data {throw CocoaError(.fileReadUnknown)}
}
@main @MainActor struct ChartInteractionSmoke {
    static func main() throws {
        let stats=try JSONDecoder().decode(ContextStatistics.self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))
        let app=NSApplication.shared;app.setActivationPolicy(.prohibited)
        let started=CFAbsoluteTimeGetCurrent()
        let view=NSHostingView(rootView:ContextResponseChart(responses:stats.responses,events:stats.timelineEvents,revision:stats.generatedAt).equatable().padding(20).frame(width:900).preferredColorScheme(.dark))
        let window=NSWindow(contentRect:NSRect(x:0,y:0,width:900,height:750),styleMask:[.borderless],backing:.buffered,defer:false);window.contentView=view;window.display()
        Task{@MainActor in
            for _ in 0..<1000{if ChartInteractionProbe.chartBuilds>0{break};try? await Task.sleep(for:.milliseconds(10))}
            try? await Task.sleep(for:.milliseconds(150))
            let readyMs=(CFAbsoluteTimeGetCurrent()-started)*1000
            precondition(ChartInteractionProbe.bucketCount<=120,"Unbounded chart marks")
            precondition(ChartInteractionProbe.period==0,"Smoothing must start disabled")
            let before=ChartInteractionProbe.chartBuilds
            let positions=stats.responses.suffix(100).map(\.position)
            var latencies:[Double]=[]
            for _ in 0..<5{for position in positions{let start=CFAbsoluteTimeGetCurrent();ChartInteractionProbe.hover(position);try? await Task.sleep(for:.milliseconds(2));latencies.append((CFAbsoluteTimeGetCurrent()-start)*1000)}}
            if let first=stats.responses.first {ChartInteractionProbe.pin(first.id);precondition(ChartInteractionProbe.selectedID==first.id)}
            try? await Task.sleep(for:.milliseconds(100))
            let after=ChartInteractionProbe.chartBuilds
            precondition(before>0&&after==before,"Hover rebuilt the chart body: \(before) -> \(after)")
            for value in 0..<30{ChartInteractionProbe.setSmoothing?(Double(value));try? await Task.sleep(for:.milliseconds(3))}
            for _ in 0..<300{if ChartInteractionProbe.period==29{break};try? await Task.sleep(for:.milliseconds(10))}
            precondition(ChartInteractionProbe.period==29 && ChartInteractionProbe.chartBuilds==after+1,"Slider burst was not coalesced")
            ChartInteractionProbe.setSmoothing?(0)
            for _ in 0..<300{if ChartInteractionProbe.period==0{break};try? await Task.sleep(for:.milliseconds(10))}
            precondition(ChartInteractionProbe.period==0,"Smoothing could not be turned off")
            latencies.sort();let report:[String:Any]=["responses":stats.responses.count,"buckets":ChartInteractionProbe.bucketCount,"readyMs":readyMs,"hoverTurns":positions.count*5,"hoverTurnP95Ms":latencies[Int(Double(latencies.count-1)*0.95)],"chartBuilds":after,"sliderChanges":30,"sliderRebuilds":1]
            print(String(data:try! JSONSerialization.data(withJSONObject:report,options:.sortedKeys),encoding:.utf8)!)
            app.terminate(nil)
        }
        app.run()
    }
}
