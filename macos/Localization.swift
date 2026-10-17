import Foundation

enum LanguageChoice:String,CaseIterable {case auto,zh,en}

/// Shared, local-only preference used by the app, installer, and Stop hook.
/// Keep Chinese source keys stable so stored runtime messages can be translated at display time.
final class Localization:@unchecked Sendable {
    static let shared=Localization()
    static let didChange=Notification.Name("ContextManagerLanguageChanged")
    private let lock=NSRecursiveLock()
    private var selected:LanguageChoice
    private let english:[String:String]
    private let reverse:[String:String]
    private let templates:[Template]
    private let file:URL
    private struct Template {let source:String;let target:String;let sourcePattern:NSRegularExpression;let targetPattern:NSRegularExpression;let indices:[Int];let targetIndices:[Int]}
    static let chineseTimeZones:Set<String>=["Asia/Shanghai","Asia/Hong_Kong","Asia/Macau","Asia/Macao","Asia/Taipei","Asia/Chongqing","Asia/Chungking","Asia/Harbin","Asia/Urumqi","Asia/Kashgar","PRC","Hongkong","ROC"]
    static func resolve(_ choice:LanguageChoice,timeZone:String)->LanguageChoice {
        choice == .auto ? (chineseTimeZones.contains(timeZone) ? .zh:.en):choice
    }
    static var language:LanguageChoice {shared.language}
    static var choice:LanguageChoice {shared.choice}
    static var locale:Locale {Locale(identifier:language == .zh ? "zh_Hans":"en_US")}
    private var language:LanguageChoice {lock.lock();defer{lock.unlock()};return Self.resolve(selected,timeZone:TimeZone.autoupdatingCurrent.identifier)}
    private var choice:LanguageChoice {lock.lock();defer{lock.unlock()};return selected}
    private init(){
        let environment=ProcessInfo.processInfo.environment
        let home=environment["CONTEXT_CONTROL_HOME"].map{URL(fileURLWithPath:$0)} ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/CodexContextControl")
        file=home.appendingPathComponent("language.json")
        let preference=(try? Data(contentsOf:file)).flatMap{try? JSONSerialization.jsonObject(with:$0) as? [String:Any]}
        selected=LanguageChoice(rawValue:preference?["selection"] as? String ?? "auto") ?? .auto
        let resource=environment["CONTEXT_CONTROL_LOCALIZATION_FILE"].map{URL(fileURLWithPath:$0)} ?? Bundle.main.url(forResource:"localization-en",withExtension:"json")
        english=resource.flatMap{try? Data(contentsOf:$0)}.flatMap{try? JSONDecoder().decode([String:String].self,from:$0)} ?? [:]
        reverse=Dictionary(english.sorted{$0.key<$1.key}.map{($0.value,$0.key)},uniquingKeysWith:{first,_ in first})
        templates=english.compactMap{key,value in
            guard key.range(of:#"\{\d+\}"#,options:.regularExpression) != nil else{return nil}
            let source=Self.pattern(key),target=Self.pattern(value)
            return Template(source:key,target:value,sourcePattern:source.0,targetPattern:target.0,indices:source.1,targetIndices:target.1)
        }.sorted{$0.source.count>$1.source.count}
    }
    static func setChoice(_ value:LanguageChoice) throws {
        let owner=shared;owner.lock.lock();defer{owner.lock.unlock()}
        let data=try JSONSerialization.data(withJSONObject:["version":1,"selection":value.rawValue],options:.sortedKeys)
        try FileManager.default.createDirectory(at:owner.file.deletingLastPathComponent(),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        try data.write(to:owner.file,options:.atomic)
        try? FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:owner.file.path)
        owner.selected=value
        NotificationCenter.default.post(name:didChange,object:nil)
    }
    private static let placeholder=try! NSRegularExpression(pattern:#"\{(\d+)\}"#)
    private static func pattern(_ text:String)->(NSRegularExpression,[Int]) {
        let ns=text as NSString,matches=placeholder.matches(in:text,range:NSRange(location:0,length:ns.length))
        var pattern="^",offset=0,indices:[Int]=[]
        for match in matches{pattern+=NSRegularExpression.escapedPattern(for:ns.substring(with:NSRange(location:offset,length:match.range.location-offset)))+"(.*?)";offset=NSMaxRange(match.range);indices.append(Int(ns.substring(with:match.range(at:1)))!)}
        pattern+=NSRegularExpression.escapedPattern(for:ns.substring(from:offset))+"$"
        return (try! NSRegularExpression(pattern:pattern,options:.dotMatchesLineSeparators),indices)
    }
    private static func fill(_ text:String,_ values:[Int:String])->String {
        let ns=text as NSString,matches=placeholder.matches(in:text,range:NSRange(location:0,length:ns.length))
        var result="",offset=0
        for match in matches{result+=ns.substring(with:NSRange(location:offset,length:match.range.location-offset));let index=Int(ns.substring(with:match.range(at:1)))!;result+=values[index] ?? ns.substring(with:match.range);offset=NSMaxRange(match.range)}
        return result+ns.substring(from:offset)
    }
    private func translate(_ text:String,into language:LanguageChoice)->String {
        if language == .en,let value=english[text]{return value}
        if language == .zh,english[text] != nil{return text}
        if language == .zh,let value=reverse[text]{return value}
        let hasChinese=text.range(of:#"[\p{Han}]"#,options:.regularExpression) != nil
        guard language == .zh || hasChinese else{return text}
        let ns=text as NSString
        for template in templates {
            let pattern=language == .en ? template.sourcePattern:template.targetPattern
            guard let match=pattern.firstMatch(in:text,range:NSRange(location:0,length:ns.length)) else{continue}
            let indices=language == .en ? template.indices:template.targetIndices
            var values:[Int:String]=[:]
            for (index,key) in indices.enumerated(){values[key]=ns.substring(with:match.range(at:index+1))}
            return Self.fill(language == .en ? template.target:template.source,values)
        }
        if text.contains("\n"){return text.components(separatedBy:"\n").map{translate($0,into:language)}.joined(separator:"\n")}
        return text
    }
    static func text(_ key:String,_ arguments:[Any]=[])->String {
        let owner=shared,language=owner.language
        let translated=owner.translate(key,into:language)
        guard !arguments.isEmpty else{return translated}
        return fill(translated,Dictionary(uniqueKeysWithValues:arguments.enumerated().map{($0.offset,String(describing:$0.element))}))
    }
    static func canonical(_ text:String)->String {shared.translate(text,into:.zh)}
}

func L(_ key:String,_ arguments:Any...)->String {Localization.text(key,arguments)}
