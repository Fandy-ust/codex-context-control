import SwiftUI
import Charts

private func tokenLabel(_ value:Int?)->String {value.map{$0.formatted()+" tokens"} ?? L("未记录")}
private func eventColor(_ type:String)->Color {
    switch type {case "final":return .blue;case "user_input","steering":return .green;case "compaction":return .purple;default:return Color(white:0.78)}
}
@MainActor private final class TimelineCursor:ObservableObject {
    @Published private(set) var position:Double?
    private(set) var fraction:Double?
    func move(_ next:Double?,upperBound:Double=1){fraction=next.map{$0/upperBound};if position != next{position=next}}
}
@MainActor private final class TimelineSelection:ObservableObject {
    @Published private(set) var hovered:Int?
    @Published private(set) var selectedID=""
    @Published private(set) var pinnedPosition:Double?
    let cursor=TimelineCursor()
    private let updates=MenuDragUpdates(maxFPS:60)
    private var tracking=false
    private var activity:((Bool)->Void)?
    func setActivityHandler(_ handler:@escaping(Bool)->Void){activity=handler;handler(tracking)}
    private func track(_ value:Bool){if tracking != value{tracking=value;activity?(value)}}
    func hover(_ index:Int?){if hovered != index{hovered=index}}
    func move(_ position:Double?,in data:TimelineData){
        guard let position else{endHover();return}
        track(true)
#if DEBUG
        ChartInteractionProbe.pointerEvents+=1
#endif
        updates.submit{[weak self] in
            guard let self else{return}
            cursor.move(position,upperBound:data.upperBound);hover(data.bucket(at:position))
#if DEBUG
            ChartInteractionProbe.pointerUpdates+=1
#endif
        }
    }
    func endHover(){updates.cancel();cursor.move(nil);hover(nil);track(false)}
    func rebind(_ data:TimelineData){updates.cancel();if let fraction=cursor.fraction{let position=fraction*data.upperBound;cursor.move(position,upperBound:data.upperBound);hover(data.bucket(at:position))}else{hover(nil)}}
    func stop(){endHover();activity=nil}
    func pin(_ id:String){endHover();if selectedID != id{selectedID=id};pinnedPosition=nil}
    func pinBucket(_ position:Double){endHover();selectedID="";pinnedPosition=position}
    func focus(_ data:TimelineData)->Int? {
        if let hovered,data.buckets.indices.contains(hovered){return hovered}
        return data.bucket(for:selectedID) ?? pinnedPosition.flatMap{data.bucket(at:$0)}
    }
}
private enum TimelinePlotKind:String {case speed,cache,events}
#if DEBUG
@MainActor enum ChartInteractionProbe {
    static var chartBuilds=0;static var bucketCount=0;static var period=0
    static var pointerEvents=0;static var pointerUpdates=0
    static var mappings:[String:TimelineHoverMapping]=[:]
    static var moves:[String:(CGPoint?)->Void]=[:]
    static var hoveredIndex:Int?{selection?.hovered}
    static var cursorPosition:Double?{selection?.cursor.position}
    static func movePointer(_ kind:String,point:CGPoint?){moves[kind]?(point)}
    static var setSmoothing:((Double)->Void)?
    private static weak var selection:TimelineSelection?
    private static var data:TimelineData?
    fileprivate static func rendered(_ state:TimelineSelection,_ value:TimelineData){chartBuilds+=1;selection=state;data=value;bucketCount=value.buckets.count;period=value.period}
    static func hover(_ position:Int?){selection?.hover(position.flatMap{data?.bucket(at:Double($0))})}
    static func pin(_ id:String){selection?.pin(id)}
    static var selectedID:String?{selection?.selectedID}
}
#endif
@MainActor struct ContextResponseChart:View,Equatable {
    let responses:[ContextStatistics.Response];let events:[ContextStatistics.TimelineEvent]
    nonisolated let revision:String
    var onInteractionChanged:(Bool)->Void={_ in}
    @State private var smoothing=0.0
    @State private var prepared:PreparedTimeline?
    @State private var preparing=false
    private var key:String{revision+":"+String(Int(smoothing))}
    nonisolated static func ==(lhs:Self,rhs:Self)->Bool{lhs.revision==rhs.revision}
    var body:some View {
        VStack(alignment:.leading,spacing:10){
            HStack(spacing:10){
                Text(L("对话趋势")).font(.headline);Spacer()
                Text(L("平滑度")).font(.caption).foregroundStyle(.secondary)
                Slider(value:$smoothing,in:0...40,step:1).frame(width:130).accessibilityLabel(L("趋势平滑度"))
                Text(smoothing<2 ? L("关闭"):"EMA \(Int(smoothing))").font(.caption.monospacedDigit()).frame(width:60,alignment:.trailing)
                if preparing{ProgressView().controlSize(.mini)}
            }
            if let data=prepared {
                TimelinePlots(data:data.data,labels:data.labels,onInteractionChanged:onInteractionChanged).equatable()
            }else{ProgressView(L("正在整理趋势…")).frame(maxWidth:.infinity,minHeight:260)}
        }.padding(14).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:14))
#if DEBUG
        .onAppear{ChartInteractionProbe.setSmoothing={smoothing=$0}}
        .onDisappear{ChartInteractionProbe.setSmoothing=nil}
#endif
        .task(id:key){
            let requestKey=key,period=Int(smoothing),responses=responses,events=events
            do {
                if prepared != nil{try await Task.sleep(for:.milliseconds(180))}
                try Task.checkCancellation();preparing=true
                let job=Task.detached(priority:.userInitiated){try PreparedTimeline(TimelineData(responses:responses,events:events,revision:requestKey,period:period))}
                let result=try await withTaskCancellationHandler(operation:{try await job.value},onCancel:{job.cancel()})
                try Task.checkCancellation();prepared=result;preparing=false
            }catch {if !Task.isCancelled{preparing=false}}
        }
    }
}
@MainActor private struct TimelinePlots:View,Equatable {
    let data:TimelineData;let labels:[TimelineBucketPresentation];let onInteractionChanged:(Bool)->Void
    @State private var selection=TimelineSelection()
    nonisolated static func ==(lhs:Self,rhs:Self)->Bool{lhs.data.revision==rhs.data.revision}
    var body:some View {
#if DEBUG
        let _=ChartInteractionProbe.rendered(selection,data)
#endif
        return VStack(alignment:.leading,spacing:8){
            HStack{Text(L("每区间约 {0} 次响应 · {1} 个区间", data.bucketSize, data.buckets.count));Spacer();Text(L("共 {0} 次响应", data.responseCount))}.font(.caption2).foregroundStyle(.secondary)
            HStack {Text(data.period<2 ? L("区间生成均速"):L("生成速度 · EMA 趋势")).font(.caption.weight(.medium));Spacer();TimelineSpeedLabel(data:data,labels:labels,selection:selection)}
            speedChart
            HStack(spacing:12){Text(L("输入与缓存")).font(.caption.weight(.medium));Spacer();legend(L("输入"),color:.gray);legend(L("缓存"),color:.cyan)}
            cacheChart
            HStack(spacing:12){Text(L("区间事件")).font(.caption.weight(.medium));Spacer();legend(L("最终"),color:.blue);legend(L("输入"),color:.green);legend(L("压缩"),color:.purple);legend(L("零值"),color:.orange)}
            eventTrack
            if !data.buckets.isEmpty{TimelineBucketDetails(data:data,labels:labels,selection:selection)}
            DisclosureGroup(L("统计说明")){
                Text(L("总览最多 120 个区间。平滑只改变趋势线；区间速度按输出量÷生成时间计算，输入和缓存取均值，输出取合计。区间有有效样本就连线，整段缺数据才断线；模型变化和压缩只重置 EMA，紫色标记表示压缩。缓存零值保留事件标记和区间最小值。展开区间可逐条查看原始记录，点击可固定。")).font(.caption).foregroundStyle(.secondary).padding(.top,5)
            }.font(.caption).foregroundStyle(.secondary)
        }.onHover{inside in if !inside{selection.endHover()}}
        .onAppear{selection.setActivityHandler(onInteractionChanged)}
        .onDisappear{selection.stop()}
        .onChange(of:data.revision){_,_ in selection.rebind(data)}
    }
    private func legend(_ title:String,color:Color)->some View {HStack(spacing:4){Circle().fill(color).frame(width:5,height:5);Text(title)}.font(.caption2).foregroundStyle(.secondary)}
    private var speedChart:some View {
        Chart {
            ForEach(data.speed){point in
                LineMark(x:.value(L("记录顺序"),point.position),y:.value("tokens/s",point.value),series:.value(L("片段"),point.series)).interpolationMethod(data.period<2 ? .linear:.monotone).foregroundStyle(.white.opacity(0.8)).lineStyle(StrokeStyle(lineWidth:1.8))
                PointMark(x:.value(L("记录顺序"),point.position),y:.value("tokens/s",point.value)).foregroundStyle(.white.opacity(0.35)).symbolSize(5)
            }
            ForEach(data.buckets.filter{$0.compactions>0}){b in RuleMark(x:.value(L("记录顺序"),b.position)).foregroundStyle(.purple.opacity(0.35)).lineStyle(StrokeStyle(lineWidth:1,dash:[3,3]))}
        }.chartXScale(domain:0...data.upperBound)
        .chartYAxis{AxisMarks(position:.trailing){value in AxisGridLine();AxisValueLabel{if let n=value.as(Double.self){Text(n.formatted(.number.precision(.fractionLength(0...1)))).frame(width:50,alignment:.leading)}}}}
        .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08))}}
        .chartOverlay{proxy in TimelineOverlay(proxy:proxy,kind:.speed,data:data,selection:selection)}.frame(height:165)
    }
    private var cacheChart:some View {
        Chart {
            ForEach(data.input){p in
                LineMark(x:.value(L("记录顺序"),p.position),y:.value("tokens",p.value),series:.value(L("片段"),"input-\(p.series)")).interpolationMethod(data.period<2 ? .linear:.monotone).foregroundStyle(.gray.opacity(0.6))
                PointMark(x:.value(L("记录顺序"),p.position),y:.value("tokens",p.value)).foregroundStyle(.gray.opacity(0.4)).symbolSize(3)
            }
            ForEach(data.cache){p in
                LineMark(x:.value(L("记录顺序"),p.position),y:.value("tokens",p.value),series:.value(L("片段"),"cache-\(p.series)")).interpolationMethod(data.period<2 ? .linear:.monotone).foregroundStyle(.cyan)
                PointMark(x:.value(L("记录顺序"),p.position),y:.value("tokens",p.value)).foregroundStyle(.cyan.opacity(0.4)).symbolSize(3)
            }
            ForEach(data.buckets.filter{$0.compactions>0}){b in RuleMark(x:.value(L("记录顺序"),b.position)).foregroundStyle(.purple.opacity(0.5)).lineStyle(StrokeStyle(lineWidth:1,dash:[3,3]))}
        }.chartXScale(domain:0...data.upperBound)
        .chartYAxis{AxisMarks(position:.trailing){value in AxisGridLine();AxisValueLabel{if let n=value.as(Int.self){Text(n>=1000 ? "\(n/1000)K":"\(n)").frame(width:50,alignment:.leading)}}}}
        .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08))}}
        .chartOverlay{proxy in TimelineOverlay(proxy:proxy,kind:.cache,data:data,selection:selection)}.frame(height:95)
    }
    private var eventTrack:some View {
        Chart {
            ForEach(data.buckets){b in
                if b.responses>b.finals {PointMark(x:.value(L("记录顺序"),b.position),y:.value(L("事件"),0)).foregroundStyle(.white.opacity(0.5)).symbolSize(12)}
                if b.finals>0 {PointMark(x:.value(L("记录顺序"),b.position),y:.value(L("事件"),0.35)).foregroundStyle(.blue).symbolSize(35)}
                if b.users>0 {PointMark(x:.value(L("记录顺序"),b.position),y:.value(L("事件"),-0.35)).symbol(.diamond).foregroundStyle(.green).symbolSize(35)}
                if b.compactions>0 {PointMark(x:.value(L("记录顺序"),b.position),y:.value(L("事件"),0.7)).symbol(.square).foregroundStyle(.purple).symbolSize(45)}
                if b.zeroCaches>0 {PointMark(x:.value(L("记录顺序"),b.position),y:.value(L("事件"),-0.7)).symbol{Circle().strokeBorder(.orange,lineWidth:1.5).frame(width:6,height:6)}}
            }
        }.chartXScale(domain:0...data.upperBound).chartYScale(domain:-1...1)
        .chartYAxis{AxisMarks(position:.trailing,values:[0]){_ in AxisValueLabel{Text(" ").frame(width:50,alignment:.leading).accessibilityHidden(true)}}}
        .chartXAxis{AxisMarks(values:.automatic(desiredCount:5)){_ in AxisGridLine(stroke:StrokeStyle(lineWidth:0.5,dash:[3,4])).foregroundStyle(.white.opacity(0.08));AxisValueLabel()}}
        .chartOverlay{proxy in TimelineOverlay(proxy:proxy,kind:.events,data:data,selection:selection)}.frame(height:42)
    }
}
@MainActor private struct TimelineSpeedLabel:View {
    let data:TimelineData;let labels:[TimelineBucketPresentation];@ObservedObject var selection:TimelineSelection
    var body:some View {let index=selection.focus(data) ?? data.buckets.indices.last
        Text(index.map{labels[$0].speedHeading} ?? L("无计时")).font(.caption).monospacedDigit().foregroundStyle(.secondary)
    }
}
@MainActor private struct TimelineOverlay:View {
    let proxy:ChartProxy;let kind:TimelinePlotKind;let data:TimelineData
    let selection:TimelineSelection
    var body:some View {
        GeometryReader{geometry in
            if let frame=proxy.plotFrame {
                let bounds=geometry[frame]
                let mapping=TimelineHoverMapping(plot:bounds,viewSize:geometry.size,scaleStart:bounds.minX+(proxy.position(forX:0.0) ?? 0),scaleEnd:bounds.minX+(proxy.position(forX:data.upperBound) ?? bounds.width),upperBound:data.upperBound)
                ZStack {
                    TimelinePointerSurface(mapping:mapping,kind:kind,data:data,selection:selection)
                    TimelineFocusOverlay(mapping:mapping,data:data,selection:selection,cursor:selection.cursor)
                }
            }
        }.help(L("悬停绘图区或横轴查看区间，点击固定"))
    }
}
@MainActor private struct TimelinePointerSurface:View {
    let mapping:TimelineHoverMapping;let kind:TimelinePlotKind;let data:TimelineData;let selection:TimelineSelection
    private func move(_ point:CGPoint?){selection.move(point.flatMap{mapping.position(at:$0)},in:data)}
    var body:some View {
        Rectangle().fill(.clear).contentShape(Rectangle())
            .onContinuousHover{phase in switch phase {case .active(let point):move(point);case .ended:move(nil)}}
            .onTapGesture(coordinateSpace:.local){point in if let p=mapping.position(at:point),let index=data.bucket(at:p){selection.pinBucket(data.buckets[index].position)}}
            .onDisappear{selection.endHover()}
#if DEBUG
            .onAppear{ChartInteractionProbe.mappings[kind.rawValue]=mapping;ChartInteractionProbe.moves[kind.rawValue]=move}
            .onChange(of:mapping.plot){_,_ in ChartInteractionProbe.mappings[kind.rawValue]=mapping;ChartInteractionProbe.moves[kind.rawValue]=move}
            .onChange(of:data.revision){_,_ in ChartInteractionProbe.mappings[kind.rawValue]=mapping;ChartInteractionProbe.moves[kind.rawValue]=move}
#endif
    }
}
@MainActor private struct TimelineFocusOverlay:View {
    let mapping:TimelineHoverMapping;let data:TimelineData
    @ObservedObject var selection:TimelineSelection
    @ObservedObject var cursor:TimelineCursor
    var body:some View {
        Canvas{context,_ in
            guard let index=selection.focus(data) else{return}
            let bucket=data.buckets[index],bounds=mapping.plot
            let left=mapping.x(for:Double(bucket.startPosition)),right=mapping.x(for:Double(bucket.endPosition))
            context.fill(Path(CGRect(x:left,y:bounds.minY,width:max(2,right-left),height:bounds.height)),with:.color(.white.opacity(0.04)))
            let x=mapping.x(for:cursor.position ?? bucket.position)
            context.fill(Path(CGRect(x:x,y:bounds.minY,width:1,height:bounds.height)),with:.color(.white.opacity(0.5)))
        }.allowsHitTesting(false).accessibilityHidden(true)
    }
}
@MainActor private struct TimelineBucketDetails:View {
    let data:TimelineData;let labels:[TimelineBucketPresentation];@ObservedObject var selection:TimelineSelection
    @State private var page=0
    @State private var recordsExpanded=false
    private var index:Int{selection.focus(data) ?? data.buckets.count-1}
    var body:some View {
        let b=data.buckets[index],label=labels[index],pageCount=max(1,Int(ceil(Double(b.entryRange.count)/20))),currentPage=min(page,pageCount-1)
        return VStack(alignment:.leading,spacing:9){
            HStack{Text(b.title).font(.callout.weight(.medium));Spacer();Text(label.counts).font(.caption).foregroundStyle(.secondary)}
            HStack(spacing:12){metric(L("区间均速"),label.speed);metric(L("输入均量"),label.input);metric(L("缓存均量"),label.cache);metric(L("输出合计"),label.output)}
            Text(label.events).font(.caption).foregroundStyle(.secondary)
            if !b.models.isEmpty {Text(label.models).font(.caption2).foregroundStyle(.secondary).lineLimit(1)}
            if b.measured<b.responses || b.inputSamples<b.responses || b.cacheSamples<b.responses {
                Text(L("缺少记录：计时 {0} · 输入 {1} · 缓存 {2}", b.responses-b.measured, b.responses-b.inputSamples, b.responses-b.cacheSamples)).font(.caption2).foregroundStyle(.secondary)
            }
            if b.zeroCaches>0{Text(label.minimumCache).font(.caption2).foregroundStyle(.orange)}
            DisclosureGroup(L("原始记录（{0} 条）", b.entryRange.count),isExpanded:$recordsExpanded){
                if recordsExpanded {VStack(alignment:.leading,spacing:6){
                    HStack{Text(L("第 {0}/{1} 页", currentPage+1, pageCount)).font(.caption);Spacer();Button(L("上一页")){page=max(0,currentPage-1)}.disabled(currentPage==0);Button(L("下一页")){page=min(pageCount-1,currentPage+1)}.disabled(currentPage+1>=pageCount)}.controlSize(.small)
                    ForEach(Array(data.page(bucket:index,page:currentPage))){entry in
                        Button{selection.pin(entry.id)} label:{HStack{Circle().fill(eventColor(entry.eventType)).frame(width:5,height:5);Text(L(entry.kind));Spacer();if let r=entry.response{Text(r.tokensPerSecond.map{String(format:"%.1f t/s",$0)} ?? L("无计时")).monospacedDigit()}}}.buttonStyle(.plain).font(.caption).padding(.vertical,3)
                    }
                    if let entry=data.entry(selection.selectedID),data.bucket(for:entry.id)==index{Divider();TimelineRawDetails(entry:entry)}
                }.padding(.top,6)}
            }.font(.caption)
        }.padding(10).background(.white.opacity(0.04),in:RoundedRectangle(cornerRadius:10)).onChange(of:index){_,_ in if page != 0{page=0}}
    }
    private func amount(_ n:Double?)->String{n.map{$0>=1000 ? String(format:"%.1fK",$0/1000):String(format:"%.0f",$0)} ?? "—"}
    private func metric(_ label:String,_ value:String)->some View{VStack(alignment:.leading,spacing:3){Text(label).font(.caption2).foregroundStyle(.secondary);Text(value).font(.callout).monospacedDigit()}.frame(maxWidth:.infinity,alignment:.leading)}
}
@MainActor private struct TimelineRawDetails:View {
    let entry:TimelineEntry
    var body:some View {
        VStack(alignment:.leading,spacing:8){Text(L(entry.kind)).font(.caption.weight(.semibold));if let r=entry.response{responseDetails(r)}else if let e=entry.event{eventDetails(e)}}
    }
    private func compactTokens(_ value:Int?)->String {
        value.map{$0>=1000 ? (Double($0)/1000).formatted(.number.precision(.fractionLength(0...1)))+"K":$0.formatted()} ?? "—"
    }
    private func localTime(_ value:String)->String {
        let parser=ISO8601DateFormatter();parser.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        return parser.date(from:value)?.formatted(Date.FormatStyle(date:.omitted,time:.standard).locale(Localization.locale)) ?? value
    }
    private func field(_ label:String,_ value:String)->some View {
        VStack(alignment:.leading,spacing:3){Text(label).font(.caption2).foregroundStyle(.secondary);Text(value).font(.system(size:13,weight:.medium)).monospacedDigit()}.frame(maxWidth:.infinity,alignment:.leading)
    }
    private func eventDetails(_ e:ContextStatistics.TimelineEvent)->some View {
        VStack(alignment:.leading,spacing:7){
            HStack {
                if e.eventType=="compaction" {field(L("保留项目"),e.retainedItems.map{String($0)} ?? "—");field(L("状态"),L("压缩完成"))}
                else {field(L("文本 · 估算 tokens"),compactTokens(e.tokensEstimate));field(L("图片"),"\(e.images)");field(L("输入类型"),e.eventType=="steering" ? L("同轮追加"):L("用户输入"))}
                field(L("时间"),localTime(e.timestamp))
            }
            Text(L("轮次 {0}", e.turnId ?? L("未记录"))).font(.caption2).foregroundStyle(.tertiary).textSelection(.enabled)
        }
    }
    private func responseDetails(_ r:ContextStatistics.Response)->some View {
        VStack(alignment:.leading,spacing:8){
            HStack(spacing:10){
                field(L("生成 · tokens/s"),r.tokensPerSecond.map{String(format:"%.1f",$0)} ?? "—")
                field(L("输出 tokens"),compactTokens(r.outputTokens))
                field(L("输入 tokens"),compactTokens(r.inputTokens))
                field(L("缓存命中"),compactTokens(r.cachedInputTokens))
                field(L("命中变化"),r.cacheDelta.map{($0>=0 ? "+":"−")+compactTokens(abs($0))} ?? "—")
                field(L("命中率"),r.cacheHitRate.map{String(format:"%.1f%%",$0*100)} ?? "—")
            }
            HStack(spacing:6){
                Text(r.config.model.map{modelDisplayName($0)} ?? L("模型未记录")).foregroundStyle(.primary)
                Text("· \(effortDisplayName(r.config.effort)) · \(serviceTierDisplayName(r.config.serviceTier))")
                Spacer();Text(localTime(r.timestamp))
            }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
            DisclosureGroup(L("更多信息")){
                VStack(alignment:.leading,spacing:5){
                    if r.cacheStatus=="zero_in_log"{Text(L("缓存日志值为 0；这次原始响应未保存，无法区分未命中与缺失详情。")).foregroundStyle(.orange)}
                    else if r.cacheStatus=="missing" || r.cacheStatus=="invalid"{Text(L("缓存数据未记录或无效，不按零计算。")).foregroundStyle(.secondary)}
                    Text(L("生成用时 {0} · 生成前间隔 {1}", r.durationMs.map{String(format:L("%.2f 秒"),$0/1000)} ?? L("未记录"), r.preGenerationGapMs.map{String(format:L("≈ %.2f 秒"),$0/1000)} ?? L("未记录")))
                    Text(L("生成前间隔来自最近输入记录到首个生成项目，含客户端等待等开销，不是精确的服务器首 token 延迟。")).foregroundStyle(.secondary)
                    if let parts=r.costEstimate?.breakdown {ForEach(parts){part in HStack {Text(L(part.label));Spacer();Text("\(part.tokens.formatted()) tokens · \(String(format:"$%.4f",part.usd))").monospacedDigit()}}}
                    Text(L("本次 API 估算 {0} · Standard 单价", r.costEstimate?.usd.map{String(format:"$%.4f",$0)} ?? L("未知")))
                    Text(L("推理 {0} · 缓存写入（估算） {1} · 用时 {2}", tokenLabel(r.reasoningTokens), tokenLabel(r.costEstimate?.breakdown?.first(where:{$0.category=="cache_write"})?.tokens), r.durationMs.map{String(format:L("%.2f 秒"),$0/1000)} ?? L("未记录")))
                    Text(L("窗口 {0} · 压缩阈值 {1} · 轮次 {2}", tokenLabel(r.config.contextWindow), tokenLabel(r.config.compactThreshold), r.turnId ?? L("未记录")))
                }.font(.caption2).foregroundStyle(.secondary).textSelection(.enabled).padding(.top,4)
            }.font(.caption2).foregroundStyle(.secondary)
        }
    }
}
