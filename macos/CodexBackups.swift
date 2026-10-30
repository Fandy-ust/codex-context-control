import SwiftUI

private struct CodexBackupFile:Decodable {let name:String;let bytes:Double}
private struct CodexBackupPoint:Decodable,Identifiable {let id:String;let at:String;let tier:String;let files:[CodexBackupFile];let bytes:Double}
private struct CodexRestoreJob:Decodable {let phase:String;let message:String}
private struct CodexBackupsState:Decodable {let points:[CodexBackupPoint];let job:CodexRestoreJob?;let storedBytes:Double}

struct CodexBackupsView:View {
 @ObservedObject var model:Controller
 @State private var data:CodexBackupsState?
 @State private var selected:CodexBackupPoint?
 @State private var confirming=false
 @State private var saving=false
 @State private var message=""
 private var active:Bool{["waiting_exit","waiting_quiet","closing","applying","interrupted"].contains(data?.job?.phase ?? "")}
 private func size(_ bytes:Double)->String{String(format:"%.2f MB",bytes/1048576)}
 private func date(_ at:String)->String{{let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds];return formatter.date(from:at)?.formatted(date:.abbreviated,time:.standard) ?? at}()}
 var body:some View {
  VStack(alignment:.leading,spacing:14){
   Text(L("Codex 备份与恢复")).font(.headline)
   Text(L("最近 7 天每天一份，1 个月内每周一份，3 个月内每月一份；另保留最新状态。每 5 分钟检查变化，采用压缩增量备份。")).font(.caption).foregroundStyle(.secondary)
   HStack{Button(L("刷新历史")){Task{await load()}};Button(L("立即备份")){Task{await command(["action":"capture"])}}.disabled(active || saving);Spacer();Text("\(L("已用空间")): \(size(data?.storedBytes ?? 0)) / 200 MB").font(.caption)}
   if let job=data?.job{VStack(alignment:.leading,spacing:8){Text(L(job.message)).textSelection(.enabled);if active{Text(L("保持 Context Manager 运行。请勿手动重开 Codex；恢复校验成功后会自动打开。")).font(.caption)};if ["waiting_exit","waiting_quiet"].contains(job.phase){Button(L("取消恢复")){Task{await command(["action":"cancel"])}}}}.padding(12).frame(maxWidth:.infinity,alignment:.leading).background(.white.opacity(0.05),in:RoundedRectangle(cornerRadius:10))}
   if let data{if data.points.isEmpty{Text(L("还没有恢复点，点击“立即备份”创建第一份。"))};ForEach(data.points){point in VStack(alignment:.leading,spacing:7){HStack{Text(date(point.at)).font(.headline);Spacer();Button(L("查看并恢复")){selected=point;confirming=true}.disabled(active || saving)};Text("\(L(point.tier == "recent" ? "最新状态":"历史恢复点")) · \(point.files.count) \(L("个文件")) · \(size(point.bytes))").font(.caption).foregroundStyle(.secondary);ForEach(point.files,id:\.name){file in Text(file.name).font(.caption.monospaced()).foregroundStyle(.secondary)}}.padding(12).background(.white.opacity(0.035),in:RoundedRectangle(cornerRadius:10))}}
   else{ProgressView()}
   if !message.isEmpty{Text(message).font(.caption).foregroundStyle(.orange)}
  }.padding(20).alert(L("恢复此版本？"),isPresented:$confirming){
   Button(L("一键关闭 Codex、恢复并重开"),role:.destructive){if let point=selected{Task{await command(["action":"restore","id":point.id,"close":true])}}}
   Button(L("等我手动退出后恢复")){if let point=selected{Task{await command(["action":"restore","id":point.id,"close":false])}}}
   Button(L("取消"),role:.cancel){}
  }message:{Text((selected.map{date($0.at)+"\n"} ?? "")+L("将暂停管理器任务队列并关闭 Codex 和 CLI，中断运行中的任务。配置、项目分类及聊天索引将回到所选版本；聊天记录文件和项目代码保留。确认退出且恢复校验成功后才会自动重开。"))}
  .task{while !Task.isCancelled{await load();try? await Task.sleep(for:.seconds(2))}}
 }
 @MainActor private func load() async {do{data=try JSONDecoder().decode(CodexBackupsState.self,from:await model.api(ControlAPI.codexBackups,body:["action":"list"]));message=""}catch{message=error.localizedDescription}}
 @MainActor private func command(_ body:[String:Any]) async {saving=true;defer{saving=false};do{data=try JSONDecoder().decode(CodexBackupsState.self,from:await model.api(ControlAPI.codexBackups,body:body));message=""}catch{message=error.localizedDescription}}
}
