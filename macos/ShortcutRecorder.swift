import SwiftUI
import AppKit

@MainActor final class ShortcutRecorder:ObservableObject {
    @Published var isRecording=false
    @Published var capturedShortcut:String?
    private var monitor:Any?
    private var observers:[NSObjectProtocol]=[]
    private var epoch=0
    var onRecordingChanged:((Bool)->Void)?
    func start(){
        stop();capturedShortcut=nil;isRecording=true
        onRecordingChanged?(true)
        let key=epoch
        for name in [NSApplication.didResignActiveNotification,NSWindow.didResignKeyNotification] {
            observers.append(NotificationCenter.default.addObserver(forName:name,object:nil,queue:.main){[weak self] _ in
                Task{@MainActor [weak self] in guard let self,self.epoch==key else{return};self.stop()}
            })
        }
        monitor=NSEvent.addLocalMonitorForEvents(matching:.keyDown){[weak self] event in
            guard let self else{return event}
            if event.isARepeat{return nil}
            if event.keyCode==53{self.stop();return nil}
            guard let key=GlobalShortcutManager.keyName(for:UInt32(event.keyCode)) else{return nil}
            let flags=event.modifierFlags.intersection([.control,.option,.shift,.command])
            guard !flags.intersection([.control,.option,.command]).isEmpty else{return nil}
            var parts:[String]=[]
            if flags.contains(.control){parts.append("Control")}
            if flags.contains(.option){parts.append("Alt")}
            if flags.contains(.shift){parts.append("Shift")}
            if flags.contains(.command){parts.append("Command")}
            parts.append(key)
            guard let normalized=GlobalShortcutManager.normalized(parts.joined(separator:"+")) else{return nil}
            capturedShortcut=normalized;stop();return nil
        }
    }
    func stop(){
        epoch+=1
        if let monitor{NSEvent.removeMonitor(monitor)};monitor=nil
        for observer in observers{NotificationCenter.default.removeObserver(observer)};observers=[]
        let wasRecording=isRecording;isRecording=false;if wasRecording{onRecordingChanged?(false)}
    }
    deinit{if let monitor{NSEvent.removeMonitor(monitor)};for observer in observers{NotificationCenter.default.removeObserver(observer)}}
}

