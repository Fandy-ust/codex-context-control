import Foundation

enum RefreshSchedule {
    static func interval(menuVisible:Bool,settingsVisible:Bool,runningChats:Int,connected:Bool,serviceAvailable:Bool)->TimeInterval {
        if menuVisible{return 1}
        if settingsVisible || runningChats>0{return 2}
        if !serviceAvailable || !connected{return 15}
        return 6
    }
    static func tolerance(for interval:TimeInterval)->TimeInterval {min(2,interval*0.15)}
}
