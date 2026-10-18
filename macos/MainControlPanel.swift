import SwiftUI

struct MainControlPanelView:View {
    @ObservedObject var model:Controller
    var close:()->Void
    @State private var tab:String
    @State private var feedback:String?
    init(model:Controller,initialTab:String="general",close:@escaping ()->Void={}){self.model=model;self.close=close;_tab=State(initialValue:initialTab)}
    var body:some View {
        VStack(alignment:.leading,spacing:18){
            HStack{if tab=="defaults"{Button(L("返回"),systemImage:"arrow.left"){tab="general"}.buttonStyle(.bordered)};Text(L("设置")).font(.system(size:21,weight:.semibold));Spacer();Button(action:close){Image(systemName:"xmark").foregroundStyle(.secondary)}.buttonStyle(.plain).help(L("关闭设置"))}
            Picker(L("设置分类"),selection:$tab){Text(L("通用")).tag("general");Text(L("全局默认")).tag("defaults");Text(L("账户额度")).tag("quota")}.pickerStyle(.segmented)
            ScrollView {
                if tab=="defaults" {NewChatDefaultsView(model:model,onClose:{tab="general"})}
                else if tab=="quota" {
                    VStack(alignment:.leading,spacing:18){
                        AccountQuotaSection(model:model)
                        Button(L("额度分析"),systemImage:"chart.xyaxis.line"){close();model.showQuotaAnalytics=true}.disabled(!model.supportsQuotaAnalytics)
                        HStack{Button(L("重置 Credits 基准")){Task{await model.resetCredits();feedback=model.notice}}.disabled(!model.serviceAvailable || model.quotaRefreshing || model.quota?.stale==true || model.selectedQuota?.creditBalance==nil || model.selectedQuota?.unlimitedCredits==true)
                            if let baseline=model.selectedCreditBaseline?.baseline{Text(L("当前基准：{0}",baseline.formatted(.number.precision(.fractionLength(0...8))))).font(.caption).foregroundStyle(.secondary)}}
                        Text(L("将当前余额设为新的 100%；余额增加时也会自动更新基准。")).font(.caption).foregroundStyle(.secondary)
                    }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
                }else{general}
            }
            if let feedback{Text(L(feedback)).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)}
        }.padding(24).frame(width:760,height:560).background(PanelStyle.background).preferredColorScheme(.dark).environment(\.locale,Localization.locale)
    }
    private var general:some View {
        VStack(alignment:.leading,spacing:18){
            Text(L("通用")).font(.headline)
            Picker(L("语言"),selection:Binding(get:{model.languageSelection},set:{model.setLanguage($0)})){Text(L("自动（按时区）")).tag(LanguageChoice.auto);Text("中文").tag(LanguageChoice.zh);Text("English").tag(LanguageChoice.en)}.pickerStyle(.menu).accessibilityIdentifier("language-picker")
            HStack{Button(L("同步本地聊天"),systemImage:"arrow.clockwise"){Task{await model.scanChats();feedback=model.notice}}.disabled(model.working);Button(L("打开 Codex"),systemImage:"arrow.up.forward.app"){model.launchCodex()}}
            ContextExtensionControl(model:model)
            Divider()
            if model.updateState?.phase=="downloading" || model.updateState?.phase=="installing" {HStack{ProgressView().controlSize(.small);Text(L("正在更新…"))}}
            else{HStack{Button(model.updateState?.available==true ? L("安装更新 {0}",model.updateState?.version ?? ""):L("检查更新"),systemImage:"arrow.down.circle"){Task{await model.updateApp(install:model.updateState?.available==true);feedback=model.notice}}.disabled(model.checkingUpdates);Text("v"+model.appVersion).font(.caption).foregroundStyle(.secondary)}}
            if model.updateState?.error != nil {Link(L("从发布页手动下载"),destination:URL(string:"https://github.com/Fandy-ust/codex-context-control/releases/latest")!).font(.callout)}
        }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:12))
    }
}
