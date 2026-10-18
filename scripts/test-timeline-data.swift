import Foundation
@main struct TimelineMathTest {
    static func response(_ i:Int,speed:Double?=10,cache:Int?=50,model:String="test",effort:String="medium",tier:String="standard")->ContextStatistics.Response {
        var value:[String:Any]=["id":"r\(i)","index":i+1,"position":i*3+2,"eventType":"intermediate","timestamp":"2026-10-16T00:00:00Z","kind":"中间响应","cacheStatus":cache==0 ? "zero_in_log":cache==nil ? "missing":"recorded","cacheSegment":0,"inputSegment":0,"timingKind":"observed_generation","segment":0,"config":["model":model,"effort":effort,"serviceTier":tier],"inputTokens":100,"outputTokens":100]
        if let speed{value["tokensPerSecond"]=speed;value["durationMs"]=100/speed*1000};if let cache{value["cachedInputTokens"]=cache}
        return try! JSONDecoder().decode(ContextStatistics.Response.self,from:JSONSerialization.data(withJSONObject:value))
    }
    static func event(_ i:Int,kind:String="user_input")->ContextStatistics.TimelineEvent {
        let value:[String:Any]=["id":"e\(i)","position":i*3+1,"timestamp":"2026-10-16T00:00:00Z","eventType":kind,"kind":kind,"images":0]
        return try! JSONDecoder().decode(ContextStatistics.TimelineEvent.self,from:JSONSerialization.data(withJSONObject:value))
    }
    static func near(_ a:Double?,_ b:Double){precondition(a != nil && abs(a!-b)<0.00001,"\(String(describing:a)) != \(b)")}
    static func main() throws {
        let settingsTimeline=try TimelineData(responses:[response(0),response(1,model:"next",effort:"xhigh",tier:"priority"),response(2,model:"next",effort:"xhigh",tier:"fast"),response(3,model:"next",effort:"xhigh",tier:"ultrafast")],events:[],revision:"changes",period:40,limit:1)
        precondition(settingsTimeline.buckets[0].settingsChanges.count==4)
        precondition(settingsTimeline.buckets[0].settingsChanges[0].from=="test" && settingsTimeline.buckets[0].settingsChanges[0].to=="next")
        precondition(settingsTimeline.buckets[0].settingsChanges[1].field=="effort" && settingsTimeline.buckets[0].settingsChanges[1].responseIndex==2)
        precondition(settingsTimeline.buckets[0].speedModes==["fast","ultrafast"])
        let ema=try TimelineData(responses:[response(0,speed:10),response(1,speed:30)],events:[],revision:"ema",period:3)
        near(ema.speed[0].value,10);near(ema.speed[1].value,20)
        let off=try TimelineData(responses:[response(0,speed:10),response(1,speed:30)],events:[],revision:"off",period:0)
        near(off.speed[1].value,30)
        let weighted=try TimelineData(responses:[response(0,speed:10),response(1,speed:100)],events:[],revision:"weighted",period:0,limit:1)
        near(weighted.buckets[0].speed,200/11);near(weighted.speed[0].value,200/11)
        let missing=try TimelineData(responses:[response(0),response(1,speed:nil,cache:nil),response(2,speed:50)],events:[],revision:"missing",period:12)
        near(missing.speed.last?.value,50);precondition(missing.cache.count==2 && missing.cache[0].series != missing.cache[1].series)
        let compact=try TimelineData(responses:[response(0),response(1,speed:50)],events:[event(1,kind:"compaction")],revision:"compact",period:12)
        near(compact.speed.last?.value,50);precondition(compact.speed[0].series == compact.speed[1].series)
        let changed=try TimelineData(responses:[response(0),response(1,speed:50,model:"other")],events:[],revision:"changed",period:12)
        near(changed.speed.last?.value,50)
        let partial=try TimelineData(responses:[response(0),response(1,speed:nil,cache:nil),response(2,speed:30),response(3,speed:40),response(4,speed:nil,cache:nil),response(5,speed:60)],events:[],revision:"partial",period:0,limit:2)
        precondition(partial.speed.count==2 && partial.speed[0].series==partial.speed[1].series)
        precondition(partial.cache.count==2 && partial.cache[0].series==partial.cache[1].series)
        precondition(partial.buckets.allSatisfy{$0.measured==2 && $0.cacheSamples==2 && $0.responses==3})
        let gap=try TimelineData(responses:[response(0),response(1),response(2,speed:nil,cache:nil),response(3,speed:nil,cache:nil),response(4),response(5)],events:[],revision:"gap",limit:3)
        precondition(gap.speed.count==2 && gap.speed[0].series != gap.speed[1].series)
        precondition(gap.cache.count==2 && gap.cache[0].series != gap.cache[1].series)
        let zero=try TimelineData(responses:[response(0,cache:0),response(1)],events:[],revision:"zero")
        near(zero.cache[0].value,0);precondition(zero.cache[0].series==zero.cache[1].series)
        let empty=try TimelineData(responses:[],events:[],revision:"empty");precondition(empty.buckets.isEmpty && empty.bucket(at:1)==nil)
        for count in [1,119,120,121,127,239,241,1001] {
            let eventsOnly=try TimelineData(responses:[],events:(0..<count).map{event($0)},revision:"events-\(count)")
            precondition(eventsOnly.buckets.count<=120)
            precondition(eventsOnly.buckets.allSatisfy{!$0.entryRange.isEmpty})
            precondition(eventsOnly.buckets.reduce(0){$0+$1.entryRange.count}==count)
        }
        let onlyEvents=try TimelineData(responses:[],events:(0..<2400).map{event($0)},revision:"events");precondition(onlyEvents.buckets.count==120)
        let sampleResponses=(0..<200).map{response($0)},sampleEvents=(0..<300).map{event($0)}
        for seed in 0..<500 {
            let r=seed*37%201,e=seed*71%301
            let mixed=try TimelineData(responses:Array(sampleResponses.prefix(r)),events:Array(sampleEvents.prefix(e)),revision:"mixed-\(seed)",limit:1+seed%120)
            precondition(mixed.buckets.count<=1+seed%120)
            precondition(mixed.buckets.allSatisfy{!$0.entryRange.isEmpty})
            precondition(mixed.buckets.reduce(0){$0+$1.entryRange.count}==r+e)
            precondition(mixed.buckets.reduce(0){$0+$1.responses}==r)
        }
        let responses=(0..<50000).map{response($0,speed:$0%31==0 ? nil:Double(20+$0%70),cache:$0%37==0 ? 0:50)}
        let events=(0..<50000).map{event($0,kind:$0%1000==0 ? "compaction":"user_input")}
        let begin=Date();let large=try TimelineData(responses:responses,events:events,revision:"large")
        precondition(large.buckets.count<=120 && large.speed.count<=120 && large.input.count<=120 && large.cache.count<=120)
        precondition(large.buckets.reduce(0){$0+$1.responses}==50000)
        precondition(large.buckets.reduce(0){$0+$1.outputTokens}==5000000)
        precondition(large.buckets.reduce(0){$0+$1.compactions}==50)
        precondition(large.buckets.reduce(0){$0+$1.zeroCaches}==responses.filter{$0.cachedInputTokens==0}.count)
        var seen=Set<String>()
        for bucket in large.buckets {
            for page in 0..<Int(ceil(Double(bucket.entryRange.count)/20)){
                let entries=large.page(bucket:bucket.id,page:page);precondition(entries.count<=20)
                for entry in entries{precondition(seen.insert(entry.id).inserted);precondition(large.bucket(for:entry.id)==bucket.id);precondition(large.bucket(at:Double(entry.position))==bucket.id)}
            }
        }
        precondition(seen.count==large.entries.count && seen.count==100000)
        print("EMA, weighted means, missing gaps, compaction/model resets, 100000 retained records, bounded marks and pagination passed; 50K aggregation+lookup \(Int(Date().timeIntervalSince(begin)*1000))ms")
    }
}
