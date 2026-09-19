import ExpoModulesCore
import ImageIO
import UIKit
import UniformTypeIdentifiers
import Vision

internal struct CropOptions: Record {
  @Field var padding: Double = 0.2
  @Field var square: Bool = false
  @Field var outputSize: OutputSize?
  @Field var format: String = "jpeg"
  @Field var quality: Double = 0.9
}

internal struct OutputSize: Record {
  @Field var width: Double = 0
  @Field var height: Double = 0
}

internal struct RectRecord: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 0
  @Field var height: Double = 0

  var cgRect: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}

internal struct PointRecord: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0

  var cgPoint: CGPoint { CGPoint(x: x, y: y) }
}

internal enum FaceImageProcessor {
  static var outputDirectory: URL {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    return caches.appendingPathComponent("face-vision", isDirectory: true)
  }

  // MARK: - Operations

  static func detectFaces(uri: String, options: DetectionOptions) throws -> [String: Any] {
    return try autoreleasepool {
      let start = CACurrentMediaTime()
      let url = try fileURL(from: uri)
      let source = try imageSource(url)
      let size = try uprightSize(source, url)

      // Vision has no fast/accurate switch for faces, so the mode only picks the input size.
      let maxDimension: Int?
      switch options.performanceMode {
      case "fast": maxDimension = 640
      case "accurate": maxDimension = nil
      default: maxDimension = 1280
      }
      let image = try decodeUpright(source, url, maxDimension: maxDimension)
      let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
      let faces = try FaceDetector.detect(handler: handler, options: options, size: size)

      return [
        "faces": faces.map(\.dictionary),
        "image": ["width": Double(size.width), "height": Double(size.height), "uri": url.absoluteString],
        "processingTime": (CACurrentMediaTime() - start) * 1000
      ]
    }
  }

  static func analyzeRegion(uri: String, rect: CGRect?) throws -> [String: Any] {
    return try autoreleasepool {
      let url = try fileURL(from: uri)
      let image = try decodeUpright(try imageSource(url), url, maxDimension: nil)
      let full = CGRect(x: 0, y: 0, width: image.width, height: image.height)
      guard let r = RegionStatsCalculator.region(rect ?? full, width: image.width, height: image.height),
        let cropped = image.cropping(to: CGRect(x: r.x, y: r.y, width: r.width, height: r.height)) else {
        throw FaceVisionException(.invalidArgument, "The region does not overlap the image.")
      }

      // ponytail: expands the whole region 1:1 so sampling matches Android exactly; a full
      // 12MP frame is ~48MB here, decode only the sampled rows if that ever matters.
      let rowBytes = r.width * 4
      var rgba = [UInt8](repeating: 0, count: rowBytes * r.height)
      let drawn = rgba.withUnsafeMutableBytes { buffer -> Bool in
        guard let space = CGColorSpace(name: CGColorSpace.sRGB), let context = CGContext(
          data: buffer.baseAddress,
          width: r.width,
          height: r.height,
          bitsPerComponent: 8,
          bytesPerRow: rowBytes,
          space: space,
          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else {
          return false
        }
        context.draw(cropped, in: CGRect(x: 0, y: 0, width: r.width, height: r.height))
        return true
      }
      guard drawn else {
        throw FaceVisionException(.invalidImage, "Could not read the image pixels.")
      }

      return RegionStatsCalculator.stats(r) { x, y in
        let i = (y - r.y) * rowBytes + (x - r.x) * 4
        return 0.299 * Double(rgba[i]) + 0.587 * Double(rgba[i + 1]) + 0.114 * Double(rgba[i + 2])
      }
    }
  }

  static func cropFace(uri: String, rect: CGRect, options: CropOptions) throws -> [String: Any] {
    return try autoreleasepool {
      let url = try fileURL(from: uri)
      let image = try decodeUpright(try imageSource(url), url, maxDimension: nil)
      return try render(image, face: rect, rotation: 0, options: options)
    }
  }

  static func alignFace(uri: String, rect: CGRect, leftEye: CGPoint, rightEye: CGPoint, options: CropOptions) throws -> [String: Any] {
    let dx = leftEye.x - rightEye.x
    let dy = leftEye.y - rightEye.y
    guard dx.isFinite, dy.isFinite, (dx * dx + dy * dy).squareRoot() >= 1 else {
      throw FaceVisionException(.invalidArgument, "leftEye and rightEye must be distinct points.")
    }
    // Subject's left eye sits on the image right, so level eyes give 0.
    let angle = atan2(dy, dx) * 180 / .pi
    return try autoreleasepool {
      let url = try fileURL(from: uri)
      let image = try decodeUpright(try imageSource(url), url, maxDimension: nil)
      var result = try render(image, face: rect, rotation: -angle, options: options)
      result["rotation"] = Double(-angle)
      return result
    }
  }

  // MARK: - Crop/rotate

  /**
   Rotates the image by `rotation` degrees (clockwise on screen) around the face centre and
   crops the padded face box in that rotated space, clamped to the rotated image's bounds.
   */
  private static func render(_ image: CGImage, face: CGRect, rotation: CGFloat, options: CropOptions) throws -> [String: Any] {
    guard face.width > 0, face.height > 0, face.minX.isFinite, face.minY.isFinite else {
      throw FaceVisionException(.invalidArgument, "The face rect must have a positive size.")
    }
    guard options.padding >= 0, options.quality >= 0, options.quality <= 1 else {
      throw FaceVisionException(.invalidArgument, "padding must be >= 0 and quality in 0..1.")
    }

    let center = CGPoint(x: face.midX, y: face.midY)
    let radians = rotation * .pi / 180
    let rotate = CGAffineTransform(translationX: center.x, y: center.y)
      .rotated(by: radians)
      .translatedBy(x: -center.x, y: -center.y)
    let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height).applying(rotate)

    let padding = CGFloat(options.padding)
    var width = face.width * (1 + 2 * padding)
    var height = face.height * (1 + 2 * padding)
    if options.square {
      width = max(width, height)
      height = width
    }
    var crop = CGRect(x: center.x - width / 2, y: center.y - height / 2, width: width, height: height)
      .intersection(bounds)
    if options.square && !crop.isNull && abs(crop.width - crop.height) > 0.5 {
      let side = min(
        width,
        2 * min(center.x - bounds.minX, bounds.maxX - center.x),
        2 * min(center.y - bounds.minY, bounds.maxY - center.y)
      )
      crop = CGRect(x: center.x - side / 2, y: center.y - side / 2, width: side, height: side)
    }
    crop = CGRect(x: crop.minX.rounded(), y: crop.minY.rounded(), width: crop.width.rounded(), height: crop.height.rounded())
    guard !crop.isNull, crop.width >= 1, crop.height >= 1 else {
      throw FaceVisionException(.invalidArgument, "The face rect is outside the image.")
    }

    var outputSize = crop.size
    if let size = options.outputSize {
      guard size.width >= 1, size.height >= 1 else {
        throw FaceVisionException(.invalidArgument, "outputSize must be at least 1x1.")
      }
      outputSize = CGSize(width: size.width.rounded(), height: size.height.rounded())
    }

    let png = options.format == "png"
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = !png
    let rendered = UIGraphicsImageRenderer(size: outputSize, format: format).image { context in
      let cg = context.cgContext
      cg.interpolationQuality = .high
      cg.scaleBy(x: outputSize.width / crop.width, y: outputSize.height / crop.height)
      cg.translateBy(x: -crop.minX, y: -crop.minY)
      cg.concatenate(rotate)
      UIImage(cgImage: image).draw(at: .zero)
    }
    guard let output = rendered.cgImage else {
      throw FaceVisionException(.imageWriteFailed, "Could not render the cropped face.")
    }
    return try write(output, png: png, quality: options.quality)
  }

  // MARK: - Input

  static func fileURL(from uri: String) throws -> URL {
    let url: URL
    if uri.hasPrefix("file://") {
      guard let parsed = URL(string: uri) else {
        throw FaceVisionException(.invalidUri, "'\(uri)' is not a valid file URI.")
      }
      url = parsed
    } else if uri.hasPrefix("/") {
      url = URL(fileURLWithPath: uri)
    } else {
      throw FaceVisionException(.invalidUri, "Only local file:// URIs are supported, got '\(uri)'.")
    }

    guard FileManager.default.fileExists(atPath: url.path) else {
      throw FaceVisionException(.fileNotFound, "No file exists at \(url.path).")
    }
    return url
  }

  private static func imageSource(_ url: URL) throws -> CGImageSource {
    let options = [kCGImageSourceShouldCache: false] as CFDictionary
    guard let source = CGImageSourceCreateWithURL(url as CFURL, options), CGImageSourceGetCount(source) > 0 else {
      throw FaceVisionException(.invalidImage, "Could not read an image from \(url.lastPathComponent).")
    }
    return source
  }

  /// Pixel size after the EXIF orientation is applied.
  private static func uprightSize(_ source: CGImageSource, _ url: URL) throws -> CGSize {
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int,
      width > 0, height > 0 else {
      throw FaceVisionException(.invalidImage, "\(url.lastPathComponent) is not a decodable image.")
    }
    // 5...8 are the orientations that swap the axes.
    let orientation = properties[kCGImagePropertyOrientation] as? UInt32 ?? 1
    return orientation >= 5 && orientation <= 8
      ? CGSize(width: height, height: width)
      : CGSize(width: width, height: height)
  }

  /// Bakes the EXIF transform into the pixels and applies `maxDimension` in the same pass.
  static func decodeUpright(_ source: CGImageSource, _ url: URL?, maxDimension: Int?) throws -> CGImage {
    let name = url?.lastPathComponent ?? "the image"
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int,
      width > 0, height > 0 else {
      throw FaceVisionException(.invalidImage, "\(name) is not a decodable image.")
    }

    let longestEdge = max(width, height)
    let limit = max(min(maxDimension ?? longestEdge, longestEdge), 1)
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: limit
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
      throw FaceVisionException(.invalidImage, "Could not decode \(name).")
    }
    return image
  }

  // MARK: - Output

  static func write(_ image: CGImage, png: Bool, quality: Double) throws -> [String: Any] {
    do {
      try FileManager.default.createDirectory(at: outputDirectory, withIntermediateDirectories: true)
    } catch {
      throw FaceVisionException(.imageWriteFailed, "Could not create the output directory.", cause: error)
    }
    let url = outputDirectory.appendingPathComponent("\(UUID().uuidString).\(png ? "png" : "jpg")")
    let type = (png ? UTType.png : UTType.jpeg).identifier as CFString

    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, type, 1, nil) else {
      throw FaceVisionException(.imageWriteFailed, "Could not create \(url.lastPathComponent).")
    }
    let properties: [CFString: Any] = png ? [:] : [kCGImageDestinationLossyCompressionQuality: quality]
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      throw FaceVisionException(.imageWriteFailed, "Could not write \(url.path).")
    }
    return ["uri": url.absoluteString, "width": image.width, "height": image.height]
  }
}
