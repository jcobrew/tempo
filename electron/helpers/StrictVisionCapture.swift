import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

enum HelperError: Error {
  case invalidArguments(String)
  case permissionDenied
  case captureFailed
  case encodeFailed
}

struct CapturePayload: Encodable {
  let ok: Bool
  let mimeType: String
  let imageBase64: String
  let width: Int
  let height: Int
}

struct StatusPayload: Encodable {
  let ok: Bool
  let status: String
}

struct ErrorPayload: Encodable {
  let ok: Bool
  let error: String
}

func emitJSON<T: Encodable>(_ value: T, to stream: FileHandle = .standardOutput) {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.withoutEscapingSlashes]
  if let data = try? encoder.encode(value) {
    stream.write(data)
  }
}

func emitFailure(_ message: String, code: Int = 1) -> Never {
  emitJSON(ErrorPayload(ok: false, error: message), to: .standardError)
  fputs("\n", stderr)
  exit(Int32(code))
}

func permissionStatus() -> String {
  if CGPreflightScreenCaptureAccess() {
    return "granted"
  }
  return "not-determined"
}

func requestPermission() -> String {
  let granted = CGRequestScreenCaptureAccess()
  return granted ? "granted" : "denied"
}

func parseArgs(_ args: [String]) throws -> (command: String, options: [String: String]) {
  guard let command = args.dropFirst().first else {
    throw HelperError.invalidArguments("Missing command")
  }

  var options: [String: String] = [:]
  var index = 2
  while index < args.count {
    let key = args[index]
    guard key.hasPrefix("--") else {
      throw HelperError.invalidArguments("Unexpected argument: \(key)")
    }
    let normalizedKey = String(key.dropFirst(2))
    let valueIndex = index + 1
    guard valueIndex < args.count else {
      throw HelperError.invalidArguments("Missing value for \(key)")
    }
    options[normalizedKey] = args[valueIndex]
    index += 2
  }

  return (command, options)
}

func scaledImage(_ image: CGImage, maxDimension: Int) -> CGImage? {
  let width = image.width
  let height = image.height
  guard width > 0, height > 0 else {
    return nil
  }

  let longestSide = max(width, height)
  if longestSide <= maxDimension {
    return image
  }

  let ratio = CGFloat(maxDimension) / CGFloat(longestSide)
  let targetWidth = max(1, Int(CGFloat(width) * ratio))
  let targetHeight = max(1, Int(CGFloat(height) * ratio))

  guard
    let colorSpace = image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB),
    let context = CGContext(
      data: nil,
      width: targetWidth,
      height: targetHeight,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else {
    return nil
  }

  context.interpolationQuality = .high
  context.draw(image, in: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight))
  return context.makeImage()
}

func encodeImage(_ image: CGImage, format: String, quality: Double) throws -> (data: Data, mimeType: String) {
  let mutableData = NSMutableData()
  let destinationType = (format == "png" ? UTType.png.identifier : UTType.jpeg.identifier) as CFString
  guard let destination = CGImageDestinationCreateWithData(mutableData, destinationType, 1, nil) else {
    throw HelperError.encodeFailed
  }

  let properties: CFDictionary
  if format == "png" {
    properties = [:] as CFDictionary
  } else {
    properties = [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
  }

  CGImageDestinationAddImage(destination, image, properties)
  guard CGImageDestinationFinalize(destination) else {
    throw HelperError.encodeFailed
  }

  return (mutableData as Data, format == "png" ? "image/png" : "image/jpeg")
}

@available(macOS 14.0, *)
func captureMainDisplay(maxDimension: Int, format: String, quality: Double) async throws -> CapturePayload {
  guard CGPreflightScreenCaptureAccess() else {
    throw HelperError.permissionDenied
  }

  let shareableContent = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
  let displayID = CGMainDisplayID()
  guard let display = shareableContent.displays.first(where: { $0.displayID == displayID }) ?? shareableContent.displays.first else {
    throw HelperError.captureFailed
  }

  let filter = SCContentFilter(display: display, excludingWindows: [])
  let config = SCStreamConfiguration()
  config.showsCursor = true

  let longestSide = max(Int(display.width), Int(display.height))
  let clampedDimension = max(320, min(maxDimension, 1920))
  let scale = longestSide > 0 ? min(1, Double(clampedDimension) / Double(longestSide)) : 1
  config.width = max(1, Int(Double(display.width) * scale))
  config.height = max(1, Int(Double(display.height) * scale))

  let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
  guard let processedImage = scaledImage(image, maxDimension: maxDimension) else {
    throw HelperError.captureFailed
  }

  let encoded = try encodeImage(processedImage, format: format, quality: quality)
  return CapturePayload(
    ok: true,
    mimeType: encoded.mimeType,
    imageBase64: encoded.data.base64EncodedString(),
    width: processedImage.width,
    height: processedImage.height
  )
}

do {
  let parsed = try parseArgs(CommandLine.arguments)
  switch parsed.command {
  case "check-permission":
    emitJSON(StatusPayload(ok: true, status: permissionStatus()))
  case "request-permission":
    emitJSON(StatusPayload(ok: true, status: requestPermission()))
  case "capture":
    guard #available(macOS 14.0, *) else {
      emitFailure("Strict beta capture requires macOS 14 or newer.", code: 7)
    }
    let maxDimension = Int(parsed.options["max-dimension"] ?? "") ?? 1280
    let format = parsed.options["format"] ?? "jpeg"
    let quality = Double(parsed.options["quality"] ?? "") ?? 0.72
    let payload = try await captureMainDisplay(
      maxDimension: max(320, min(maxDimension, 1920)),
      format: format == "png" ? "png" : "jpeg",
      quality: max(0.3, min(quality, 0.95))
    )
    emitJSON(payload)
  default:
    throw HelperError.invalidArguments("Unknown command: \(parsed.command)")
  }
} catch HelperError.invalidArguments(let message) {
  emitFailure(message, code: 2)
} catch HelperError.permissionDenied {
  emitFailure("Screen Recording permission is required.", code: 3)
} catch HelperError.captureFailed {
  emitFailure("Unable to capture the screen.", code: 4)
} catch HelperError.encodeFailed {
  emitFailure("Unable to encode the captured image.", code: 5)
} catch {
  emitFailure("Unexpected helper failure: \(error.localizedDescription)", code: 6)
}
