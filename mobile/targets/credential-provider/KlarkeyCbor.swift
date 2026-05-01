import Foundation

final class KlarkeyCbor {
  private var bytes = Data()

  func map(_ size: Int) -> KlarkeyCbor {
    type(5, size)
    return self
  }

  func int(_ value: Int) -> KlarkeyCbor {
    if value >= 0 {
      type(0, value)
    } else {
      type(1, -1 - value)
    }
    return self
  }

  func text(_ value: String) -> KlarkeyCbor {
    let data = Data(value.utf8)
    type(3, data.count)
    bytes.append(data)
    return self
  }

  func data(_ value: Data) -> KlarkeyCbor {
    type(2, value.count)
    bytes.append(value)
    return self
  }

  func encoded() -> Data {
    bytes
  }

  private func type(_ major: UInt8, _ value: Int) {
    if value < 24 {
      bytes.append((major << 5) | UInt8(value))
      return
    }

    if value < 256 {
      bytes.append((major << 5) | 24)
      bytes.append(UInt8(value))
      return
    }

    if value < 65_536 {
      bytes.append((major << 5) | 25)
      bytes.append(UInt8((value >> 8) & 0xff))
      bytes.append(UInt8(value & 0xff))
      return
    }

    bytes.append((major << 5) | 26)
    bytes.append(UInt8((value >> 24) & 0xff))
    bytes.append(UInt8((value >> 16) & 0xff))
    bytes.append(UInt8((value >> 8) & 0xff))
    bytes.append(UInt8(value & 0xff))
  }
}
