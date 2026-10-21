import AppKit
import Carbon.HIToolbox

private func contextControlHotKeyHandler(
  _ next: EventHandlerCallRef?, _ event: EventRef?, _ userData: UnsafeMutableRawPointer?
) -> OSStatus {
  guard let event, let userData else { return OSStatus(eventNotHandledErr) }
  return Unmanaged<GlobalShortcutManager>.fromOpaque(userData).takeUnretainedValue().handle(event)
}

/// Registers one system-wide shortcut without requesting keyboard-monitoring permissions.
final class GlobalShortcutManager {
  private var handler: EventHandlerRef?
  private var hotKey: EventHotKeyRef?
  private var accelerator: String?
  private var suspended = false
  private let onTrigger: () -> Void
  private let signature: FourCharCode = 0x4343_4D47  // CCMG

  init(onTrigger: @escaping () -> Void) { self.onTrigger = onTrigger }

  func configure(_ value: String, enabled: Bool) -> (registered: Bool, error: String?) {
    let next = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard enabled && !next.isEmpty else {
      if let hotKey { UnregisterEventHotKey(hotKey) }
      hotKey = nil
      accelerator = nil
      return (false, nil)
    }
    guard let (keyCode, modifiers) = Self.parse(next) else { return (false, L("请输入有效的快捷键")) }
    if hotKey != nil && accelerator == next { return (true, nil) }
    if handler == nil {
      var eventSpec = EventTypeSpec(
        eventClass: UInt32(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
      let result = InstallEventHandler(
        GetApplicationEventTarget(), contextControlHotKeyHandler, 1, &eventSpec,
        Unmanaged.passUnretained(self).toOpaque(), &handler)
      guard result == noErr else { return (false, L("无法注册系统快捷键")) }
    }
    var hotKeyID = EventHotKeyID(signature: signature, id: 1)
    var newHotKey: EventHotKeyRef?
    let result = RegisterEventHotKey(
      keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), UInt32(kEventHotKeyExclusive),
      &newHotKey)
    guard result == noErr, let newHotKey else { return (false, L("快捷键已被占用，请选择其他组合")) }
    if let hotKey { UnregisterEventHotKey(hotKey) }
    hotKey = newHotKey
    accelerator = next
    return (true, nil)
  }

  func suspend(_ shouldSuspend: Bool) {
    guard suspended != shouldSuspend else { return }
    suspended = shouldSuspend
    if shouldSuspend {
      if let hotKey { UnregisterEventHotKey(hotKey) }
      hotKey = nil
      return
    }
    guard let accelerator, let (keyCode, modifiers) = Self.parse(accelerator) else { return }
    var hotKeyID = EventHotKeyID(signature: signature, id: 1)
    var resumedHotKey: EventHotKeyRef?
    let result = RegisterEventHotKey(
      keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), UInt32(kEventHotKeyExclusive),
      &resumedHotKey)
    if result == noErr { hotKey = resumedHotKey }
  }

  func handle(_ event: EventRef) -> OSStatus {
    DispatchQueue.main.async { self.onTrigger() }
    return noErr
  }

  func dispose() {
    if let hotKey { UnregisterEventHotKey(hotKey) }
    hotKey = nil
    accelerator = nil
    if let handler { RemoveEventHandler(handler) }
    handler = nil
  }
  deinit { dispose() }

  private static func parse(_ value: String) -> (UInt32, UInt32)? {
    let parts = value.split(separator: "+").map {
      String($0).trimmingCharacters(in: .whitespaces).lowercased()
    }
    guard !parts.isEmpty else { return nil }
    var modifiers: UInt32 = 0
    var key: UInt32? = nil
    for part in parts {
      switch part {
      case "ctrl", "control":
        guard modifiers & UInt32(controlKey) == 0 else { return nil }
        modifiers |= UInt32(controlKey)
      case "shift":
        guard modifiers & UInt32(shiftKey) == 0 else { return nil }
        modifiers |= UInt32(shiftKey)
      case "alt", "option":
        guard modifiers & UInt32(optionKey) == 0 else { return nil }
        modifiers |= UInt32(optionKey)
      case "cmd", "command", "super", "meta", "win", "windows":
        guard modifiers & UInt32(cmdKey) == 0 else { return nil }
        modifiers |= UInt32(cmdKey)
      default:
        guard key == nil, part.count == 1, let code = keyCodes[part] else { return nil }
        key = code
      }
    }
    guard modifiers != 0, let key else { return nil }
    return (key, modifiers)
  }

  static func keyName(for keyCode: UInt32) -> String? {
    keyCodes.first(where: { $0.value == keyCode })?.key.uppercased()
  }

  // macOS virtual key codes, independent of the active keyboard layout.
  private static let keyCodes: [String: UInt32] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11,
    "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21,
    "6": 22, "5": 23,
    "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33,
    "i": 34, "p": 35,
    "l": 37, "j": 38, "k": 40, ";": 41, "'": 39, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46,
    ".": 47,
  ]
}
