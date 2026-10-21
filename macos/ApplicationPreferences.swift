import Foundation

/// The shared data directory is unchanged. Move only native UI preferences from
/// the legacy panel identity; existing preferences under the product ID win.
enum ApplicationPreferences {
    static let productID="io.github.codex-context-control"
    static let legacyID="io.github.codex-context-control.panel"
    static let migrationKey="context-manager-native-preferences-migrated"
    static func migrate(defaults:UserDefaults = .standard,identifier:String?=Bundle.main.bundleIdentifier,legacy:String=legacyID){
        guard let identifier,identifier != legacy else{return}
        var current=defaults.persistentDomain(forName:identifier) ?? [:]
        guard current[migrationKey] as? Bool != true else{return}
        let previous=defaults.persistentDomain(forName:legacy) ?? [:]
        for (key,value) in previous where current[key]==nil{current[key]=value}
        current[migrationKey]=true
        defaults.setPersistentDomain(current,forName:identifier)
    }
}
