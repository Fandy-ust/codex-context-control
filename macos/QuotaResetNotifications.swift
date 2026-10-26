import Foundation
import UserNotifications

@MainActor final class QuotaResetNotifier:NSObject,UNUserNotificationCenterDelegate {
    private var notificationCenter:UNUserNotificationCenter?
    private let key:String
    init(key:String="quota-reset-notification-delivered"){self.key=key;super.init()}
    private var authorizationTask:Task<Bool,Never>?
    func observe(_ event:QuotaResetEvent?,enabled:Bool,stale:Bool){
        guard Bundle.main.bundleIdentifier != nil else{return}
        if notificationCenter == nil{notificationCenter=UNUserNotificationCenter.current();notificationCenter?.delegate=self}
        guard let center=notificationCenter else{return}
        if enabled && authorizationTask == nil {
            authorizationTask=Task{(try? await center.requestAuthorization(options:[.alert,.sound])) ?? false}
        }
        guard let event,event.id != UserDefaults.standard.string(forKey:key) else{return}
        let now=Date().timeIntervalSince1970*1000
        if enabled && (stale || now<event.deliverAfter){return}
        // Persist before delivery to avoid replaying a banner after app restarts.
        UserDefaults.standard.set(event.id,forKey:key)
        guard enabled,now-event.at<=600000 else{return}
        let both=event.roles.contains("five") && event.roles.contains("weekly")
        let content=UNMutableNotificationContent()
        content.title="Context Manager"
        content.body=L(event.roles.contains("credits") ? "套餐额度已耗尽，后续请求可能使用 Credits。":both ? "5 小时和每周额度都已重置":event.roles.contains("weekly") ? "每周额度已重置":"5 小时额度已重置")
        content.sound = .default
        Task{
            if let authorizationTask{_ = await authorizationTask.value}
            let settings=await center.notificationSettings()
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else{return}
            do{try await center.add(UNNotificationRequest(identifier:event.id,content:content,trigger:nil))}
            catch{NSLog("Quota notification delivery failed: %@",error.localizedDescription)}
        }
    }
    nonisolated func userNotificationCenter(_ center:UNUserNotificationCenter,willPresent notification:UNNotification,withCompletionHandler completionHandler:@escaping (UNNotificationPresentationOptions)->Void){
        completionHandler([.banner,.sound])
    }
}
