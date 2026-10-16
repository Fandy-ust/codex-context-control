import AppKit
import SwiftUI
import CryptoKit

struct PayloadManifest:Decodable {let version:String;let arch:String;let files:[String:String]}
enum InstallFailure:LocalizedError {
    case message(String)
    var errorDescription:String? {switch self{case .message(let value):return value}}
}
@MainActor final class InstallerModel:ObservableObject {
    @Published var working=false
    @Published var finished=false
    @Published var status="将安装到当前用户的 Applications，并接入已有 Codex。"
    @Published var detail="无需 Node、Homebrew 或 Xcode；不需要管理员密码。"
    func run(uninstall:Bool=false) async {
        guard !working else{return};working=true;finished=false;status=uninstall ? "正在移除 Context Manager…":"正在校验并安装…";detail="请稍候。";defer{working=false}
        do {
            guard let resources=Bundle.main.resourceURL else{throw InstallFailure.message("找不到安装资源")}
            let output=try await Task.detached(priority:.userInitiated){try Self.execute(resources:resources,uninstall:uninstall)}.value
            status=uninstall ? "已移除 Context Manager":"安装完成"
            detail=uninstall ? "预算与备份已保留。":"请完整退出并重新打开 Codex。菜单栏会自动出现 Context Manager。Hook stats 需在 Codex 的 /hooks 中审核。"
            finished = !uninstall
            if !output.isEmpty && uninstall{detail+="\n"+output}
        }catch{status="未能完成";detail=error.localizedDescription}
    }
    nonisolated static func execute(resources:URL,uninstall:Bool) throws -> String {
        let payload=resources.appendingPathComponent("payload").resolvingSymlinksInPath().standardizedFileURL,manifest=try JSONDecoder().decode(PayloadManifest.self,from:Data(contentsOf:resources.appendingPathComponent("payload-manifest.json")))
        guard manifest.arch=="arm64" else{throw InstallFailure.message("此安装包不适用于这台 Mac")}
        var actual=Set<String>()
        guard let enumerator=FileManager.default.enumerator(at:payload,includingPropertiesForKeys:[.isRegularFileKey,.isSymbolicLinkKey]) else{throw InstallFailure.message("无法读取安装内容")}
        for case let file as URL in enumerator {
            let values=try file.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey])
            guard values.isSymbolicLink != true else{throw InstallFailure.message("安装包包含不允许的链接")}
            if values.isRegularFile == true {let normalized=file.resolvingSymlinksInPath().standardizedFileURL.path;guard normalized.hasPrefix(payload.path+"/") else{throw InstallFailure.message("安装包文件路径异常")};actual.insert(String(normalized.dropFirst(payload.path.count+1)))}
        }
        guard actual==Set(manifest.files.keys) else{let extra=actual.subtracting(manifest.files.keys).sorted().prefix(3).joined(separator:", ");let missing=Set(manifest.files.keys).subtracting(actual).sorted().prefix(3).joined(separator:", ");throw InstallFailure.message("安装包包含缺失或额外文件，请重新下载。额外：\(extra)；缺失：\(missing)")}
        for (name,expected) in manifest.files {
            let file=payload.appendingPathComponent(name).standardizedFileURL
            guard file.path.hasPrefix(payload.standardizedFileURL.path+"/"),!name.split(separator:"/").contains("..") else{throw InstallFailure.message("安装包路径无效")}
            let data=try Data(contentsOf:file,options:.mappedIfSafe)
            let digest=SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()
            guard digest==expected else{throw InstallFailure.message("安装包校验失败，请重新下载：\(name)")}
        }
        let log=FileManager.default.temporaryDirectory.appendingPathComponent("context-manager-install-\(UUID().uuidString).log")
        FileManager.default.createFile(atPath:log.path,contents:nil,attributes:[.posixPermissions:0o600])
        let handle=try FileHandle(forWritingTo:log);defer{try? handle.close();try? FileManager.default.removeItem(at:log)}
        let process=Process();process.executableURL=payload.appendingPathComponent("vendor/node");process.currentDirectoryURL=payload
        process.arguments=[payload.appendingPathComponent("scripts/install.mjs").path]+(uninstall ? ["--uninstall"]:["--use-built-panel","--bundled-node","--require-supported-runtime"])
        process.standardOutput=handle;process.standardError=handle
        try process.run();process.waitUntilExit();try handle.synchronize()
        let output=(try? String(contentsOf:log,encoding:.utf8)) ?? ""
        guard process.terminationStatus==0 else{throw InstallFailure.message(String(output.suffix(3000)))}
        return ""
    }
    func openSettings(){NSWorkspace.shared.open(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/Codex Context Control.app"))}
}
struct InstallerView:View {
    @StateObject private var model=InstallerModel()
    var body:some View {
        VStack(alignment:.leading,spacing:22){
            Label("Context Manager",systemImage:"slider.horizontal.3").font(.largeTitle.weight(.semibold))
            Text("Apple Silicon · macOS 14 或更新版本").foregroundStyle(.secondary)
            VStack(alignment:.leading,spacing:10){Text(model.status).font(.headline);Text(model.detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)}.frame(maxWidth:.infinity,alignment:.leading).padding(20).background(.quaternary,in:RoundedRectangle(cornerRadius:16))
            HStack{
                if model.working{ProgressView().controlSize(.small)}
                else{Button("移除安装"){Task{await model.run(uninstall:true)}}.foregroundStyle(.secondary)}
                Spacer()
                if model.finished{Button("打开设置"){model.openSettings()}.buttonStyle(.borderedProminent)}
                else{Button("安装 / 更新"){Task{await model.run()}}.buttonStyle(.borderedProminent).disabled(model.working)}
            }
            Text("请先安装 Codex / ChatGPT 桌面客户端。此包不包含可选的修复版 Codex 核心。").font(.caption).foregroundStyle(.secondary)
        }.padding(32).frame(width:590).preferredColorScheme(.dark)
    }
}
#if !INSTALLER_TESTING
@main struct ContextManagerInstaller:App {
    var body:some Scene {WindowGroup("安装 Context Manager"){InstallerView()}.windowResizability(.contentSize)}
}

#endif
