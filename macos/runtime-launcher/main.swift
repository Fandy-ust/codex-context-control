import Foundation
import Darwin

struct LaunchConfig: Decodable { let node: String; let wrapper: String; let original: String; let home: String }
struct LaunchPlan: Decodable { let binary: String; let args: [String]; let enhanced: Bool }
private func fail(_ text: String) -> Never { fputs("Context Manager launcher: \(text)\n", stderr); exit(1) }
private func strings(_ values: [String]) -> [UnsafeMutablePointer<CChar>?] { values.map { strdup($0) } + [nil] }
private func replaceProcess(_ binary: String, _ args: [String]) -> Never {
    guard binary.hasPrefix("/"), !binary.contains("\0"), args.count < 2048, args.allSatisfy({ !$0.contains("\0") }) else { fail("Invalid runtime launch plan") }
    let argv = strings([binary] + args)
    argv.withUnsafeBufferPointer { _ = execv(binary, $0.baseAddress!) }
    fail("Unable to execute original runtime: \(String(cString: strerror(errno)))")
}
private func makePipe() -> [Int32] {
    var fds: [Int32] = [0, 0]
    guard pipe(&fds) == 0, fds.allSatisfy({ $0 > STDERR_FILENO }) else { fail("Unable to create runtime transport") }
    return fds
}
private func stopHelper(_ pid: pid_t) {
    kill(pid, SIGTERM)
    var status: Int32 = 0
    for _ in 0..<20 {
        let result = waitpid(pid, &status, WNOHANG)
        if result == pid || result < 0 { return }
        usleep(5000)
    }
    kill(pid, SIGKILL)
    while waitpid(pid, &status, 0) < 0 && errno == EINTR {}
}

var executableSize: UInt32 = 0
_ = _NSGetExecutablePath(nil, &executableSize)
var executableBuffer = [CChar](repeating: 0, count: Int(executableSize))
guard _NSGetExecutablePath(&executableBuffer, &executableSize) == 0 else { fail("Cannot locate launcher") }
let executable = String(cString: executableBuffer)
let config: LaunchConfig
do { config = try JSONDecoder().decode(LaunchConfig.self, from: Data(contentsOf: URL(fileURLWithPath: executable + ".json"))) }
catch { fail("Cannot read installed launcher configuration") }
guard [config.node, config.wrapper, config.original, config.home].allSatisfy({ $0.hasPrefix("/") && !$0.contains("\0") }) else { fail("Invalid installed paths") }
let args = Array(CommandLine.arguments.dropFirst())
let toRuntime = makePipe(), fromRuntime = makePipe(), planPipe = makePipe()
var actions: posix_spawn_file_actions_t?
guard posix_spawn_file_actions_init(&actions) == 0 else { fail("Cannot initialize runtime transport") }
for fd in [toRuntime[0], fromRuntime[1], planPipe[0]] { posix_spawn_file_actions_addclose(&actions, fd) }
let channel: [String: Any] = ["nativePid": Int(getpid()), "clientPid": Int(getppid()), "readFd": Int(fromRuntime[0]), "writeFd": Int(toRuntime[1]), "planFd": Int(planPipe[1])]
var environment = ProcessInfo.processInfo.environment
environment["CONTEXT_CONTROL_HOME"] = config.home
environment["CONTEXT_CONTROL_NATIVE_CHANNEL"] = String(data: try JSONSerialization.data(withJSONObject: channel), encoding: .utf8)!
let argv = strings([config.node, config.wrapper] + args)
let envp = strings(environment.map { "\($0.key)=\($0.value)" })
var helper: pid_t = 0
let spawned = argv.withUnsafeBufferPointer { argvPointer in
    envp.withUnsafeBufferPointer { envPointer in
        posix_spawn(&helper, config.node, &actions, nil, argvPointer.baseAddress!, envPointer.baseAddress!)
    }
}
posix_spawn_file_actions_destroy(&actions)
close(planPipe[1])
guard spawned == 0 else {
    for fd in toRuntime + fromRuntime + [planPipe[0]] { close(fd) }
    replaceProcess(config.original, args)
}

// Never read the GUI input before deciding whether enhancement is available.
// A failed preparation can therefore exec the untouched native command safely.
var bytes = Data(), buffer = [UInt8](repeating: 0, count: 4096)
let deadline = Date().addingTimeInterval(15)
var finished = false
while Date() < deadline && bytes.count <= 65536 {
    var descriptor = pollfd(fd: planPipe[0], events: Int16(POLLIN | POLLHUP), revents: 0)
    let remaining = max(1, Int32(deadline.timeIntervalSinceNow * 1000))
    let ready = poll(&descriptor, 1, remaining)
    if ready < 0 && errno == EINTR { continue }
    if ready <= 0 { break }
    let count = read(planPipe[0], &buffer, buffer.count)
    if count == 0 { finished = true; break }
    if count < 0 { if errno == EINTR { continue }; break }
    bytes.append(contentsOf: buffer.prefix(count))
}
close(planPipe[0])
guard finished, bytes.count <= 65536, let plan = try? JSONDecoder().decode(LaunchPlan.self, from: bytes),
      plan.binary.hasPrefix("/"), !plan.binary.contains("\0"), access(plan.binary, X_OK) == 0,
      plan.args.count < 2048, plan.args.allSatisfy({ !$0.contains("\0") }) else {
    stopHelper(helper)
    for fd in toRuntime + fromRuntime { close(fd) }
    replaceProcess(config.original, args)
}
if plan.enhanced {
    guard dup2(toRuntime[0], STDIN_FILENO) >= 0, dup2(fromRuntime[1], STDOUT_FILENO) >= 0 else { kill(helper, SIGTERM); fail("Cannot attach runtime transport") }
    var acknowledgement: UInt8 = 6
    guard write(STDOUT_FILENO, &acknowledgement, 1) == 1 else { kill(helper, SIGTERM); fail("Cannot confirm runtime transport") }
} else { stopHelper(helper) }
for fd in toRuntime + fromRuntime { close(fd) }
replaceProcess(plan.binary, plan.args)
