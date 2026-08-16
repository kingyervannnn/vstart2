import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write(Data("Usage: set-wallpaper /absolute/path/to/image\n".utf8))
  exit(64)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
guard FileManager.default.fileExists(atPath: imageURL.path) else {
  FileHandle.standardError.write(Data("Wallpaper image does not exist: \(imageURL.path)\n".utf8))
  exit(66)
}

do {
  guard !NSScreen.screens.isEmpty else {
    throw NSError(domain: "VStartBackgroundSync", code: 1, userInfo: [NSLocalizedDescriptionKey: "No active display was found"])
  }
  for screen in NSScreen.screens {
    let options = NSWorkspace.shared.desktopImageOptions(for: screen) ?? [:]
    try NSWorkspace.shared.setDesktopImageURL(imageURL, for: screen, options: options)
  }
} catch {
  FileHandle.standardError.write(Data("Could not set wallpaper: \(error.localizedDescription)\n".utf8))
  exit(1)
}
