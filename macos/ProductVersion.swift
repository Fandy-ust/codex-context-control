import Foundation

func newerProductVersion(_ candidate:String?,than current:String)->Bool {
    func parts(_ value:String)->[Int]? {
        guard value.range(of:"^[0-9]+\\.[0-9]+\\.[0-9]+$",options:.regularExpression) != nil else{return nil}
        let values=value.split(separator:".").compactMap{Int($0)}
        return values.count==3 ? values:nil
    }
    guard let candidate,let a=parts(candidate),let b=parts(current) else{return false}
    for i in 0..<3 {if a[i] != b[i]{return a[i]>b[i]}}
    return false
}
