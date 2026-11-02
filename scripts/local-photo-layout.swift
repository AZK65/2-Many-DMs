// On-device text recognition. No network access or image changes.
import Foundation
import Vision
import ImageIO

guard CommandLine.arguments.count == 2 else { exit(2) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
if #available(macOS 13.0, *) { request.automaticallyDetectsLanguage = true }
do {
    let source = CGImageSourceCreateWithURL(url as CFURL, nil)
    let properties = source.flatMap { CGImageSourceCopyPropertiesAtIndex($0, 0, nil) as? [CFString: Any] }
    let rawOrientation = (properties?[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1
    let orientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up
    try VNImageRequestHandler(url: url, orientation: orientation, options: [:]).perform([request])
    let regions: [[String: Any]] = (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first, !candidate.string.isEmpty else { return nil }
        let box = observation.boundingBox
        return ["text": candidate.string, "box": [box.minX * 1000, (1 - box.maxY) * 1000, box.maxX * 1000, (1 - box.minY) * 1000]]
    }
    let data = try JSONSerialization.data(withJSONObject: ["regions": regions])
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data("On-device text layout unavailable.\n".utf8))
    exit(1)
}
