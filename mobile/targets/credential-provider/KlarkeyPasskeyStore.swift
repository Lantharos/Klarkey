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
  let itemId: String?
  let privateKeyJwk: SyncedPasskeyJwk?
  var signCount: UInt32
  var lastUsedAt: Date
}

struct SyncedPasskeyJwk: Codable {
  let kty: String
  let crv: String
  let x: String
  let y: String
  let d: String
  let ext: Bool

  var isP256PrivateKey: Bool {
    guard kty == "EC",
      crv == "P-256",
      let xData = Data(base64URLString: x),
      let yData = Data(base64URLString: y),
      xData.count == 32,
      yData.count == 32,
      let privateKey
    else {
      return false
    }

    let publicKey = privateKey.publicKey.x963Representation
    return publicKey.count == 65 &&
      publicKey.subdata(in: 1..<33) == xData &&
      publicKey.subdata(in: 33..<65) == yData
  }

  var privateKey: P256.Signing.PrivateKey? {
    guard let privateKeyData = Data(base64URLString: d),
      privateKeyData.count == 32
    else {
      return nil
    }
    return try? P256.Signing.PrivateKey(rawRepresentation: privateKeyData)
  }
}

enum KlarkeyPasskeyStore {
  private static let suiteName = "group.com.lantharos.klarkey"
  private static let passkeysKey = "klarkey.ios.provider.passkeys.v2"
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

    guard let credentialId = randomData(32) else {
      return nil
    }
    let keyTag = Data((keyPrefix + credentialId.base64URLEncodedString()).utf8)
    let privateKey = P256.Signing.PrivateKey()
    guard let coseKey = coseKey(from: privateKey.publicKey)
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
      itemId: UUID().uuidString,
      privateKeyJwk: jwk(privateKey: privateKey),
      signCount: 0,
      lastUsedAt: Date()
    )
    guard save(passkey) else {
      return nil
    }
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
    let nextCount = passkey.privateKeyJwk == nil ? passkey.signCount + 1 : 0
    let authData = assertionAuthenticatorData(relyingParty: passkey.relyingParty, signCount: nextCount)
    guard let signature = sign(data: authData + clientDataHash, passkey: passkey) else {
      return nil
    }

    var nextPasskey = passkey
    nextPasskey.signCount = nextCount
    nextPasskey.lastUsedAt = Date()
    guard save(nextPasskey) else {
      return nil
    }

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
    guard KlarkeyCredentialStore.isUnlocked(),
      let store = defaults(),
      let data = KlarkeyProviderCrypto.readData(
      defaults: store,
      key: passkeysKey
    ) else {
      return []
    }
    return (try? JSONDecoder().decode([KlarkeyStoredPasskey].self, from: data)) ?? []
  }

  private static func save(_ passkey: KlarkeyStoredPasskey) -> Bool {
    guard KlarkeyCredentialStore.isUnlocked(),
      let store = defaults()
    else {
      return false
    }

    var passkeys = loadPasskeys().filter { existing in existing.id != passkey.id }
    passkeys.insert(passkey, at: 0)
    if let data = try? JSONEncoder().encode(passkeys) {
      return KlarkeyProviderCrypto.writeData(data, defaults: store, key: passkeysKey)
    }
    return false
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

  private static func defaults() -> UserDefaults? {
    UserDefaults(suiteName: suiteName)
  }

  private static func createPrivateKey(tag: Data, secureEnclave: Bool) -> SecKey? {
    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag,
        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
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

  private static func sign(data: Data, passkey: KlarkeyStoredPasskey) -> Data? {
    if let jwk = passkey.privateKeyJwk {
      return sign(data: data, jwk: jwk)
    }

    guard let key = privateKey(tag: passkey.keyTag) else {
      return nil
    }

    var error: Unmanaged<CFError>?
    return SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, data as CFData, &error) as Data?
  }

  private static func sign(data: Data, jwk: SyncedPasskeyJwk) -> Data? {
    guard jwk.isP256PrivateKey,
      let privateKey = jwk.privateKey,
      let signature = try? privateKey.signature(for: data)
    else {
      return nil
    }

    return signature.derRepresentation
  }

  private static func jwk(privateKey: P256.Signing.PrivateKey) -> SyncedPasskeyJwk {
    let publicKey = privateKey.publicKey.x963Representation
    let x = publicKey.subdata(in: 1..<33)
    let y = publicKey.subdata(in: 33..<65)
    return SyncedPasskeyJwk(
      kty: "EC",
      crv: "P-256",
      x: x.base64URLEncodedString(),
      y: y.base64URLEncodedString(),
      d: privateKey.rawRepresentation.base64URLEncodedString(),
      ext: true
    )
  }

  private static func coseKey(from publicKey: P256.Signing.PublicKey) -> Data? {
    let external = publicKey.x963Representation
    guard external.count == 65,
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
    data.append(0x5d)
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
    data.append(0x1d)
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

  private static func randomData(_ byteCount: Int) -> Data? {
    var data = Data(count: byteCount)
    let status = data.withUnsafeMutableBytes { buffer in
      SecRandomCopyBytes(kSecRandomDefault, byteCount, buffer.baseAddress!)
    }
    guard status == errSecSuccess else {
      return nil
    }
    return data
  }
}

private extension Data {
  init?(base64URLString: String) {
    var value = base64URLString
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let padding = (4 - value.count % 4) % 4
    value += String(repeating: "=", count: padding)
    self.init(base64Encoded: value)
  }

  func base64URLEncodedString() -> String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
