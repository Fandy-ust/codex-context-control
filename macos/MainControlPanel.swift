import SwiftUI
import AppKit

private enum ControlPanelTab:String,CaseIterable,Identifiable {
    case general,defaults,quota,integration,shortcut
    var id:String {rawValue}
    var title:String {
        switch self {
        case .general:return L("通用")
        case .defaults:return L("全局默认")
        case .quota:return L("账户额度")
        case .integration:return L("Codex 接入")
        case .shortcut:return L("快捷键")
        }
    }
}

// Match the Windows settings structure while keeping native SwiftUI controls,
// system materials, accessibility and Liquid Glass on supported SDKs/systems.
private struct FloatingSettingsMaterial:ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @ViewBuilder func body(content:Content)->some View {
        if reduceTransparency {
            content.background(Color(nsColor:.windowBackgroundColor),in:RoundedRectangle(cornerRadius:26,style:.continuous))
        } else {
            #if compiler(>=6.2)
            if #available(macOS 26.0,*) {
                content.glassEffect(.regular,in:RoundedRectangle(cornerRadius:26,style:.continuous))
            } else {
                content.background(.regularMaterial,in:RoundedRectangle(cornerRadius:26,style:.continuous))
            }
            #else
            content.background(.regularMaterial,in:RoundedRectangle(cornerRadius:26,style:.continuous))
            #endif
        }
    }
}

struct MainControlPanelView:View {
    @ObservedObject var model:Controller
    var close:()->Void = {}
    @State private var tab:ControlPanelTab = .general
    @State private var feedback:String?
    private var integrationRegistered:Bool {FileManager.default.fileExists(atPath:model.home.appendingPathComponent("automatic-startup.json").path)}
    var body:some View {
        VStack(alignment:.leading,spacing:0) {
            HStack {
                Text(L("设置")).font(.title2.weight(.semibold))
                Spacer()
                Button(action:close){Image(systemName:"xmark").frame(width:22,height:22)}
                    .buttonStyle(.borderless).help(L("关闭设置")).accessibilityLabel(L("关闭设置"))
            }.padding(.horizontal,24).padding(.top,22).padding(.bottom,16)
            Picker(L("设置分类"),selection:$tab){ForEach(ControlPanelTab.allCases){item in Text(item.title).tag(item)}}
                .pickerStyle(.segmented).labelsHidden().padding(.horizontal,24).padding(.bottom,16)
            Divider()
            ScrollView {
                VStack(alignment:.leading,spacing:18){
                    switch tab {
                    case .general:general
                    case .defaults:NewChatDefaultsView(model:model,onClose:{tab = .general},compact:true)
                    case .quota:AccountQuotaSection(model:model)
                    case .integration:integration
                    case .shortcut:shortcut
                    }
                    if let feedback{Text(L(feedback)).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)}
                }.padding(24).frame(maxWidth:.infinity,alignment:.leading)
            }.scrollIndicators(.automatic)
        }
        .frame(width:760,height:560)
        .modifier(FloatingSettingsMaterial())
        .overlay(RoundedRectangle(cornerRadius:26,style:.continuous).stroke(.primary.opacity(0.12),lineWidth:0.7))
        .shadow(color:.black.opacity(0.28),radius:35,y:16)
        .onExitCommand(perform:close)
        .environment(\.locale,Localization.locale)
    }
    private var general:some View {
        VStack(alignment:.leading,spacing:18){
            Text(L("通用")).font(.headline)
            LabeledContent(L("语言")) {
                Picker(L("语言"),selection:Binding(get:{model.languageSelection},set:{model.setLanguage($0)})){
                    Text(L("自动（按时区）")).tag(LanguageChoice.auto)
                    Text("中文").tag(LanguageChoice.zh)
                    Text("English").tag(LanguageChoice.en)
                }.pickerStyle(.menu).labelsHidden().frame(width:240).accessibilityIdentifier("language-picker")
            }
            ContextExtensionControl(model:model)
            HStack {
                Button{Task{await model.scanChats();feedback=model.notice}} label:{Label(L("同步本地聊天"),systemImage:"arrow.clockwise")}.disabled(model.working)
                Button{model.launchCodex()} label:{Label(L("打开 Codex"),systemImage:"arrow.up.forward.app")}
            }.buttonStyle(.bordered)
            Divider()
            HStack {
                Button{Task{await model.updateApp(install:model.updateState?.available == true);feedback=model.notice}} label:{
                    Label(model.updateState?.available == true ? L("安装更新 {0}",model.updateState?.version ?? ""):L("检查更新"),systemImage:"arrow.down.circle")
                }.disabled(model.checkingUpdates || model.updateState?.phase=="downloading" || model.updateState?.phase=="installing")
                if model.checkingUpdates {ProgressView().controlSize(.small)}
                Spacer()
                Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "").font(.caption).foregroundStyle(.secondary)
            }.buttonStyle(.bordered)
            Button(L("打开接入日志")){openLogs()}.buttonStyle(.bordered)
            Text(L("旧版提前压缩修复已停用，原生自动压缩和聊天压缩阈值仍保留。")).font(.caption).foregroundStyle(.secondary)
        }
    }
    private var integration:some View {
        VStack(alignment:.leading,spacing:16){
            Text(L("Codex 接入")).font(.headline)
            Label(model.bridgeCount>0 ? L("已接入 Codex。"):integrationRegistered ? L("已登记接入，重开 Codex 后生效"):L("等待 Codex 连接"),systemImage:model.bridgeCount>0 ? "checkmark.circle":"clock")
            Text(L("macOS 安装器负责原生启动接入；安装或升级后，完整退出并重开 Codex。不会替换官方运行时。")).foregroundStyle(.secondary)
            HStack{Button(L("打开 Codex")){model.launchCodex()};Button(L("打开接入日志")){openLogs()}}.buttonStyle(.bordered)
            Text(L(model.notice)).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
        }
    }
    private var shortcut:some View {
        VStack(alignment:.leading,spacing:16){
            Text(L("快捷键")).font(.headline)
            LabeledContent(L("显示 / 隐藏主窗口")){Text("⌘M").font(.system(.title3,design:.monospaced))}
            Text(L("macOS 使用应用菜单快捷键 Command + M；Windows 保留可自定义的全局快捷键。")).foregroundStyle(.secondary)
        }
    }
    private func openLogs(){
        let directory=model.home.appendingPathComponent("logs",isDirectory:true)
        do{try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true);NSWorkspace.shared.open(directory)}catch{feedback=error.localizedDescription}
    }
}
