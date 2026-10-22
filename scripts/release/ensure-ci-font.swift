// macOS CI environment setup only; never bundled into the game.
// Apple-managed fonts are requested through Core Text, never copied into Git.
// https://developer.apple.com/documentation/technologyoverviews/fonts
import Foundation
import CoreText
import Dispatch

let required = ["PingFangSC-Regular", "PingFangSC-Semibold"]
func available(_ name: String) -> Bool {
    let font = CTFontCreateWithName(name as CFString, 16, nil)
    return CTFontCopyPostScriptName(font) as String == name
}
func verify() -> Bool { required.allSatisfy(available) }

if verify() {
    print("[visual-font] Exact PingFang SC Regular/Semibold already available.")
    exit(0)
}
let environment = ProcessInfo.processInfo.environment
guard CommandLine.arguments.contains("--download-system-font"),
      environment["GITHUB_ACTIONS"] == "true", environment["RUNNER_OS"] == "macOS" else {
    fputs("[visual-font] Required Apple system font unavailable. Download is permitted only on the disposable macOS GitHub runner with the explicit flag.\n", stderr)
    exit(1)
}

let descriptors = required.map { name in
    CTFontDescriptorCreateWithAttributes([kCTFontNameAttribute: name] as CFDictionary)
}
let completed = DispatchSemaphore(value: 0)
let started = CTFontDescriptorMatchFontDescriptorsWithProgressHandler(descriptors as CFArray, nil) { state, _ in
    if state == .didFinish || state == .didFailWithError { completed.signal() }
    return true
}
guard started, completed.wait(timeout: .now() + 120) == .success, verify() else {
    fputs("[visual-font] Apple font matching/download failed or timed out; comparison environment is not ready.\n", stderr)
    exit(1)
}
// Apple explicitly requires no manual registration for these system-managed fonts.
print("[visual-font] Exact Apple-managed PingFang SC faces verified after matching.")
