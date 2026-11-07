// Deterministic PNG exports of the code-native clock mark. Run with `swift scripts/generate-icons.swift` on macOS.
import AppKit
import Foundation

let root = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? FileManager.default.currentDirectoryPath)
let publicIcons = root.appendingPathComponent("apps/extension/public/icons")
let appIcons = root.appendingPathComponent("safari/Screentime/Screentime/Assets.xcassets/AppIcon.appiconset")
try FileManager.default.createDirectory(at: publicIcons, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: appIcons, withIntermediateDirectories: true)

func render(_ size: Int, toolbar: Bool) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    let graphics = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = graphics
    let ctx = graphics.cgContext
    ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))
    ctx.setAllowsAntialiasing(true)
    ctx.setShouldAntialias(true)
    ctx.translateBy(x: 0, y: CGFloat(size))
    ctx.scaleBy(x: CGFloat(size) / 64, y: -CGFloat(size) / 64)
    if !toolbar {
        ctx.setFillColor(NSColor(srgbRed: 34/255, green: 94/255, blue: 196/255, alpha: 1).cgColor)
        ctx.addPath(CGPath(roundedRect: CGRect(x: 1, y: 1, width: 62, height: 62), cornerWidth: 16, cornerHeight: 16, transform: nil))
        ctx.fillPath()
    }
    ctx.setStrokeColor((toolbar ? NSColor.black : NSColor.white).cgColor)
    ctx.setLineWidth(toolbar ? 5 : 4.5)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    let radius: CGFloat = toolbar ? 24 : 19
    ctx.strokeEllipse(in: CGRect(x: 32-radius, y: 32-radius, width: 2*radius, height: 2*radius))
    ctx.move(to: CGPoint(x: 32, y: toolbar ? 17 : 20))
    ctx.addLine(to: CGPoint(x: 32, y: 33))
    ctx.addLine(to: CGPoint(x: toolbar ? 43 : 41, y: toolbar ? 39 : 38))
    ctx.strokePath()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 48, 64, 96, 128, 256, 512, 1024] {
    try render(size, toolbar: false).write(to: publicIcons.appendingPathComponent("icon-\(size).png"))
}
for size in [16, 19, 24, 32, 38, 48, 64] {
    try render(size, toolbar: true).write(to: publicIcons.appendingPathComponent("toolbar-\(size).png"))
}
var images: [[String: String]] = []
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let filename = "appicon-\(points)@\(scale)x.png"
        try render(points * scale, toolbar: false).write(to: appIcons.appendingPathComponent(filename))
        images.append(["idiom": "mac", "size": "\(points)x\(points)", "scale": "\(scale)x", "filename": filename])
    }
}
let contents: [String: Any] = ["images": images, "info": ["author": "xcode", "version": 1]]
try JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys]).write(to: appIcons.appendingPathComponent("Contents.json"))
let catalog: [String: Any] = ["info": ["author": "xcode", "version": 1]]
try JSONSerialization.data(withJSONObject: catalog, options: [.prettyPrinted, .sortedKeys]).write(to: appIcons.deletingLastPathComponent().appendingPathComponent("Contents.json"))
print("Generated extension, toolbar and macOS app icons.")
