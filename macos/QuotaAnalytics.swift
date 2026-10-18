import SwiftUI
import Charts

struct QuotaAnalyticsReport:Decodable {
    struct Option:Decodable,Identifiable {let id:String;let label:String}
    struct Section:Decodable,Identifiable {let id:String;let title:String;let chartIds:[String]}
    struct Overview:Decodable {
        struct Window:Decodable {let label:String;let weeklyPP:Double}
        let weeklyUsed:Double?;let fiveUsed:Double?;let tokens:Double?;let tokensPerPP:Double?;let updatedAt:Double?;let largestWindow:Window?
    }
    struct Quality:Decodable {
        struct Progress:Decodable {let files:Int;let pending:Int;let unreadable:Int;let bytesRead:Int}
        let snapshots:Int;let requests:Int;let comparableIntervals:Int;let discontinuities:Int;let unknownAccount:Bool;let notes:[String];let progress:Progress?
    }
    let schemaVersion:Int;let generatedAt:Double;let timeZone:String;let days:Int;let scope:String;let pool:String
    let scopes:[Option];let pools:[Option];let sections:[Section];let charts:[QuotaAnalysisChart];let overview:Overview;let quality:Quality
}
struct QuotaAnalysisPoint:Decodable,Identifiable {
    let id:String;let x:Double;let y:Double;let series:String?;let segment:String?;let label:String?;let at:Double?
    let value:Double?;let rightY:Double?;let tokens:Double?;let alignedTokens:Double?;let weeklyPP:Double?;let fivePP:Double?;let cacheRate:Double?;let partial:Bool?
    let low:Double?;let high:Double?;let q1:Double?;let q3:Double?
}
struct QuotaAnalysisChart:Decodable,Identifiable {
    struct Fit:Decodable {let slope:Double;let intercept:Double;let r2:Double;let count:Int}
    struct Summary:Decodable {let count:Int;let min:Double;let median:Double;let max:Double}
    struct Ranking:Decodable,Identifiable {let id:String;let category:String;let label:String;let tokens:Double;let requests:Int}
    let id:String;let title:String;let kind:String;let xLabel:String;let yLabel:String;let rightLabel:String?;let wide:Bool?
    let points:[QuotaAnalysisPoint];let empty:String?;let note:String?;let xMax:Double?;let yMax:Double?;let fit:Fit?;let summary:Summary?
    var labels:[String]=[];var ranking:[Ranking]=[]
    enum CodingKeys:String,CodingKey {case id,title,kind,xLabel,yLabel,rightLabel,wide,points,empty,note,xMax,yMax,fit,summary,rows}
    init(from decoder:Decoder)throws {
        let c=try decoder.container(keyedBy:CodingKeys.self)
        id=try c.decode(String.self,forKey:.id);title=try c.decode(String.self,forKey:.title);kind=try c.decode(String.self,forKey:.kind)
        xLabel=try c.decode(String.self,forKey:.xLabel);yLabel=try c.decode(String.self,forKey:.yLabel);rightLabel=try c.decodeIfPresent(String.self,forKey:.rightLabel);wide=try c.decodeIfPresent(Bool.self,forKey:.wide)
        points=try c.decode([QuotaAnalysisPoint].self,forKey:.points);empty=try c.decodeIfPresent(String.self,forKey:.empty);note=try c.decodeIfPresent(String.self,forKey:.note)
        xMax=try c.decodeIfPresent(Double.self,forKey:.xMax);yMax=try c.decodeIfPresent(Double.self,forKey:.yMax);fit=try c.decodeIfPresent(Fit.self,forKey:.fit);summary=try c.decodeIfPresent(Summary.self,forKey:.summary)
        if kind=="table" {ranking=(try? c.decode([Ranking].self,forKey:.rows)) ?? []}else{labels=(try? c.decode([String].self,forKey:.rows)) ?? []}
    }
}
func quotaNumber(_ n:Double?)->String {
    guard let n,n.isFinite else{return "—"}
    if abs(n)>=1000000{return String(format:"%.1fM",n/1000000)}
    if abs(n)>=1000{return String(format:"%.0fK",n/1000)}
    return n.formatted(.number.precision(.fractionLength(0...2)).locale(Localization.locale))
}

struct QuotaAnalyticsView:View {
    @ObservedObject var model:Controller
    var onBack:()->Void
    private let fixture:Bool
    @State private var report:QuotaAnalyticsReport?
    @State private var section="overview"
    @State private var days=28
    @State private var scope=""
    @State private var pool=""
    @State private var loading=false
    @State private var failure:String?
    @State private var epoch=0
    init(model:Controller,onBack:@escaping ()->Void,fixture:QuotaAnalyticsReport?=nil){self.model=model;self.onBack=onBack;self.fixture=fixture != nil;_report=State(initialValue:fixture)}
    private var loadKey:String {"\(days):\(scope):\(pool)"}
    private var cards:[QuotaAnalysisChart] {
        guard let report else{return []};let selected=report.sections.first{$0.id==section} ?? report.sections.first
        return (selected?.chartIds ?? []).compactMap{id in report.charts.first{$0.id==id}}
    }
    var body:some View {
        GeometryReader{geometry in
            ScrollView {
                VStack(alignment:.leading,spacing:20){
                    HStack{Button(L("返回预算"),systemImage:"arrow.left",action:onBack);Spacer();if loading{ProgressView().controlSize(.small)};Button(L("刷新"),systemImage:"arrow.clockwise"){Task{await model.refreshQuota();await reload(force:true)}}.disabled(loading)}.buttonStyle(.bordered)
                    VStack(alignment:.leading,spacing:10){Text(L("额度分析")).font(.system(size:22,weight:.semibold));Text(L("账户额度变化 × 本机 Token 观测")).font(.callout).foregroundStyle(.secondary);if let at=report?.overview.updatedAt{Text(L("观测截止")+" · "+Date(timeIntervalSince1970:at/1000).formatted(.dateTime.month().day().hour().minute())).font(.caption).foregroundStyle(.secondary)}}
                    filters
                    if let failure{Text(failure).font(.callout).foregroundStyle(.orange)}
                    if let pending=report?.quality.progress?.pending,pending>0{Text("\(L("正在增量导入历史")) · \(pending) \(L("个文件待处理"))").font(.caption).foregroundStyle(.orange)}
                    LazyVGrid(columns:Array(repeating:GridItem(.flexible(),spacing:12),count:4),spacing:12){
                        metric("Weekly 已用",report?.overview.weeklyUsed.map{quotaNumber($0)+"%"});metric("5h 已用",report?.overview.fiveUsed.map{quotaNumber($0)+"%"})
                        metric("本周期本机 Token",quotaNumber(report?.overview.tokens));metric("Token / Weekly 1%",quotaNumber(report?.overview.tokensPerPP))
                    }
                    if let window=report?.overview.largestWindow{Text("\(L("观测消耗最高窗口")) · \(window.label) · \(quotaNumber(window.weeklyPP)) pp").font(.caption).foregroundStyle(.secondary)}
                    if let report {
                        Picker(L("分析分类"),selection:$section){ForEach(report.sections){s in Text(L(s.title)).tag(s.id)}}.pickerStyle(.segmented).frame(maxWidth:460)
                        chartGrid(width:geometry.size.width)
                        DisclosureGroup(L("数据覆盖与口径")+" · \(report.quality.snapshots) "+L("次额度观测")){
                            VStack(alignment:.leading,spacing:8){ForEach(report.quality.notes,id:\.self){Text(L($0))};Text("\(L("可比较区间")): \(report.quality.comparableIntervals) · \(L("重置或断档")): \(report.quality.discontinuities) · \(report.timeZone)")}.font(.caption).foregroundStyle(.secondary).padding(.top,12)
                        }.font(.callout).padding(16).background(.white.opacity(0.025),in:RoundedRectangle(cornerRadius:10))
                    } else {Text(L(loading ? "正在读取额度历史…":"刷新以读取额度历史")).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:200)}
                }.padding(28).frame(maxWidth:1120,alignment:.leading).frame(maxWidth:.infinity)
            }
        }.background(PanelStyle.background)
        .task(id:loadKey){guard !fixture else{return};await reload();while !Task.isCancelled{do{try await Task.sleep(for:.seconds((report?.quality.progress?.pending ?? 0)>0 ? 2:15))}catch{return};await reload()}}
    }
    private var filters:some View {
        HStack(alignment:.bottom,spacing:14){
            VStack(alignment:.leading,spacing:6){Text(L("记录来源"));Picker(L("记录来源"),selection:Binding(get:{scope.isEmpty ? report?.scope ?? "":scope},set:{scope=$0;pool=""})){ForEach(report?.scopes ?? []){p in Text(L(p.label)).tag(p.id)}}.labelsHidden().frame(maxWidth:240)}
            VStack(alignment:.leading,spacing:6){Text(L("额度类型"));Picker(L("额度类型"),selection:Binding(get:{pool.isEmpty ? report?.pool ?? "":pool},set:{pool=$0})){ForEach(report?.pools ?? []){p in Text(p.label).tag(p.id)}}.labelsHidden().frame(maxWidth:180)}
            VStack(alignment:.leading,spacing:6){Text(L("时间范围"));Picker(L("时间范围"),selection:$days){ForEach([28,56,84],id:\.self){n in Text("\(n/7) "+L("周")).tag(n)}}.labelsHidden().frame(width:100)}
            Spacer(minLength:0)
        }.font(.caption).foregroundStyle(.secondary).disabled(loading)
    }
    private func metric(_ title:String,_ value:String?)->some View {
        VStack(alignment:.leading,spacing:10){Text(L(title)).font(.system(size:11)).foregroundStyle(.secondary);Text(value ?? "—").font(.system(size:25,weight:.medium)).monospacedDigit()}.frame(maxWidth:.infinity,alignment:.leading).padding(16).background(.white.opacity(0.045),in:RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).strokeBorder(.white.opacity(0.08)))
    }
    @ViewBuilder private func chartGrid(width:CGFloat)->some View {
        let rows=chartRows(width:width)
        VStack(spacing:16){ForEach(rows.indices,id:\.self){i in HStack(alignment:.top,spacing:16){ForEach(rows[i]){c in QuotaAnalysisCard(chart:c).frame(maxWidth:.infinity,alignment:.topLeading)}}}}
    }
    private func chartRows(width:CGFloat)->[[QuotaAnalysisChart]] {
        var result:[[QuotaAnalysisChart]]=[]
        for c in cards{if width>=780,c.wide != true,let last=result.last,last.count==1,last[0].wide != true{result[result.count-1].append(c)}else{result.append([c])}}
        return result
    }
    @MainActor private func reload(force:Bool=false) async {
        epoch+=1;let key=epoch;loading=true;failure=nil
        defer{if epoch==key{loading=false}}
        do {
            var params:[String:Any]=["days":days,"refresh":force];if !scope.isEmpty{params["scope"]=scope};if !pool.isEmpty{params["pool"]=pool}
            let data=try await model.api(ControlAPI.quotaAnalytics,body:params);try Task.checkCancellation()
            let value=try JSONDecoder().decode(QuotaAnalyticsReport.self,from:data);guard epoch==key else{return};report=value;if scope.isEmpty && !value.scopes.isEmpty{scope=value.scope};if pool.isEmpty && !value.pools.isEmpty{pool=value.pool}
        }catch is CancellationError{}catch{if epoch==key{failure=error.localizedDescription}}
    }
}

private struct QuotaAnalysisCard:View {
    let chart:QuotaAnalysisChart
    @State private var selected:QuotaAnalysisPoint?
    private let colors:[Color]=[Color(red:0.43,green:0.63,blue:1),Color(red:0.78,green:0.59,blue:1),Color(red:0.35,green:0.79,blue:0.69),Color(red:0.94,green:0.71,blue:0.42),Color(red:0.91,green:0.49,blue:0.60),.gray]
    private var groups:[String]{var seen=Set<String>();return chart.points.compactMap{$0.series}.filter{seen.insert($0).inserted}}
    private var maxY:Double {max(1,chart.yMax ?? chart.points.map{max($0.y,$0.high ?? 0)}.max() ?? 1)}
    private var maxRight:Double {max(1,chart.points.compactMap{$0.rightY}.max() ?? 1)}
    private var bounds:ClosedRange<Double> {
        if chart.kind=="bar" || chart.kind=="box" {return -0.6...max(0.6,Double(chart.points.count)-0.4)}
        let lo=chart.xMax != nil ? 0:chart.points.map{$0.x}.min() ?? 0,hi=chart.xMax ?? chart.points.map{$0.x}.max() ?? 1
        return lo...max(lo+1,hi)
    }
    private func color(_ p:QuotaAnalysisPoint)->Color{colors[(groups.firstIndex(of:p.series ?? "") ?? 0)%colors.count]}
    var body:some View {
        VStack(alignment:.leading,spacing:12){
            HStack(alignment:.firstTextBaseline){Text(L(chart.title)).font(.system(size:14,weight:.semibold));Spacer();Text(L(chart.yLabel)).font(.system(size:10)).foregroundStyle(.secondary)}
            if chart.kind=="table" && !chart.ranking.isEmpty {ranking}
            else if chart.points.isEmpty {Text(L(chart.empty ?? "尚无足够的可比较记录")).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth:.infinity,minHeight:190)}
            else {
                plot.frame(height:chart.kind=="heatmap" ? min(380,max(210,Double(chart.labels.count)*15+30)):210)
                Text(L(chart.xLabel)+(chart.rightLabel.map{" · "+L("右轴")+": "+L($0)} ?? "")).font(.system(size:10)).foregroundStyle(.secondary).frame(maxWidth:.infinity)
                if !groups.isEmpty{HStack(spacing:12){ForEach(Array(groups.prefix(8).enumerated()),id:\.offset){i,name in HStack(spacing:5){Circle().fill(colors[i%colors.count]).frame(width:6,height:6);Text(L(name)).lineLimit(1)}}}.font(.system(size:10)).foregroundStyle(.secondary)}
                Text(selected.map(detail) ?? L("悬停查看观测值")).font(.system(size:11)).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:34,alignment:.topLeading).monospacedDigit()
            }
            if let fit=chart.fit{Text("\(L("经验拟合")) · n=\(fit.count) · R²=\(String(format:"%.2f",fit.r2))").font(.caption).foregroundStyle(.secondary)}
            if let summary=chart.summary{Text("\(L("中位数")) \(quotaNumber(summary.median)) · \(L("范围")) \(quotaNumber(summary.min))–\(quotaNumber(summary.max))").font(.caption).foregroundStyle(.secondary)}
            if let note=chart.note{DisclosureGroup(L("数据说明")){VStack(alignment:.leading,spacing:8){Text(L(note));ForEach(Array(chart.points.suffix(60))){p in Text(detail(p)).textSelection(.enabled)}}.font(.caption).foregroundStyle(.secondary).padding(.top,8)}.font(.caption).foregroundStyle(.secondary)}
        }.padding(18).background(.white.opacity(0.045),in:RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).strokeBorder(.white.opacity(0.08)))
    }
    private var plot:some View {
        Chart {
            ForEach(chart.points){p in
                if chart.kind=="heatmap" {
                    let row=Double(chart.labels.count)-p.y-1
                    RectangleMark(xStart:.value("x",p.x),xEnd:.value("x",p.x+1),yStart:.value("y",row),yEnd:.value("y",row+1)).foregroundStyle(colors[0].opacity(0.15+0.85*(p.value ?? 0)/max(1,chart.points.compactMap{$0.value}.max() ?? 1))).cornerRadius(3)
                } else if chart.kind=="bar" {
                    BarMark(x:.value("x",p.x),y:.value("y",p.y),width:.ratio(0.65)).foregroundStyle(color(p)).cornerRadius(3)
                } else if chart.kind=="box" {
                    RuleMark(x:.value("x",p.x),yStart:.value("low",p.low ?? p.y),yEnd:.value("high",p.high ?? p.y)).foregroundStyle(color(p))
                    BarMark(x:.value("x",p.x),yStart:.value("q1",p.q1 ?? p.y),yEnd:.value("q3",p.q3 ?? p.y),width:24).foregroundStyle(color(p).opacity(0.4))
                    PointMark(x:.value("x",p.x),y:.value("median",p.y)).symbol(.cross).foregroundStyle(.white).symbolSize(30)
                } else if chart.kind=="scatter" {
                    PointMark(x:.value("x",p.x),y:.value("y",p.y)).foregroundStyle(color(p).opacity(0.85)).symbolSize(25)
                } else {
                    LineMark(x:.value("x",p.x),y:.value("y",p.y),series:.value("series",p.segment ?? p.series ?? "line")).foregroundStyle(color(p)).lineStyle(StrokeStyle(lineWidth:2))
                    PointMark(x:.value("x",p.x),y:.value("y",p.y)).foregroundStyle(color(p)).symbolSize(8)
                    if chart.kind=="dual",let right=p.rightY {
                        LineMark(x:.value("x",p.x),y:.value("y",right/maxRight*maxY),series:.value("series","weekly-right"+(p.segment ?? ""))).foregroundStyle(colors[3]).lineStyle(StrokeStyle(lineWidth:1.5,dash:[6,4]))
                    }
                }
            }
            if let fit=chart.fit {
                ForEach([max(bounds.lowerBound,-fit.intercept/fit.slope),min(bounds.upperBound,(maxY-fit.intercept)/fit.slope)],id:\.self){x in LineMark(x:.value("x",x),y:.value("y",fit.intercept+fit.slope*x),series:.value("series","fit")).foregroundStyle(.white.opacity(0.55)).lineStyle(StrokeStyle(lineWidth:1,dash:[6,4]))}
            }
        }
        .chartXScale(domain:bounds).chartYScale(domain:0...(chart.kind=="heatmap" ? max(1,Double(chart.labels.count)):maxY))
        .chartLegend(.hidden)
        .chartXAxis{
            if chart.kind=="heatmap" {AxisMarks(values:stride(from:0.5,to:chart.xMax ?? 7,by:chart.xMax==24 ? 3:1).map{$0}){value in AxisValueLabel{if let x=value.as(Double.self){Text(String(Int(x)+(chart.xMax==7 ? 1:0))).font(.system(size:10))}}}}
            else {AxisMarks(values:.automatic(desiredCount:5)){value in AxisGridLine().foregroundStyle(.white.opacity(0.04));AxisValueLabel{if let x=value.as(Double.self){Text(xLabel(x)).font(.system(size:10))}}}}
        }
        .chartYAxis{
            if chart.kind=="heatmap" {AxisMarks(position:.leading,values:Array(0..<chart.labels.count).map{Double($0)+0.5}){value in AxisValueLabel{if let y=value.as(Double.self){Text(yLabel(y)).font(.system(size:9))}}}}
            else {AxisMarks(position:.leading,values:.automatic(desiredCount:5)){value in AxisGridLine().foregroundStyle(.white.opacity(0.06));AxisValueLabel{if let y=value.as(Double.self){Text(yLabel(y)).font(.system(size:10))}}}}
            if chart.kind=="dual" {AxisMarks(position:.trailing,values:.automatic(desiredCount:5)){value in AxisValueLabel{if let y=value.as(Double.self){Text(quotaNumber(y/maxY*maxRight)).font(.system(size:10)).foregroundStyle(colors[3])}}}}
        }
        .chartOverlay{proxy in GeometryReader{geometry in Color.clear.contentShape(Rectangle()).onContinuousHover{phase in
            guard let anchor=proxy.plotFrame else{return};let frame=geometry[anchor]
            switch phase {
            case .active(let location):
                let local=CGPoint(x:location.x-frame.minX,y:location.y-frame.minY)
                selected=chart.points.min{a,b in distance(a,local,proxy)<distance(b,local,proxy)}
            case .ended:break
            }
        }}}
        .accessibilityLabel(L(chart.title))
    }
    private func distance(_ p:QuotaAnalysisPoint,_ location:CGPoint,_ proxy:ChartProxy)->Double {
        let yy=chart.kind=="heatmap" ? Double(chart.labels.count)-p.y-0.5:p.y,xx=chart.kind=="heatmap" ? p.x+0.5:p.x
        guard let x=proxy.position(forX:xx),let y=proxy.position(forY:yy) else{return .infinity}
        return pow(Double(x-location.x),2)+(chart.kind=="bar" || chart.kind=="line" || chart.kind=="dual" ? 0:pow(Double(y-location.y),2))
    }
    private func xLabel(_ x:Double)->String {
        if chart.kind=="dual" {return Date(timeIntervalSince1970:x/1000).formatted(.dateTime.month(.twoDigits).day(.twoDigits))}
        if chart.kind=="bar" || chart.kind=="box" {return chart.points.first{abs($0.x-x)<0.1}?.label ?? ""}
        return quotaNumber(x)
    }
    private func yLabel(_ y:Double)->String {
        if chart.kind=="heatmap" {let i=chart.labels.count-1-Int(y);return chart.labels.indices.contains(i) ? chart.labels[i]:""}
        return quotaNumber(y)
    }
    private func detail(_ p:QuotaAnalysisPoint)->String {
        var values=[p.label,p.series.map{L($0)},L(chart.yLabel)+": "+quotaNumber(chart.kind=="heatmap" ? p.value:p.y)].compactMap{$0}
        if let at=p.at{values.append(Date(timeIntervalSince1970:at/1000).formatted(.dateTime.month(.twoDigits).day().hour().minute()))}
        if let tokens=p.tokens{values.append("Token: "+quotaNumber(tokens))};if let weekly=p.weeklyPP{values.append("Weekly: \(quotaNumber(weekly)) pp")};if let five=p.fivePP{values.append("5h: \(quotaNumber(five)) pp")}
        if p.partial==true{values.append(L("部分窗口"))};return values.joined(separator:" · ")
    }
    private var ranking:some View {
        VStack(spacing:0){HStack{Text(L("类型")).frame(width:42,alignment:.leading);Text(L("名称"));Spacer();Text("Token").frame(width:80,alignment:.trailing);Text(L("请求数")).frame(width:55,alignment:.trailing)}.font(.caption).foregroundStyle(.secondary).padding(.bottom,8)
            ForEach(chart.ranking){row in HStack{Text(L(row.category=="chat" ? "对话":row.category=="project" ? "项目":"日期")).frame(width:42,alignment:.leading).foregroundStyle(.secondary);Text(row.label).lineLimit(1);Spacer();Text(quotaNumber(row.tokens)).frame(width:80,alignment:.trailing);Text("\(row.requests)").frame(width:55,alignment:.trailing)}.font(.caption).monospacedDigit().padding(.vertical,9);Divider().opacity(0.35)}
        }
    }
}
