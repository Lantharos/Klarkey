import CryptoKit
import Foundation
import Security

enum KlarkeyProviderCrypto {
  private static let service = "com.lantharos.klarkey.provider.shared-key"
  private static let account = "provider-payload-key"
  private static let accessGroupInfoKey = "KlarkeyKeychainAccessGroup"
  private static let maxProviderPayloadBytes = 2 * 1024 * 1024
  private static let maxSealedPayloadBytes = maxProviderPayloadBytes + 1024

  static func readString(defaults: UserDefaults, key: String) -> String? {
    if let data = readData(defaults: defaults, key: key),
      let value = String(data: data, encoding: .utf8)
    {
      return value
    }

    return nil
  }

  @discardableResult
  static func writeString(_ value: String, defaults: UserDefaults, key: String) -> Bool {
    guard let data = value.data(using: .utf8) else {
      return false
    }
    return writeData(data, defaults: defaults, key: key)
  }

  static func readData(defaults: UserDefaults, key: String) -> Data? {
    if let sealed = defaults.data(forKey: key) {
      guard sealed.count <= maxSealedPayloadBytes else {
        return nil
      }
      return decrypt(sealed)
    }

    return nil
  }

  @discardableResult
  static func writeData(_ value: Data, defaults: UserDefaults, key: String) -> Bool {
    guard value.count <= maxProviderPayloadBytes,
      let sealed = encrypt(value)
    else {
      return false
    }
    defaults.set(sealed, forKey: key)
    return true
  }

  private static func encrypt(_ data: Data) -> Data? {
    guard let key = symmetricKey() else {
      return nil
    }
    return try? AES.GCM.seal(data, using: key).combined
  }

  private static func decrypt(_ data: Data) -> Data? {
    guard let key = symmetricKey(),
      let box = try? AES.GCM.SealedBox(combined: data),
      let opened = try? AES.GCM.open(box, using: key)
    else {
      return nil
    }
    return opened
  }

  private static func symmetricKey() -> SymmetricKey? {
    if let data = readKeyData() {
      return SymmetricKey(data: data)
    }

    var key = Data(count: 32)
    let status = key.withUnsafeMutableBytes { buffer in
      SecRandomCopyBytes(kSecRandomDefault, 32, buffer.baseAddress!)
    }
    guard status == errSecSuccess, saveKeyData(key) else {
      return nil
    }
    return SymmetricKey(data: key)
  }

  private static func readKeyData() -> Data? {
    var query = baseKeyQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    return status == errSecSuccess ? item as? Data : nil
  }

  private static func saveKeyData(_ data: Data) -> Bool {
    var query = baseKeyQuery()
    query[kSecValueData as String] = data
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly

    let status = SecItemAdd(query as CFDictionary, nil)
    if status == errSecSuccess {
      return true
    }
    if status != errSecDuplicateItem {
      return false
    }

    let update: [String: Any] = [kSecValueData as String: data]
    return SecItemUpdate(baseKeyQuery() as CFDictionary, update as CFDictionary) == errSecSuccess
  }

  private static func baseKeyQuery() -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account
    ]
    if let group = accessGroup() {
      query[kSecAttrAccessGroup as String] = group
    }
    return query
  }

  private static func accessGroup() -> String? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: accessGroupInfoKey) as? String else {
      return nil
    }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty || trimmed.contains("$(") ? nil : trimmed
  }
}
