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
    init(model:Controller,initialTab:String="general",close:@escaping ()->Void={}){self.model=model;self.close=close;_tab=State(initialValue:initialTab)}
    var body:some View {
        VStack(alignment:.leading,spacing:18){
            HStack{if tab=="defaults"{Button(L("返回"),systemImage:"arrow.left"){tab="general"}.buttonStyle(.bordered)};Text(L("设置")).font(.system(size:21,weight:.semibold));Spacer();Button(action:close){Image(systemName:"xmark").foregroundStyle(.secondary)}.buttonStyle(.plain).help(L("关闭设置"))}
            Picker(L("设置分类"),selection:$tab){Text(L("通用")).tag("general");Text(L("全局默认")).tag("defaults");Text(L("账户额度")).tag("quota");Text(L("任务队列")).tag("queues");Text(L("云同步")).tag("cloud");Text(L("快捷键")).tag("shortcut")}.pickerStyle(.segmented)
            ScrollView {
                Group {
                if tab=="defaults" {NewChatDefaultsView(model:model,onClose:{tab="general"})}
                else if tab=="cloud" {CloudSyncView(model:model)}
                else if tab=="queues" {TaskQueueManagerView(model:model,open:{id in close();model.queueDetailID=id})}
                else if tab=="shortcut" {shortcutSettings}
                else if tab=="quota" {
                    VStack(alignment:.leading,spacing:18){
                        AccountQuotaSection(model:model)
                        Button(L("额度分析"),systemImage:"chart.xyaxis.line"){close();model.showQuotaAnalytics=true}.disabled(!model.supportsQuotaAnalytics)
                        HStack{Button(L("重置 Credits 基准")){Task{await model.resetCredits();feedback=model.notice}}.disabled(!model.serviceAvailable || model.quotaRefreshing || model.quota?.stale==true || model.selectedQuota?.creditBalance==nil || model.selectedQuota?.unlimitedCredits==true)
                            if let baseline=model.selectedCreditBaseline?.baseline{Text(L("当前基准：{0}",baseline.formatted(.number.precision(.fractionLength(0...8))))).font(.caption).foregroundStyle(.secondary)}}
                        Text(L("将当前余额设为新的 100%；余额增加时也会自动更新基准。")).font(.caption).foregroundStyle(.secondary)
                    }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
                }else{general}
                }.softScrollEdges()
            }
            if let feedback{Text(L(feedback)).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)}
        }.padding(24).frame(width:760,height:560).background(PanelStyle.background).preferredColorScheme(.dark).environment(\.locale,Localization.locale).onAppear{shortcutRecorder.onRecordingChanged={recording in model.onGlobalShortcutRecording?(recording)};shortcutDraft=model.globalShortcut;shortcutEnabled=model.globalShortcutEnabled}.onDisappear{shortcutRecorder.stop()}.onChange(of:tab){_,value in if value != "shortcut"{shortcutRecorder.stop()}}.onChange(of:shortcutEnabled){_,value in if !value{shortcutRecorder.stop()}}.onChange(of:shortcutRecorder.capturedShortcut){value in if let value{shortcutDraft=value;shortcutEnabled=true}}
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
        VStack(alignment:.leading,spacing:18){
            Text(L("通用")).font(.headline)
            Picker(L("语言"),selection:Binding(get:{model.languageSelection},set:{model.setLanguage($0)})){Text(L("自动（按时区）")).tag(LanguageChoice.auto);Text("中文").tag(LanguageChoice.zh);Text("English").tag(LanguageChoice.en)}.pickerStyle(.menu).accessibilityIdentifier("language-picker")
            HStack{Button(L("同步本地聊天"),systemImage:"arrow.clockwise"){Task{await model.scanChats();feedback=model.notice}}.disabled(model.working);Button(L("打开 Codex"),systemImage:"arrow.up.forward.app"){model.launchCodex()}}
            ContextExtensionControl(model:model)
            VStack(alignment:.leading,spacing:7){
                Toggle(L("提前压缩补偿（实验性）"),isOn:Binding(get:{model.compactionCompensation?.enabled ?? false},set:{value in Task{await model.setCompensation(value)}})).toggleStyle(.switch).controlSize(.small).disabled(!model.serviceAvailable || model.changingCompensation || model.compactionCompensation==nil)
                Text(L("额外的计数空间只补偿历史推理估算；本 App 显示真实请求用量和原预算，达到实际阈值仍会原生压缩。")).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                Text(L(model.compactionCompensation?.message ?? "等待 Codex 连接")).font(.caption2).foregroundStyle(.secondary)
            }.padding(12).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
            Divider()
            if model.updateState?.phase=="downloading" || model.updateState?.phase=="installing" {HStack{ProgressView().controlSize(.small);Text(L("正在更新…"))}}
            else{HStack{
                if model.updateState?.available==true {Button(L("安装更新 {0}",model.updateState?.version ?? ""),systemImage:"arrow.down.circle"){Task{await model.updateApp(install:true);feedback=model.notice}}.disabled(model.checkingUpdates)}
                Button(L("检查更新"),systemImage:"arrow.clockwise"){Task{await model.updateApp();feedback=model.notice}}.disabled(model.checkingUpdates)
                Text("v"+model.appVersion).font(.caption).foregroundStyle(.secondary)
            }}
            if model.updateState?.error != nil {Link(L("从发布页手动下载"),destination:URL(string:"https://github.com/Fandy-ust/codex-context-control/releases/latest")!).font(.callout)}
        }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
    }
}
