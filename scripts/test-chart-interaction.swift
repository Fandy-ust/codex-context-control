import AppKit
import SwiftUI
@MainActor final class Controller:ObservableObject {
    func api(_ path:String,body:[String:Any]) async throws -> Data {throw CocoaError(.fileReadUnknown)}
}
@MainActor final class PointerActivityProbe {var changes:[Bool]=[];func receive(_ active:Bool){if changes.last != active{changes.append(active)}}}
@main @MainActor struct ChartInteractionSmoke {
    static func main() throws {
        let stats=try JSONDecoder().decode(ContextStatistics.self,from:Data(contentsOf:URL(fileURLWithPath:CommandLine.arguments[1])))
        let app=NSApplication.shared;app.setActivationPolicy(.prohibited)
        let activity=PointerActivityProbe()
        let started=CFAbsoluteTimeGetCurrent()
        let view=NSHostingView(rootView:ContextResponseChart(responses:stats.responses,events:stats.timelineEvents,revision:stats.generatedAt,onInteractionChanged:{activity.receive($0)}).equatable().padding(20).frame(width:900).preferredColorScheme(.dark))
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
            // Drive the same geometry/input path used by real hover events, including the X-axis labels.
            guard let mapping=ChartInteractionProbe.mappings["events"] else{preconditionFailure("Missing pointer tracking layer")}
            let axisY=min(mapping.viewSize.height-1,mapping.plot.maxY+4)
            let pointerBefore=ChartInteractionProbe.pointerUpdates
            let burstStart=CFAbsoluteTimeGetCurrent()
            for n in 0..<10000 {
                let fraction=Double(n%997)/996
                let point=CGPoint(x:mapping.scaleStart+CGFloat(fraction)*(mapping.scaleEnd-mapping.scaleStart),y:axisY)
                ChartInteractionProbe.movePointer("events",point:point)
            }
            let target=mapping.upperBound*0.73
            ChartInteractionProbe.movePointer("events",point:CGPoint(x:mapping.x(for:target),y:axisY))
            let finalEventAt=CFAbsoluteTimeGetCurrent()
            for _ in 0..<100{if let p=ChartInteractionProbe.cursorPosition,abs(p-target)<0.001{break};try? await Task.sleep(for:.milliseconds(5))}
            let pointerLagMs=(CFAbsoluteTimeGetCurrent()-finalEventAt)*1000
            precondition(abs((ChartInteractionProbe.cursorPosition ?? -1)-target)<0.001,"X-axis hover did not reach the latest pointer position")
            let publications=ChartInteractionProbe.pointerUpdates-pointerBefore
            precondition(publications<10000 && ChartInteractionProbe.chartBuilds==after,"Pointer burst rebuilt charts or was not coalesced")
            ChartInteractionProbe.movePointer("events",point:CGPoint(x:mapping.scaleStart,y:axisY))
            ChartInteractionProbe.movePointer("events",point:nil)
            try? await Task.sleep(for:.milliseconds(40))
            precondition(ChartInteractionProbe.cursorPosition==nil && ChartInteractionProbe.hoveredIndex==nil,"An old queued pointer update reappeared after exit")
            let pointerBurstMs=(CFAbsoluteTimeGetCurrent()-burstStart)*1000
            precondition(activity.changes.suffix(2)==[true,false],"Hover activity must notify the refresh scheduler exactly at entry/exit")
            for value in 0..<30{ChartInteractionProbe.setSmoothing?(Double(value));try? await Task.sleep(for:.milliseconds(3))}
            for _ in 0..<300{if ChartInteractionProbe.period==29{break};try? await Task.sleep(for:.milliseconds(10))}
            precondition(ChartInteractionProbe.period==29 && ChartInteractionProbe.chartBuilds==after+1,"Slider burst was not coalesced")
            ChartInteractionProbe.setSmoothing?(0)
            for _ in 0..<300{if ChartInteractionProbe.period==0{break};try? await Task.sleep(for:.milliseconds(10))}
            precondition(ChartInteractionProbe.period==0,"Smoothing could not be turned off")
            latencies.sort();let report:[String:Any]=["responses":stats.responses.count,"buckets":ChartInteractionProbe.bucketCount,"readyMs":readyMs,"hoverTurns":positions.count*5,"hoverTurnP95Ms":latencies[Int(Double(latencies.count-1)*0.95)],"chartBuilds":after,"sliderChanges":30,"sliderRebuilds":1,"pointerEvents":10001,"pointerPublications":publications,"pointerLatestLagMs":pointerLagMs,"pointerBurstMs":pointerBurstMs,"xAxisTrackingPassed":true,"exitClearsPending":true]
            print(String(data:try! JSONSerialization.data(withJSONObject:report,options:.sortedKeys),encoding:.utf8)!)
            app.terminate(nil)
        }
        app.run()
    }
}
