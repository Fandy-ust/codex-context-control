import SwiftUI

struct QuotaOutline:Shape {
    func path(in rect:CGRect)->Path {
        let r=max(0,min(rect.width,rect.height)/2-1.5),left=rect.minX+1.5,right=rect.maxX-1.5,top=rect.minY+1.5,bottom=rect.maxY-1.5,k=0.5522847498*r
        var p=Path();p.move(to:CGPoint(x:rect.midX,y:top));p.addLine(to:CGPoint(x:right-r,y:top))
        p.addCurve(to:CGPoint(x:right,y:top+r),control1:CGPoint(x:right-r+k,y:top),control2:CGPoint(x:right,y:top+r-k))
        p.addCurve(to:CGPoint(x:right-r,y:bottom),control1:CGPoint(x:right,y:bottom-r+k),control2:CGPoint(x:right-r+k,y:bottom))
        p.addLine(to:CGPoint(x:left+r,y:bottom));p.addCurve(to:CGPoint(x:left,y:bottom-r),control1:CGPoint(x:left+r-k,y:bottom),control2:CGPoint(x:left,y:bottom-r+k))
        p.addCurve(to:CGPoint(x:left+r,y:top),control1:CGPoint(x:left,y:top+r-k),control2:CGPoint(x:left+r-k,y:top));p.addLine(to:CGPoint(x:rect.midX,y:top));return p
    }
}
struct QuotaProgressBorder:View {
    let remaining:Double;var stale=false
    private var fraction:Double{max(0,min(1,remaining/100))}
    private var color:Color{remaining<5 ? .red:remaining<20 ? .yellow:PanelStyle.blue}
    var body:some View {
        GeometryReader{g in
            let shape=QuotaOutline(),p=shape.path(in:CGRect(origin:.zero,size:g.size)),point=p.trimmedPath(from:0,to:fraction).currentPoint ?? CGPoint(x:g.size.width/2,y:1.5)
            shape.stroke(.white.opacity(0.08),lineWidth:3)
            if fraction>0{shape.trim(from:0,to:fraction).stroke(color,style:StrokeStyle(lineWidth:3,lineCap:.round));Circle().fill(color).frame(width:5,height:5).position(point)}
        }.opacity(stale ? 0.45:1).allowsHitTesting(false)
    }
}
struct QuotaSidebarView:View {
    @ObservedObject var model:Controller
    var open:()->Void
    @State private var switching=false
    @State private var switchError:String?
    private func accountHint(_ account:QuotaAccount)->String{
        var hint=(account.label ?? "")+" · "+L(account.current ? "当前登录":account.remote==true ? "其他设备同步缓存":"上次记录，待刷新")
        if let source=account.sourceName{hint+=" · "+source}
        if let at=account.updatedAt{hint+=" · "+Date(timeIntervalSince1970:Double(at)/1000).formatted(date:.abbreviated,time:.shortened)}
        return hint
    }
    var body:some View {
        let accounts=(model.quota?.accounts ?? []).filter{$0.showQuota != false}.sorted{ $0.current && !$1.current }
        Group{if model.quota?.accounts?.isEmpty != false {QuotaSidebarAccountRow(model:model,open:open)}
        else if !accounts.isEmpty {ScrollView(.vertical){
            VStack(alignment:.leading,spacing:9){
                ForEach(accounts){account in
                    VStack(alignment:.leading,spacing:3){
                        HStack(spacing:4){if account.current{Circle().fill(PanelStyle.blue).frame(width:4,height:4)};Text(account.label ?? String(account.scope.suffix(8))).lineLimit(1).truncationMode(.middle);if account.remote==true{Image(systemName:"icloud").font(.system(size:9)).help(L("其他设备同步缓存"))};Spacer(minLength:4);if account.loginId != nil && !account.current{Button{switching=true;Task{defer{switching=false};do{_ = try await switchSavedLogin(model,id:account.loginId ?? "")}catch{switchError=error.localizedDescription}}} label:{Image(systemName:"arrow.left.arrow.right").font(.system(size:10,weight:.medium))}.buttonStyle(.plain).disabled(switching).help(L("快速切换"))}}.font(.system(size:10,weight:.semibold)).frame(minHeight:18).foregroundStyle(.secondary).help(accountHint(account))
                        QuotaSidebarAccountRow(model:model,account:account,open:open)
                            .saturation(account.current ? 1:0.3)
                            .foregroundStyle(account.current ? Color.primary:Color.secondary)
                    }
                }
            }
        }.scrollIndicators(.hidden).frame(height:CGFloat(min(280,accounts.count*74)))}}
        .alert(L("切换账号"),isPresented:Binding(get:{switchError != nil},set:{if !$0{switchError=nil}})){
            Button(L("确定")){switchError=nil}
        } message:{Text(L(switchError ?? ""))}
    }
}
struct QuotaSidebarAccountRow:View {
    @ObservedObject var model:Controller
    var account:QuotaAccount?=nil
    var open:()->Void
    private var bucket:QuotaBucket?{guard let account else{return model.selectedQuota};if account.current,let selected=model.selectedQuota{return selected};return account.buckets.first{$0.id==model.selectedQuotaID} ?? account.buckets.first}
    private var baseline:CreditBaseline?{guard let account,!account.current else{return model.selectedCreditBaseline};guard let id=bucket?.id else{return nil};return account.creditBaselines?[id] ?? nil}
    private var stale:Bool{account?.current==false ? false:!model.serviceAvailable || model.quota?.stale==true}
    private var windows:[QuotaWindow]{[bucket?.primary,bucket?.secondary].compactMap{$0}.sorted{($0.windowDurationMins ?? 0)<($1.windowDurationMins ?? 0)}}
    private var credits:Double?{bucket?.creditBalance.flatMap(Double.init)}
    private var shortCredits:String{guard let value=credits else{return "—"};let scale:Double=value>=1e12 ? 1e12:value>=1e9 ? 1e9:value>=1e6 ? 1e6:value>=1e3 ? 1e3:1;let suffix=scale==1e12 ? "T":scale==1e9 ? "B":scale==1e6 ? "M":scale==1e3 ? "K":"";return (value/scale).formatted(.number.precision(.fractionLength(0...1)).locale(Locale(identifier:"en_US")))+suffix}
    private var creditRemaining:Double{if bucket?.unlimitedCredits==true{return 100};guard let credits,let baseline=baseline?.baseline,baseline>0 else{return 0};return min(100,max(0,credits/baseline*100))}
    private func compactCountdown(_ reset:Int,now:Date)->String {let seconds=max(0,reset-Int(now.timeIntervalSince1970)),days=seconds/86400,hours=seconds%86400/3600,minutes=seconds%3600/60;if seconds==0{return L("等待额度刷新")};if days>0{return "\(days)d\(hours)h"};if hours>0{return "\(hours)h\(minutes)m"};return "\(minutes)m"}
    var body:some View {
        TimelineView(.periodic(from:.now,by:1)){timeline in
            HStack(spacing:10){
                if credits != nil || bucket?.unlimitedCredits==true {
                    Button(action:open){VStack(spacing:1){Text("Credits").font(.system(size:9)).foregroundStyle(.secondary);Text(bucket?.unlimitedCredits==true ? "∞":shortCredits).font(.system(size:10,weight:.medium)).monospacedDigit()}.frame(width:44,height:44).background(QuotaProgressBorder(remaining:creditRemaining,stale:stale))}.buttonStyle(.plain).help("Credits: "+(bucket?.creditBalance ?? L("不限量")))
                }
                Button(action:open){HStack(spacing:6){
                    if windows.isEmpty {Text(L("额度暂不可用")).font(.caption).foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:44)}
                    ForEach(Array(windows.enumerated()),id:\.offset){_,window in
                        VStack(spacing:3){
                            HStack(spacing:4){Text(quotaPeriod(window)).foregroundStyle(.secondary);Text("\(Int(window.remainingPercent.rounded()))%").fontWeight(.semibold).monospacedDigit()}.font(.system(size:11))
                            if let reset=window.resetsAt{HStack(spacing:3){Text(Date(timeIntervalSince1970:Double(reset)),format:window.windowDurationMins==300 ? .dateTime.hour().minute():.dateTime.month(.twoDigits).day().hour().minute());Text(compactCountdown(reset,now:timeline.date))}.font(.system(size:9)).monospacedDigit().foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.75)}else{Text(L("重置时间暂不可用")).font(.system(size:9)).foregroundStyle(.secondary)}
                        }.padding(.horizontal,8).frame(maxWidth:.infinity).frame(height:44).background(QuotaProgressBorder(remaining:window.remainingPercent,stale:stale))
                    }
                }.frame(maxWidth:.infinity).contentShape(Rectangle())}.buttonStyle(.plain).help(L("账户剩余额度"))
            }
        }
    }
}
