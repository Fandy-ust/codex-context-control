import SwiftUI

struct QuotaActivationView:View {
    @ObservedObject var model:Controller
    @State private var notifications=true
    @State private var weekly=false
    @State private var scheduled=false
    @State private var date=Date().addingTimeInterval(3600)
    @State private var tolerance=10
    @State private var saving=false
    @State private var message=""
    private var active:Bool{model.quotaActivation?.busy == true || ["waiting","running","verifying"].contains(model.quotaActivation?.job?.status ?? "")}
    var body:some View {
        VStack(alignment:.leading,spacing:14){
            Text(L("额度启动")).font(.headline)
            Toggle(L("额度重置系统通知"),isOn:$notifications).toggleStyle(.switch)
            Text(L("5 小时、每周额度重置时提醒；同时重置合并通知。需保持管理器在后台运行，并允许系统通知。无需开启自动发消息。")).font(.caption).foregroundStyle(.secondary)
            Text(L("使用 GPT-6 Luna 发送独立短消息，收到回复即停止，每次最多尝试 3 次。")).font(.caption).foregroundStyle(.secondary)
            Toggle(L("周额度重置后自动启动"),isOn:$weekly).toggleStyle(.switch)
            Stepper(L("重置时间容差（分钟）：{0}",String(tolerance)),value:$tolerance,in:1...60)
            Text(L("以新到期时间接近当前时间 + 7 天确认周重置；预约启动则检查 + 5 小时。")).font(.caption).foregroundStyle(.secondary)
            Toggle(L("一次性预约（本机时间）"),isOn:$scheduled).toggleStyle(.switch)
            if scheduled{DatePicker(L("触发时间"),selection:$date,in:Date()...,displayedComponents:[.date,.hourAndMinute])}
            Text(L("电脑需保持唤醒、服务运行；错过超过 15 分钟不补发。")).font(.caption).foregroundStyle(.secondary)
            HStack{
                Button(L("保存设置")){Task{await command(["action":"configure","notificationsEnabled":notifications,"weeklyEnabled":weekly,"toleranceMinutes":tolerance,"scheduledAt":scheduled ? Int64(date.timeIntervalSince1970*1000) as Any:NSNull()])}}
                Button(L("立即启动一次")){Task{await command(["action":"run"])}}.disabled(active)
                Button(L("停止并取消预约")){Task{await command(["action":"cancel"]);scheduled=false}}
            }.disabled(saving || !model.serviceAvailable)
            if let job=model.quotaActivation?.job{Text("\(job.status) · \(job.attempts)/3 · \(L(job.message ?? ""))").font(.caption)}
            if !message.isEmpty{Text(message).font(.caption)}
            Divider()
            Text(L("起床前提前多久")).font(.headline)
            if let r=model.quotaActivation?.recommendation,let lead=r.leadHours{
                Text(L("建议提前 {0} 小时触发",lead.formatted()))
                Text(L("近期 {0} 个周期，预计活跃使用 {1} 小时用完；建议范围提前 {2}–{3} 小时。",String(r.sampleCount),(r.consumptionHours ?? 0).formatted(),(r.leadMinHours ?? 0).formatted(),(r.leadMaxHours ?? 0).formatted())).font(.caption)
            }else{Text(L("有效历史不足，至少需要 3 个有足够用量的周期。")).font(.caption)}
            Text(L("按近 21 天、最多 10 个周期估算：提前量 = 5 小时 − 预计用完时间。由你按起床时间设置预约，不保证实际耗尽时间。")).font(.caption).foregroundStyle(.secondary)
        }.padding(20).onAppear{if let c=model.quotaActivation?.config{notifications=c.notificationsEnabled != false;weekly=c.weeklyEnabled;tolerance=c.toleranceMinutes;scheduled=c.scheduledAt != nil;if let at=c.scheduledAt{date=Date(timeIntervalSince1970:at/1000)}}}
    }
    private func command(_ body:[String:Any]) async {
        saving=true;defer{saving=false}
        do{model.quotaActivation=try JSONDecoder().decode(QuotaActivationState.self,from:await model.api(ControlAPI.quotaActivation,body:body));message=L("设置已保存")}
        catch{message=error.localizedDescription}
    }
}
