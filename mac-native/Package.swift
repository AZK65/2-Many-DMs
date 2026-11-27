// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TwoManyDMs",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "TwoManyDMs", targets: ["TwoManyDMs"])],
    targets: [
        .target(name: "GlassBridge", publicHeadersPath: "include", linkerSettings: [.linkedFramework("AppKit")]),
        .executableTarget(name: "TwoManyDMs", dependencies: ["GlassBridge"])
    ]
)
