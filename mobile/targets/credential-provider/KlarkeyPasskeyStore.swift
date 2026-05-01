import AuthenticationServices
import CryptoKit
import Foundation
import Security

struct KlarkeyStoredPasskey: Codable {
  let id: Data
  let relyingParty: String
  let username: String
  let userHandle: Data
  let keyTag: Data
  var signCount: UInt32
  var lastUsedAt: Date
}

enum KlarkeyPasskeyStore {
  private static let suiteName = "group.com.lantharos.klarkey"
  private static let passkeysKey = "klarkey.ios.provider.passkeys.v1"
  private static let keyPrefix = "com.lantharos.klarkey.passkey."

  static func firstPasskey(
    relyingParty: String,
    allowedCredentials: [Data] = []
  ) -> KlarkeyStoredPasskey? {
    let passkeys = loadPasskeys().filter { passkey in
      passkey.relyingParty == relyingParty && (allowedCredentials.isEmpty || allowedCredentials.contains(passkey.id))
    }
    return passkeys.sorted { left, right in left.lastUsedAt > right.lastUsedAt }.first
  }

  static func passkey(for identity: ASPasskeyCredentialIdentity) -> KlarkeyStoredPasskey? {
    loadPasskeys().first { passkey in
      passkey.id == identity.credentialID && passkey.relyingParty == identity.relyingPartyIdentifier
    }
  }

  static func createRegistrationCredential(
    request: ASPasskeyCredentialRequest
  ) -> ASPasskeyRegistrationCredential? {
    guard let identity = request.credentialIdentity as? ASPasskeyCredentialIdentity else {
      return nil
    }

    let credentialId = randomData(32)
    let keyTag = Data((keyPrefix + credentialId.base64URLEncodedString()).utf8)
    guard let publicKey = createPrivateKey(tag: keyTag, secureEnclave: true) ?? createPrivateKey(tag: keyTag, secureEnclave: false),
      let coseKey = coseKey(from: publicKey)
    else {
      return nil
    }

    let authData = registrationAuthenticatorData(
      relyingParty: identity.relyingPartyIdentifier,
      credentialId: credentialId,
      coseKey: coseKey
    )
    let attestationObject = KlarkeyCbor()
      .map(3)
      .text("fmt").text("none")
      .text("attStmt").map(0)
      .text("authData").data(authData)
      .encoded()

    let passkey = KlarkeyStoredPasskey(
      id: credentialId,
      relyingParty: identity.relyingPartyIdentifier,
      username: identity.userName,
      userHandle: identity.userHandle,
      keyTag: keyTag,
      signCount: 0,
      lastUsedAt: Date()
    )
    save(passkey)
    saveIdentity(for: passkey)

    return ASPasskeyRegistrationCredential(
      relyingParty: identity.relyingPartyIdentifier,
      clientDataHash: request.clientDataHash,
      credentialID: credentialId,
      attestationObject: attestationObject
    )
  }

  static func assertionCredential(
    passkey: KlarkeyStoredPasskey,
    clientDataHash: Data
  ) -> ASPasskeyAssertionCredential? {
    let nextCount = passkey.signCount + 1
    let authData = assertionAuthenticatorData(relyingParty: passkey.relyingParty, signCount: nextCount)
    guard let signature = sign(data: authData + clientDataHash, tag: passkey.keyTag) else {
      return nil
    }

    var nextPasskey = passkey
    nextPasskey.signCount = nextCount
    nextPasskey.lastUsedAt = Date()
    save(nextPasskey)

    return ASPasskeyAssertionCredential(
      userHandle: passkey.userHandle,
      relyingParty: passkey.relyingParty,
      signature: signature,
      clientDataHash: clientDataHash,
      authenticatorData: authData,
      credentialID: passkey.id
    )
  }

  private static func loadPasskeys() -> [KlarkeyStoredPasskey] {
    guard let data = defaults().data(forKey: passkeysKey) else {
      return []
    }
    return (try? JSONDecoder().decode([KlarkeyStoredPasskey].self, from: data)) ?? []
  }

  private static func save(_ passkey: KlarkeyStoredPasskey) {
    var passkeys = loadPasskeys().filter { existing in existing.id != passkey.id }
    passkeys.insert(passkey, at: 0)
    if let data = try? JSONEncoder().encode(passkeys) {
      defaults().set(data, forKey: passkeysKey)
    }
  }

  private static func saveIdentity(for passkey: KlarkeyStoredPasskey) {
    let identity = ASPasskeyCredentialIdentity(
      relyingPartyIdentifier: passkey.relyingParty,
      userName: passkey.username,
      credentialID: passkey.id,
      userHandle: passkey.userHandle,
      recordIdentifier: passkey.id.base64URLEncodedString()
    )
    ASCredentialIdentityStore.shared.saveCredentialIdentities([identity], completion: nil)
  }

  private static func defaults() -> UserDefaults {
    UserDefaults(suiteName: suiteName) ?? .standard
  }

  private static func createPrivateKey(tag: Data, secureEnclave: Bool) -> SecKey? {
    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      ]
    ]
    if secureEnclave {
      attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
    }

    var error: Unmanaged<CFError>?
    if let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) {
      return SecKeyCopyPublicKey(privateKey)
    }

    return nil
  }

  private static func privateKey(tag: Data) -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else {
      return nil
    }
    return (item as! SecKey)
  }

  private static func sign(data: Data, tag: Data) -> Data? {
    guard let key = privateKey(tag: tag) else {
      return nil
    }

    var error: Unmanaged<CFError>?
    return SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, data as CFData, &error) as Data?
  }

  private static func coseKey(from publicKey: SecKey) -> Data? {
    var error: Unmanaged<CFError>?
    guard let external = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?,
      external.count == 65,
      external.first == 0x04
    else {
      return nil
    }

    let x = external.subdata(in: 1..<33)
    let y = external.subdata(in: 33..<65)
    return KlarkeyCbor()
      .map(5)
      .int(1).int(2)
      .int(3).int(-7)
      .int(-1).int(1)
      .int(-2).data(x)
      .int(-3).data(y)
      .encoded()
  }

  private static func registrationAuthenticatorData(
    relyingParty: String,
    credentialId: Data,
    coseKey: Data
  ) -> Data {
    var data = Data(SHA256.hash(data: Data(relyingParty.utf8)))
    data.append(0x45)
    data.append(uint32Data(0))
    data.append(Data(repeating: 0, count: 16))
    data.append(UInt8((credentialId.count >> 8) & 0xff))
    data.append(UInt8(credentialId.count & 0xff))
    data.append(credentialId)
    data.append(coseKey)
    return data
  }

  private static func assertionAuthenticatorData(relyingParty: String, signCount: UInt32) -> Data {
    var data = Data(SHA256.hash(data: Data(relyingParty.utf8)))
    data.append(0x05)
    data.append(uint32Data(signCount))
    return data
  }

  private static func uint32Data(_ value: UInt32) -> Data {
    Data([
      UInt8((value >> 24) & 0xff),
      UInt8((value >> 16) & 0xff),
      UInt8((value >> 8) & 0xff),
      UInt8(value & 0xff)
    ])
  }

  private static func randomData(_ byteCount: Int) -> Data {
    var data = Data(count: byteCount)
    _ = data.withUnsafeMutableBytes { buffer in
      SecRandomCopyBytes(kSecRandomDefault, byteCount, buffer.baseAddress!)
    }
    return data
  }
}

private extension Data {
  func base64URLEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
