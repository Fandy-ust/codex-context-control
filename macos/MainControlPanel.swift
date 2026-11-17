import SwiftUI
import AppKit

struct MainControlPanelView:View {
    @ObservedObject var model:Controller
    var close:()->Void
    @State private var tab:String
    @State private var feedback:String?
    @State private var shortcutDraft="Control+Shift+M"
    @State private var shortcutEnabled=true
    @StateObject private var shortcutRecorder=ShortcutRecorder()
    @State private var reminderDraft:ContextReminderConfig?
    @State private var reminderDirty=false
    @State private var reminderExpanded=false
    @State private var reminderBusy=false
    @State private var reminderRevision=0
    @State private var reminderPreview=""
    init(model:Controller,initialTab:String="general",close:@escaping ()->Void={}){self.model=model;self.close=close;_tab=State(initialValue:initialTab)}
    private var group:String {switch tab {case "shortcut":return "general";case "activation":return "automation";case "backups":return "cloud";default:return tab}}
    private var categories:[(String,String,String)] {
        [("general","通用","slider.horizontal.3"),("defaults","上下文","text.alignleft"),("accounts","账号管理","person.crop.circle"),("queues","任务队列","list.bullet"),("quota","账户额度","chart.bar"),("automation","自动化","arrow.triangle.2.circlepath"),("cloud","数据与同步","externaldrive"),("experimental","实验性功能","flask"),("about","关于与维护","info.circle")]
    }
    var body:some View {
        VStack(spacing:0){
            HStack{Text(L("设置")).font(.system(size:21,weight:.semibold));Spacer();Button(action:close){Image(systemName:"xmark").foregroundStyle(.secondary)}.buttonStyle(.plain).help(L("关闭设置"))}.padding(24)
            Divider()
            HStack(alignment:.top,spacing:0){
                VStack(alignment:.leading,spacing:5){
                    ForEach(categories,id:\.0){item in
                        Button{tab=item.0}label:{Label(L(item.1),systemImage:item.2).frame(maxWidth:.infinity,alignment:.leading).padding(.horizontal,10).padding(.vertical,11).background(group==item.0 ? Color.white.opacity(0.08):Color.clear,in:RoundedRectangle(cornerRadius:9))}.buttonStyle(.plain).foregroundStyle(group==item.0 ? Color.primary:Color.secondary)
                    }
                    Spacer()
                }.padding(12).frame(width:174).frame(maxHeight:.infinity).background(.white.opacity(0.015))
                Divider()
                ScrollView {
                    VStack(alignment:.leading,spacing:18){
                        if tab=="shortcut"{Button(L("返回通用"),systemImage:"arrow.left"){tab="general"}.buttonStyle(.plain)}
                        if group=="automation"{Picker(L("自动化"),selection:$tab){Text(L("队列与切号")).tag("automation");Text(L("额度保护与预约")).tag("activation")}.pickerStyle(.segmented)}
                        if group=="cloud"{Picker(L("数据与同步"),selection:$tab){Text(L("云同步")).tag("cloud");Text(L("备份与恢复")).tag("backups")}.pickerStyle(.segmented)}
                        panelContent
                        if let feedback{Text(L(feedback)).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)}
                    }.padding(24).frame(maxWidth:.infinity,alignment:.leading).softScrollEdges()
                }
            }
        }.frame(width:920,height:640).background(PanelStyle.background).preferredColorScheme(.dark).environment(\.locale,Localization.locale).onAppear{shortcutRecorder.onRecordingChanged={recording in model.onGlobalShortcutRecording?(recording)};shortcutDraft=model.globalShortcut;shortcutEnabled=model.globalShortcutEnabled}.onDisappear{shortcutRecorder.stop()}.onChange(of:tab){_,value in if value != "shortcut"{shortcutRecorder.stop()}}.onChange(of:shortcutEnabled){_,value in if !value{shortcutRecorder.stop()}}.onChange(of:shortcutRecorder.capturedShortcut){value in if let value{shortcutDraft=value;shortcutEnabled=true}}
    }
    @ViewBuilder private var panelContent:some View {
        if tab=="defaults" {
            ContextExtensionControl(model:model)
            NewChatDefaultsView(model:model,onClose:{tab="general"})
        }else if tab=="accounts" {AccountSwitcherView(model:model)}
        else if tab=="backups" {CodexBackupsView(model:model)}
        else if tab=="cloud" {CloudSyncView(model:model)}
        else if tab=="queues" {
            HStack{Text(L("任务队列")).font(.headline);Spacer();Button(L("自动化设置")){tab="automation"}}
            TaskQueueManagerView(model:model,open:{id in close();model.queueDetailID=id})
        }else if tab=="automation" {QueueAutomationSettings(model:model)}
        else if tab=="activation" {QuotaActivationView(model:model)}
        else if tab=="shortcut" {shortcutSettings}
        else if tab=="experimental" {experimental}
        else if tab=="about" {maintenance}
        else if tab=="quota" {
                    VStack(alignment:.leading,spacing:18){
                        AccountQuotaSection(model:model)
                        Button(L("额度分析"),systemImage:"chart.xyaxis.line"){close();model.showQuotaAnalytics=true}.disabled(!model.supportsQuotaAnalytics)
                        HStack{Button(L("重置 Credits 基准")){Task{await model.resetCredits();feedback=model.notice}}.disabled(!model.serviceAvailable || model.quotaRefreshing || model.quota?.stale==true || model.selectedQuota?.creditBalance==nil || model.selectedQuota?.unlimitedCredits==true)
                            if let baseline=model.selectedCreditBaseline?.baseline{Text(L("当前基准：{0}",baseline.formatted(.number.precision(.fractionLength(0...8))))).font(.caption).foregroundStyle(.secondary)}}
                        Text(L("将当前余额设为新的 100%；余额增加时也会自动更新基准。")).font(.caption).foregroundStyle(.secondary)
                    }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))

        }else {general}
    }
    private var shortcutSettings:some View {
        VStack(alignment:.leading,spacing:16){
            Text(L("显示 / 隐藏主窗口")).font(.headline)
            Toggle(L("启用全局快捷键"),isOn:$shortcutEnabled).toggleStyle(.switch).controlSize(.small)
            Text(L("按下快捷键可显示或隐藏主窗口。清空后不注册快捷键。")).font(.caption).foregroundStyle(.secondary)
            TextField(L("快捷键"),text:$shortcutDraft).textFieldStyle(.roundedBorder).disabled(!shortcutEnabled || shortcutRecorder.isRecording).overlay(alignment:.trailing){if shortcutRecorder.isRecording{Text(L("按下组合键…")).font(.caption).foregroundStyle(.secondary).padding(.trailing,8)}}
            Text(L("使用 Ctrl、Alt 或 Command 加字母或数字，可同时加 Shift，例如 Ctrl+Shift+M。" )).font(.caption).foregroundStyle(.secondary)
            HStack{
                Button(L(shortcutRecorder.isRecording ? "取消录制":"录制快捷键")){if shortcutRecorder.isRecording{shortcutRecorder.stop()}else{shortcutEnabled=true;shortcutRecorder.start()}}
                Button(L("恢复默认")){shortcutRecorder.stop();shortcutDraft="Control+Shift+M";shortcutEnabled=true}
                Button(L("清空快捷键")){shortcutRecorder.stop();shortcutDraft="";shortcutEnabled=false}
                Spacer()
                Button(L("保存设置"),systemImage:"checkmark"){
                    let saved=model.saveGlobalShortcutSettings(shortcutDraft,enabled:shortcutEnabled)
                    if saved{shortcutDraft=model.globalShortcut;shortcutEnabled=model.globalShortcutEnabled}
                    if saved{feedback=L("快捷键设置已保存")}else{feedback=model.globalShortcutError}
                }.buttonStyle(.borderedProminent).disabled(shortcutRecorder.isRecording)
            }
            if shortcutRecorder.isRecording{Text(L("按下组合键…")).font(.caption).foregroundStyle(.secondary)}
            else if let error=model.globalShortcutError{Label(error,systemImage:"exclamationmark.triangle").font(.caption).foregroundStyle(.orange)}
            else if model.globalShortcutRegistered{Label(L("快捷键已生效"),systemImage:"checkmark.circle").font(.caption).foregroundStyle(.green)}
            else{Label(L("快捷键已关闭"),systemImage:"minus.circle").font(.caption).foregroundStyle(.secondary)}
        }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
    }
    private var general:some View {
        VStack(alignment:.leading,spacing:22){
            Text(L("语言")).font(.headline)
            Picker(L("语言"),selection:Binding(get:{model.languageSelection},set:{model.setLanguage($0)})){Text(L("自动（按时区）")).tag(LanguageChoice.auto);Text("中文").tag(LanguageChoice.zh);Text("English").tag(LanguageChoice.en)}.pickerStyle(.menu).accessibilityIdentifier("language-picker")
            Divider()
            HStack{VStack(alignment:.leading,spacing:8){Text(L("窗口快捷键")).font(.headline);Text(shortcutEnabled ? shortcutDraft:L("已关闭")).font(.caption).foregroundStyle(.secondary)};Spacer();Button(L("修改")){tab="shortcut"}}
        }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
    }
    private var experimental:some View {
        VStack(alignment:.leading,spacing:16){
            Text(L("实验性功能")).font(.headline)
            Toggle(L("工作中提醒上下文状态"),isOn:Binding(get:{model.contextReminders?.enabled==true},set:{enabled in Task{await model.setContextReminders(enabled)}})).toggleStyle(.switch).disabled(!model.serviceAvailable || model.changingContextReminders).accessibilityIdentifier("context-reminders-toggle")
            Text(L("默认关闭。工具执行后按上下文变化补充短状态，压缩后重新提醒；不打断当前轮次，也不自动扩容或压缩。")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
            Text(L(model.contextReminders?.message ?? "上下文提醒已关闭")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
            Text(L("开启后请在 Codex 设置的 Hooks 中审核并信任新增 Hook，已运行的会话可能需要重新打开。提醒会占用少量上下文；暂不覆盖所有工具。")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
            if let error=model.contextReminders?.error{Text(error).font(.caption).foregroundStyle(.orange)}
            Toggle(L("为所有聊天开启自动管理"),isOn:Binding(get:{model.contextReminders?.allChats==true},set:{value in Task{await model.setAllContextReminders(value)}})).toggleStyle(.switch).disabled(!model.serviceAvailable || model.changingContextReminders || model.contextReminders?.enabled != true).accessibilityIdentifier("context-reminders-all-toggle")
            Text(L("默认关闭，需逐个开启。打开后现有和新聊天默认开启，仍可在单个聊天中关闭。")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
            Toggle(L("上下文管理开发通知"),isOn:Binding(get:{model.contextReminders?.operationNotifications==true},set:{value in Task{await model.setContextOperationNotifications(value)}})).toggleStyle(.switch).disabled(!model.serviceAvailable || model.changingContextReminders).accessibilityIdentifier("context-development-notifications-toggle")
            Text(L("默认关闭。发送状态提醒，或 CLI 请求扩容、压缩时显示系统通知。")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
            DisclosureGroup(L("实验参数"),isExpanded:$reminderExpanded){reminderEditors}
        }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12)).onAppear{if reminderDraft==nil{loadReminderDraft()}}.onChange(of:model.contextReminders?.revision){_,_ in if !reminderDirty{loadReminderDraft()}}
    }
    private func loadReminderDraft(){reminderDraft=model.contextReminders?.config;reminderRevision=model.contextReminders?.revision ?? 0;reminderDirty=false;reminderPreview=""}
    private func reminderText(_ key:WritableKeyPath<ContextReminderConfig,String>)->Binding<String>{Binding(get:{reminderDraft?[keyPath:key] ?? ""},set:{value in guard var draft=reminderDraft else{return};draft[keyPath:key]=value;reminderDraft=draft;reminderDirty=true;reminderPreview=""})}
    private func reminderNumber(_ key:WritableKeyPath<ContextReminderFrequency,Int>)->Binding<Int>{Binding(get:{reminderDraft?.frequency[keyPath:key] ?? 0},set:{value in guard var draft=reminderDraft else{return};draft.frequency[keyPath:key]=value;reminderDraft=draft;reminderDirty=true;reminderPreview=""})}
    private func reminderField(_ label:String,_ key:WritableKeyPath<ContextReminderFrequency,Int>)->some View {HStack{Text(L(label)).font(.caption);Spacer();TextField("",value:reminderNumber(key),format:.number.grouping(.never)).textFieldStyle(.roundedBorder).frame(width:105)}}
    private var reminderEditors:some View {
        VStack(alignment:.leading,spacing:14){
            Text(L("参数保存在本机，保存后从下一次 Hook 调用生效。可以关闭提醒后先编辑和预览。")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
            if reminderDraft != nil {
                Text(L("英文提示词")).font(.headline)
                TextEditor(text:reminderText(\.prompt)).font(.system(size:12,design:.monospaced)).frame(height:180).accessibilityIdentifier("reminder-prompt")
                Text(L("完整提示词在启用后的首个有效 Hook、手动提交和压缩后发送；后续工具提醒只发送状态。")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                Text(L("上下文信息嵌入格式")).font(.headline)
                TextEditor(text:reminderText(\.template)).font(.system(size:12,design:.monospaced)).frame(height:200).accessibilityIdentifier("reminder-template")
                DisclosureGroup(L("可用占位符")){
                    Text((model.contextReminders?.placeholders ?? []).map{"{"+$0+"}"}.joined(separator:" · ")).font(.system(size:11,design:.monospaced)).textSelection(.enabled).fixedSize(horizontal:false,vertical:true)
                    Text(L("使用 _raw 字段可生成 JSON 数字；未知值为 null。模板只进行文本替换，不执行代码。")).font(.caption).foregroundStyle(.secondary)
                }
                Text(L("嵌入频率")).font(.headline)
                reminderFrequency
                Text(L("新轮次和压缩后始终提醒。工具完成后：状态变化满足最短间隔，或达到常规间隔且满足调用次数或增量条件，或达到最长间隔时注入。不会为提醒单独启动轮次。")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                reminderButtons
                if reminderDirty{Text(L("尚未保存")).font(.caption).foregroundStyle(.orange)}
                if !reminderPreview.isEmpty{Text(L("预览不会发送给模型；缺少观测时显示 unknown。")).font(.caption).foregroundStyle(.secondary);Text(reminderPreview).font(.system(size:11,design:.monospaced)).textSelection(.enabled).fixedSize(horizontal:false,vertical:true)}
            }
        }.padding(.top,14)
    }
    private var reminderFrequency:some View {VStack(spacing:10){
        reminderField("状态变化最短间隔（秒）",\.minIntervalSeconds)
        reminderField("常规提醒最短间隔（秒）",\.intervalSeconds)
        reminderField("累计工具调用次数",\.toolCalls)
        reminderField("上下文增量（tokens，0 为关闭）",\.growthTokens)
        reminderField("最长提醒间隔（秒）",\.maxIntervalSeconds)
    }}
    private var reminderButtons:some View {HStack{
        Button(L("预览嵌入内容")){guard let config=reminderDraft else{return};reminderBusy=true;Task{defer{reminderBusy=false};do{reminderPreview=try await model.previewContextReminderConfig(config)}catch{feedback=error.localizedDescription}}}
        Button(L("恢复默认参数")){reminderBusy=true;Task{defer{reminderBusy=false};do{reminderDraft=try await model.defaultContextReminderConfig();reminderDirty=true;reminderPreview=""}catch{feedback=error.localizedDescription}}}
        Button(L("重新载入")){loadReminderDraft()}
        Spacer()
        Button(L("保存实验参数")){guard let config=reminderDraft else{return};reminderBusy=true;Task{defer{reminderBusy=false};if await model.saveContextReminderConfig(config,revision:reminderRevision){loadReminderDraft()};feedback=model.notice}}.buttonStyle(.borderedProminent)
    }.disabled(reminderBusy || !model.serviceAvailable)}
    private var maintenance:some View {
        VStack(alignment:.leading,spacing:18){
            HStack{Text("Context Manager").font(.headline);Spacer();Text("v"+model.appVersion).foregroundStyle(.secondary)}
            if model.updateState?.phase=="downloading" || model.updateState?.phase=="installing" {HStack{ProgressView().controlSize(.small);Text(L("正在更新…"))}}
            else{HStack{
                if model.updateState?.available==true {Button(L("安装更新 {0}",model.updateState?.version ?? ""),systemImage:"arrow.down.circle"){Task{await model.updateApp(install:true);feedback=model.notice}}.disabled(model.checkingUpdates)}
                Button(L("检查更新"),systemImage:"arrow.clockwise"){Task{await model.updateApp();feedback=model.notice}}.disabled(model.checkingUpdates)
            }}
            if model.updateState?.error != nil {Link(L("从发布页手动下载"),destination:URL(string:"https://github.com/Fandy-ust/codex-context-control/releases/latest")!).font(.callout)}
            Divider()
            Text(L("维护工具")).font(.headline)
            HStack{Button(L("同步本地聊天"),systemImage:"arrow.clockwise"){Task{await model.scanChats();feedback=model.notice}}.disabled(model.working);Button(L("打开 Codex"),systemImage:"arrow.up.forward.app"){model.launchCodex()}}
        }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
    }
}
