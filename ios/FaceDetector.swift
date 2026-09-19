import CoreGraphics
import CoreVideo
import ExpoModulesCore
import Vision

internal struct DetectionOptions: Record {
  @Field var performanceMode: String = "balanced"
  @Field var landmarks: Bool = false
  @Field var contours: Bool = false
  @Field var minFaceSize: Double = 0.1
}

internal struct DetectedFace {
  let bounds: CGRect
  var dictionary: [String: Any]
}

/**
 Vision reports angles in radians. The headers (VNObservation.h) say roll is
 counterclockwise-positive and pitch is positive when nodding down, so +roll = crown
 towards the subject's right shoulder and +pitch = looking down. Yaw's direction isn't
 documented; on an iPhone 11 Pro (iOS 26) raw yaw is negative when the subject turns to
 their own right, so it's flipped like pitch.
 */
private let yawSign = -1.0
private let pitchSign = -1.0
private let rollSign = 1.0

internal enum FaceDetector {
  static let landmarkTypes = ["leftEye", "rightEye", "noseBase", "leftMouth", "rightMouth", "bottomMouth"]
  static let contourTypes = ["face", "leftEye", "rightEye", "leftEyebrow", "rightEyebrow", "noseBridge", "outerLips", "innerLips"]

  /// `size` is the upright pixel size the geometry is reported in; Vision's output is
  /// normalized, so it doesn't have to match the buffer the handler was built from.
  static func detect(handler: VNImageRequestHandler, options: DetectionOptions, size: CGSize) throws -> [DetectedFace] {
    // Only the rectangles request fills roll/yaw/pitch, so it always runs first and
    // the landmarks request refines its observations.
    let rectangles = VNDetectFaceRectanglesRequest()
    rectangles.revision = VNDetectFaceRectanglesRequestRevision3
    do {
      try handler.perform([rectangles])
    } catch {
      throw FaceVisionException(.detectionFailed, "Vision face detection failed.", cause: error)
    }

    var observations = (rectangles.results ?? []).filter { Double($0.boundingBox.width) >= options.minFaceSize }
    let wantsLandmarks = options.landmarks || options.contours

    if wantsLandmarks && !observations.isEmpty {
      let landmarks = VNDetectFaceLandmarksRequest()
      landmarks.revision = VNDetectFaceLandmarksRequestRevision3
      landmarks.constellation = .constellation76Points
      landmarks.inputFaceObservations = observations
      do {
        try handler.perform([landmarks])
      } catch {
        throw FaceVisionException(.detectionFailed, "Vision landmark detection failed.", cause: error)
      }
      observations = landmarks.results ?? observations
    }

    return observations.map { face($0, size: size, landmarks: options.landmarks, contours: options.contours) }
  }

  // MARK: - Mapping

  private static func face(_ observation: VNFaceObservation, size: CGSize, landmarks: Bool, contours: Bool) -> DetectedFace {
    let box = observation.boundingBox
    let bounds = CGRect(
      x: box.minX * size.width,
      y: (1 - box.maxY) * size.height,
      width: box.width * size.width,
      height: box.height * size.height
    )

    var dict: [String: Any] = [
      "bounds": rectDict(bounds),
      "confidence": Double(observation.confidence)
    ]

    var native: [String: Any] = ["platform": "ios"]
    let roll = observation.roll?.doubleValue
    let yaw = observation.yaw?.doubleValue
    let pitch = observation.pitch?.doubleValue
    var raw: [String: Any] = [:]
    raw["x"] = pitch
    raw["y"] = yaw
    raw["z"] = roll
    if !raw.isEmpty {
      native["rawAngles"] = raw
    }
    if let roll = roll, let yaw = yaw, let pitch = pitch {
      dict["angles"] = [
        "yaw": yawSign * degrees(yaw),
        "pitch": pitchSign * degrees(pitch),
        "roll": rollSign * degrees(roll)
      ]
    }
    dict["native"] = native

    if (landmarks || contours), let lm = observation.landmarks {
      let geometry = FaceGeometry(lm, box: box, size: size)
      if landmarks, case let points = geometry.landmarks(), !points.isEmpty {
        dict["landmarks"] = points.mapValues(pointDict)
      }
      if contours {
        let loops = geometry.contours()
        if !loops.isEmpty {
          dict["contours"] = loops.mapValues { $0.map(pointDict) }
        }
      }
    }

    return DetectedFace(bounds: bounds, dictionary: dict)
  }

  private static func degrees(_ radians: Double) -> Double {
    radians * 180 / .pi
  }
}

/**
 Landmark regions in top-left image pixels, with left/right as the subject's.

 Neither the docs nor the headers say whether `leftEye` is the subject's or the viewer's
 left, so it's decided per face from the geometry: with `down` pointing from the eyes to
 the mouth, the subject's left eye is on the side where cross(down, eye) < 0 in a y-down
 image. That holds for any in-plane rotation and never needs mirroring info.
 */
private struct FaceGeometry {
  private let lm: VNFaceLandmarks2D
  private let box: CGRect
  private let size: CGSize
  private let swapped: Bool

  init(_ lm: VNFaceLandmarks2D, box: CGRect, size: CGSize) {
    self.lm = lm
    self.box = box
    self.size = size
    let map = { (region: VNFaceLandmarkRegion2D?) in FaceGeometry.points(region, box: box, size: size) }
    if let a = centroid(map(lm.leftEye)), let b = centroid(map(lm.rightEye)), let m = centroid(map(lm.outerLips)) {
      let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
      let down = CGPoint(x: m.x - mid.x, y: m.y - mid.y)
      let e = CGPoint(x: a.x - mid.x, y: a.y - mid.y)
      swapped = down.x * e.y - down.y * e.x > 0
    } else {
      swapped = false
    }
  }

  // Region points are normalized to the face box, bottom-left origin.
  private static func points(_ region: VNFaceLandmarkRegion2D?, box: CGRect, size: CGSize) -> [CGPoint] {
    guard let region = region else {
      return []
    }
    return region.normalizedPoints.map { p in
      CGPoint(
        x: (box.minX + p.x * box.width) * size.width,
        y: (1 - (box.minY + p.y * box.height)) * size.height
      )
    }
  }

  private func points(_ region: VNFaceLandmarkRegion2D?) -> [CGPoint] {
    FaceGeometry.points(region, box: box, size: size)
  }

  private var subjectLeftEye: VNFaceLandmarkRegion2D? { swapped ? lm.rightEye : lm.leftEye }
  private var subjectRightEye: VNFaceLandmarkRegion2D? { swapped ? lm.leftEye : lm.rightEye }
  private var subjectLeftPupil: VNFaceLandmarkRegion2D? { swapped ? lm.rightPupil : lm.leftPupil }
  private var subjectRightPupil: VNFaceLandmarkRegion2D? { swapped ? lm.leftPupil : lm.rightPupil }

  func landmarks() -> [String: CGPoint] {
    var out: [String: CGPoint] = [:]
    let leftEye = points(subjectLeftPupil).first ?? centroid(points(subjectLeftEye))
    let rightEye = points(subjectRightPupil).first ?? centroid(points(subjectRightEye))
    out["leftEye"] = leftEye
    out["rightEye"] = rightEye

    // Mouth corners and nose base need the face's own axes, so tilted heads still work.
    guard let l = leftEye, let r = rightEye else {
      return out
    }
    let lips = points(lm.outerLips)
    let across = normalize(CGPoint(x: l.x - r.x, y: l.y - r.y))
    guard across != .zero else {
      return out
    }
    // Perpendicular to the eye line, rotated towards the mouth side in a y-down image.
    let down = CGPoint(x: -across.y, y: across.x)

    if !lips.isEmpty {
      out["leftMouth"] = lips.max { dot($0, across) < dot($1, across) }
      out["rightMouth"] = lips.min { dot($0, across) < dot($1, across) }
      out["bottomMouth"] = lips.max { dot($0, down) < dot($1, down) }
    }

    // Nose base: centred across the nose outline, at its lowest point along `down`.
    let nose = points(lm.nose).isEmpty ? points(lm.noseCrest) : points(lm.nose)
    if let center = centroid(nose), let lowest = nose.map({ dot($0, down) }).max() {
      let shift = lowest - dot(center, down)
      out["noseBase"] = CGPoint(x: center.x + down.x * shift, y: center.y + down.y * shift)
    }
    return out
  }

  func contours() -> [String: [CGPoint]] {
    var out: [String: [CGPoint]] = [:]
    let pairs: [(String, VNFaceLandmarkRegion2D?)] = [
      ("face", lm.faceContour),
      ("leftEye", subjectLeftEye),
      ("rightEye", subjectRightEye),
      ("leftEyebrow", swapped ? lm.rightEyebrow : lm.leftEyebrow),
      ("rightEyebrow", swapped ? lm.leftEyebrow : lm.rightEyebrow),
      ("noseBridge", lm.noseCrest),
      ("outerLips", lm.outerLips),
      ("innerLips", lm.innerLips)
    ]
    for (name, region) in pairs {
      let pts = points(region)
      if !pts.isEmpty {
        out[name] = pts
      }
    }
    return out
  }
}

// MARK: - Region stats

/// Same sampling and maths as the Android side, keep them in step.
internal enum RegionStatsCalculator {
  struct Region {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
  }

  /// floor/ceil to whole pixels, clamped to the image; nil when nothing overlaps.
  static func region(_ rect: CGRect, width: Int, height: Int) -> Region? {
    guard rect.minX.isFinite, rect.minY.isFinite, rect.width.isFinite, rect.height.isFinite else {
      return nil
    }
    let x0 = max(0, Int(floor(rect.minX)))
    let y0 = max(0, Int(floor(rect.minY)))
    let x1 = min(width, Int(ceil(rect.maxX)))
    let y1 = min(height, Int(ceil(rect.maxY)))
    guard x1 > x0, y1 > y0 else {
      return nil
    }
    return Region(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
  }

  /// Nearest-neighbour downsample to at most 128 wide, then mean, stddev and the variance
  /// of the 4-neighbour Laplacian. `luma(x, y)` takes image pixels and returns 0..255.
  static func stats(_ r: Region, luma: (Int, Int) -> Double) -> [String: Any] {
    let outW = min(r.width, 128)
    let outH = max(1, r.height * outW / r.width)

    var grid = [Double](repeating: 0, count: outW * outH)
    var sum = 0.0
    var sumSq = 0.0
    for j in 0..<outH {
      let sy = r.y + j * r.height / outH
      for i in 0..<outW {
        let v = luma(r.x + i * r.width / outW, sy)
        grid[j * outW + i] = v
        sum += v
        sumSq += v * v
      }
    }
    let n = Double(grid.count)
    let mean = sum / n
    let variance = max(0, sumSq / n - mean * mean)

    var lapSum = 0.0
    var lapSq = 0.0
    var lapCount = 0.0
    if outW >= 3 && outH >= 3 {
      for y in 1..<(outH - 1) {
        for x in 1..<(outW - 1) {
          let i = y * outW + x
          let l = 4 * grid[i] - grid[i - outW] - grid[i + outW] - grid[i - 1] - grid[i + 1]
          lapSum += l
          lapSq += l * l
          lapCount += 1
        }
      }
    }
    let lapVariance = lapCount > 0 ? max(0, lapSq / lapCount - (lapSum / lapCount) * (lapSum / lapCount)) : 0

    return [
      "brightness": mean / 255,
      "contrast": variance.squareRoot() / 255,
      "laplacianVariance": lapVariance
    ]
  }

  /// Y plane of a bi-planar 420f buffer that is already upright (the connection rotates it).
  static func stats(yPlaneOf buffer: CVPixelBuffer, rect: CGRect) -> [String: Any]? {
    let width = CVPixelBufferGetWidthOfPlane(buffer, 0)
    let height = CVPixelBufferGetHeightOfPlane(buffer, 0)
    guard let r = region(rect, width: width, height: height) else {
      return nil
    }

    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) else {
      return nil
    }
    let rowBytes = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
    let pixels = base.assumingMemoryBound(to: UInt8.self)
    return stats(r) { x, y in Double(pixels[y * rowBytes + x]) }
  }
}

// MARK: - Helpers

internal func rectDict(_ rect: CGRect) -> [String: Any] {
  ["x": Double(rect.minX), "y": Double(rect.minY), "width": Double(rect.width), "height": Double(rect.height)]
}

private func pointDict(_ point: CGPoint) -> [String: Any] {
  ["x": Double(point.x), "y": Double(point.y)]
}

private func centroid(_ points: [CGPoint]) -> CGPoint? {
  guard !points.isEmpty else {
    return nil
  }
  let n = CGFloat(points.count)
  return CGPoint(x: points.reduce(0) { $0 + $1.x } / n, y: points.reduce(0) { $0 + $1.y } / n)
}

private func dot(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
  a.x * b.x + a.y * b.y
}

private func normalize(_ p: CGPoint) -> CGPoint {
  let length = (p.x * p.x + p.y * p.y).squareRoot()
  return length > 0 ? CGPoint(x: p.x / length, y: p.y / length) : .zero
}
