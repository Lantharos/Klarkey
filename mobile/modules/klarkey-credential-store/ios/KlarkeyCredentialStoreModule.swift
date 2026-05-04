import AuthenticationServices
import CryptoKit
import ExpoModulesCore
import Foundation
import Security

public class KlarkeyCredentialStoreModule: Module {
  private let suiteName = "group.com.lantharos.klarkey"
  private let credentialsKey = "klarkey.ios.provider.credentials.v2"
  private let passkeysKey = "klarkey.ios.provider.passkeys.v2"
  private let unlockedUntilKey = "klarkey.ios.provider.unlockedUntil.v1"
  private let maxUnlockWindowMs = 5.0 * 60.0 * 1000.0
  private let maxProviderPayloadBytes = 2 * 1024 * 1024

  public func definition() -> ModuleDefinition {
    Name("KlarkeyCredentialStore")

    Function("replaceCredentials") { (payload: String, unlockedUntil: Double) -> Void in
      guard self.isProviderPayloadSizeSafe(payload) else {
        return
      }
      guard let store = defaults() else {
        return
      }
      let previousPayload = credentialsPayload(defaults: store)
      guard KlarkeyProviderCrypto.writeString(
        payload,
        defaults: store,
        key: credentialsKey
      ) else {
        return
      }
      store.set(boundedUnlockedUntil(unlockedUntil), forKey: unlockedUntilKey)
      syncCredentialIdentities(previousPayload: previousPayload, nextPayload: payload)
    }

    Function("replacePasskeys") { (payload: String) -> Void in
      replaceSyncedPasskeys(payload: payload)
    }

    Function("getProviderPasskeys") { () -> String in
      guard let store = defaults() else {
        return "[]"
      }
      return providerPasskeysPayload(includeSecrets: isUnlocked(defaults: store))
    }

    Function("getProviderCredentials") { () -> String in
      guard let store = defaults() else {
        return "[]"
      }
      return providerCredentialsPayload(defaults: store, includeSecrets: isUnlocked(defaults: store))
    }

    Function("deleteProviderItem") { (itemId: String, passkeyIdsPayload: String) -> Void in
      deleteCredential(id: itemId)
      deletePasskeys(ids: stringSet(from: passkeyIdsPayload))
    }

    Function("lock") { () -> Void in
      defaults()?.set(0, forKey: unlockedUntilKey)
    }

    Function("unlock") { (unlockedUntil: Double) -> Void in
      defaults()?.set(boundedUnlockedUntil(unlockedUntil), forKey: unlockedUntilKey)
    }
  }

  private func providerPasskeysPayload(includeSecrets: Bool) -> String {
    guard let store = defaults() else {
      return "[]"
    }

    guard let data = KlarkeyProviderCrypto.readData(
        defaults: store,
        key: passkeysKey
      ),
      let passkeys = try? JSONDecoder().decode([ProviderPasskey].self, from: data)
    else {
      return "[]"
    }

    let payload = passkeys.map { passkey in
      [
        "id": passkey.id.base64URLEncodedString(),
        "rpId": passkey.relyingParty,
        "username": passkey.username,
        "userHandle": passkey.userHandle.base64URLEncodedString(),
        "itemId": passkey.itemId ?? "",
        "privateKeyJwk": includeSecrets ? (passkey.privateKeyJwk?.dictionary ?? "") : "",
        "signCount": 0,
        "syncedCounter": includeSecrets && passkey.privateKeyJwk != nil,
        "createdAt": isoDay(passkey.lastUsedAt),
        "lastUsedAt": passkey.privateKeyJwk == nil ? "Provider" : ISO8601DateFormatter().string(from: passkey.lastUsedAt),
        "providerBacked": passkey.privateKeyJwk == nil
      ] as [String: Any]
    }
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
      let value = String(data: data, encoding: .utf8)
    else {
      return "[]"
    }
    return value
  }

  private func providerCredentialsPayload(defaults: UserDefaults, includeSecrets: Bool) -> String {
    guard let payload = credentialsPayload(defaults: defaults),
      let data = payload.data(using: .utf8),
      let credentials = try? JSONDecoder().decode([SharedCredential].self, from: data)
    else {
      return "[]"
    }

    let output = credentials.map { credential in
      [
        "id": credential.id,
        "title": credential.title,
        "username": credential.username,
        "domain": credential.domain ?? "",
        "domains": credential.domains ?? [],
        "password": includeSecrets ? (credential.password ?? "") : "",
        "otpCode": includeSecrets ? (credential.otpCode ?? "") : "",
        "hasPassword": credential.hasPassword,
        "hasOtp": credential.hasOtp ?? false,
        "hasPasskey": credential.hasPasskey ?? false,
        "lastUsedAt": credential.lastUsedAt ?? ""
      ] as [String: Any]
    }

    guard let data = try? JSONSerialization.data(withJSONObject: output),
      let value = String(data: data, encoding: .utf8)
    else {
      return "[]"
    }
    return value
  }

  private func replaceSyncedPasskeys(payload: String) {
    guard let data = payload.data(using: .utf8),
      data.count <= maxProviderPayloadBytes,
      let incoming = try? JSONDecoder().decode([SharedPasskey].self, from: data)
    else {
      return
    }

    let incomingIds = Set(incoming.map(\.id))
    let previous = storedPasskeys()
    let preserved = previous.filter { passkey in
      passkey.privateKeyJwk == nil && !incomingIds.contains(passkey.id.base64URLEncodedString())
    }
    let next = incoming.map { passkey in
      ProviderPasskey(
        id: Data(base64URLString: passkey.id) ?? Data(),
        relyingParty: passkey.rpId,
        username: passkey.username,
        userHandle: Data(base64URLString: passkey.userHandle ?? "") ?? Data(),
        keyTag: Data(),
        itemId: passkey.itemId,
        privateKeyJwk: passkey.privateKeyJwk,
        signCount: 0,
        lastUsedAt: passkey.lastUsedAt.flatMap(ISO8601DateFormatter().date(from:)) ?? Date()
      )
    }.filter { passkey in
      !passkey.id.isEmpty &&
        !passkey.relyingParty.isEmpty &&
        !passkey.username.isEmpty &&
        !passkey.userHandle.isEmpty &&
        passkey.privateKeyJwk?.isP256PrivateKey == true
    }
    guard savePasskeys(next + preserved) else {
      return
    }
    syncPasskeyIdentities(previous: previous, next: next + preserved)
  }

  private func deleteCredential(id: String) {
    guard !id.isEmpty,
      let store = defaults(),
      let previousPayload = credentialsPayload(defaults: store),
      let data = previousPayload.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data),
      let credentials = object as? [[String: Any]]
    else {
      return
    }

    let nextCredentials = credentials.filter { credential in
      credential["id"] as? String != id
    }
    guard nextCredentials.count != credentials.count,
      let nextData = try? JSONSerialization.data(withJSONObject: nextCredentials),
      let nextPayload = String(data: nextData, encoding: .utf8)
    else {
      return
    }

    guard KlarkeyProviderCrypto.writeString(
      nextPayload,
      defaults: store,
      key: credentialsKey
    ) else {
      return
    }
    syncCredentialIdentities(previousPayload: previousPayload, nextPayload: nextPayload)
  }

  private func deletePasskeys(ids: Set<String>) {
    guard !ids.isEmpty,
      !storedPasskeys().isEmpty
    else {
      return
    }

    let passkeys = storedPasskeys()
    let removed = passkeys.filter { passkey in
      ids.contains(passkey.id.base64URLEncodedString())
    }
    guard !removed.isEmpty else {
      return
    }

    let nextPasskeys = passkeys.filter { passkey in
      !ids.contains(passkey.id.base64URLEncodedString())
    }
    guard savePasskeys(nextPasskeys) else {
      return
    }

    removed.forEach { passkey in
      if !passkey.keyTag.isEmpty {
        deletePrivateKey(tag: passkey.keyTag)
      }
    }
    ASCredentialIdentityStore.shared.removeCredentialIdentities(removed.map { passkeyIdentity(for: $0) }, completion: nil)
  }

  private func passkeyIdentity(for passkey: ProviderPasskey) -> ASPasskeyCredentialIdentity {
    ASPasskeyCredentialIdentity(
      relyingPartyIdentifier: passkey.relyingParty,
      userName: passkey.username,
      credentialID: passkey.id,
      userHandle: passkey.userHandle,
      recordIdentifier: passkey.id.base64URLEncodedString()
    )
  }

  private func storedPasskeys() -> [ProviderPasskey] {
    guard let store = defaults() else {
      return []
    }

    guard let data = KlarkeyProviderCrypto.readData(
        defaults: store,
        key: passkeysKey
      ),
      let passkeys = try? JSONDecoder().decode([ProviderPasskey].self, from: data)
    else {
      return []
    }
    return passkeys
  }

  private func savePasskeys(_ passkeys: [ProviderPasskey]) -> Bool {
    guard let store = defaults() else {
      return false
    }

    if let data = try? JSONEncoder().encode(passkeys) {
      return KlarkeyProviderCrypto.writeData(
        data,
        defaults: store,
        key: passkeysKey
      )
    }
    return false
  }

  private func syncPasskeyIdentities(previous: [ProviderPasskey], next: [ProviderPasskey]) {
    let previousIdentities = previous.map(passkeyIdentity)
    let nextIdentities = next.map(passkeyIdentity)
    if previousIdentities.isEmpty {
      ASCredentialIdentityStore.shared.saveCredentialIdentities(nextIdentities, completion: nil)
      return
    }

    ASCredentialIdentityStore.shared.removeCredentialIdentities(previousIdentities) { _, _ in
      ASCredentialIdentityStore.shared.saveCredentialIdentities(nextIdentities, completion: nil)
    }
  }

  private func deletePrivateKey(tag: Data) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom
    ]
    SecItemDelete(query as CFDictionary)
  }

  private func stringSet(from payload: String) -> Set<String> {
    guard let data = payload.data(using: .utf8),
      data.count <= maxProviderPayloadBytes,
      let object = try? JSONSerialization.jsonObject(with: data),
      let values = object as? [String]
    else {
      return []
    }
    return Set(values.filter { !$0.isEmpty })
  }

  private func syncCredentialIdentities(previousPayload: String?, nextPayload: String) {
    let previousIdentities = credentialIdentities(from: previousPayload)
    let nextIdentities = credentialIdentities(from: nextPayload)

    if previousIdentities.isEmpty {
      ASCredentialIdentityStore.shared.saveCredentialIdentities(nextIdentities, completion: nil)
      return
    }

    ASCredentialIdentityStore.shared.removeCredentialIdentities(previousIdentities) { _, _ in
      ASCredentialIdentityStore.shared.saveCredentialIdentities(nextIdentities, completion: nil)
    }
  }

  private func credentialIdentities(from payload: String?) -> [any ASCredentialIdentity] {
    guard let payload,
      let data = payload.data(using: .utf8),
      let credentials = try? JSONDecoder().decode([SharedCredential].self, from: data)
    else {
      return []
    }

    return credentials.flatMap(identities)
  }

  private func identities(for credential: SharedCredential) -> [any ASCredentialIdentity] {
    let serviceIdentifiers = credential.normalizedDomains.map {
      ASCredentialServiceIdentifier(identifier: $0, type: .domain)
    }
    guard !serviceIdentifiers.isEmpty else {
      return []
    }

    var identities: [any ASCredentialIdentity] = []

    for serviceIdentifier in serviceIdentifiers {
      if credential.hasPassword, credential.password?.isEmpty == false {
        identities.append(
          ASPasswordCredentialIdentity(
            serviceIdentifier: serviceIdentifier,
            user: credential.username,
            recordIdentifier: credential.id
          )
        )
      }

      if credential.hasOtp == true, credential.otpCode?.isEmpty == false {
        identities.append(
          ASOneTimeCodeCredentialIdentity(
            serviceIdentifier: serviceIdentifier,
            label: credential.title,
            recordIdentifier: credential.id + ":otp"
          )
        )
      }
    }

    return identities
  }

  private func defaults() -> UserDefaults? {
    UserDefaults(suiteName: suiteName)
  }

  private func credentialsPayload(defaults: UserDefaults) -> String? {
    KlarkeyProviderCrypto.readString(defaults: defaults, key: credentialsKey)
  }

  private func isUnlocked(defaults: UserDefaults) -> Bool {
    defaults.double(forKey: unlockedUntilKey) > Date().timeIntervalSince1970 * 1000
  }

  private func boundedUnlockedUntil(_ value: Double) -> Double {
    let now = Date().timeIntervalSince1970 * 1000
    guard value.isFinite, value > now else {
      return 0
    }
    return min(value, now + maxUnlockWindowMs)
  }

  private func isProviderPayloadSizeSafe(_ value: String) -> Bool {
    guard let data = value.data(using: .utf8) else {
      return false
    }
    return data.count <= maxProviderPayloadBytes
  }

  private func isoDay(_ date: Date) -> String {
    String(ISO8601DateFormatter().string(from: date).prefix(10))
  }
}

private struct ProviderPasskey: Codable {
  let id: Data
  let relyingParty: String
  let username: String
  let userHandle: Data
  let keyTag: Data
  let itemId: String?
  let privateKeyJwk: SyncedPasskeyJwk?
  let signCount: UInt32
  let lastUsedAt: Date
}

private struct SyncedPasskeyJwk: Codable {
  let kty: String
  let crv: String
  let x: String
  let y: String
  let d: String
  let ext: Bool

  var dictionary: [String: Any] {
    [
      "kty": kty,
      "crv": crv,
      "x": x,
      "y": y,
      "d": d,
      "ext": ext
    ]
  }

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

private struct SharedPasskey: Codable {
  let id: String
  let rpId: String
  let username: String
  let userHandle: String?
  let itemId: String?
  let privateKeyJwk: SyncedPasskeyJwk?
  let lastUsedAt: String?
}

private struct SharedCredential: Codable {
  let id: String
  let title: String
  let username: String
  let domain: String?
  let domains: [String]?
  let password: String?
  let otpCode: String?
  let hasPassword: Bool
  let hasOtp: Bool?
  let hasPasskey: Bool?
  let lastUsedAt: String?

  var normalizedDomains: [String] {
    var values = (domains ?? []).compactMap(normalizeHost)
    if let domain = domain.flatMap(normalizeHost) {
      values.append(domain)
    }
    return Array(Set(values))
  }

  private func normalizeHost(_ value: String) -> String? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let candidate = trimmed.contains("://") ? trimmed : "https://" + trimmed
    if let host = URLComponents(string: candidate)?.host, !host.isEmpty {
      return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
    let fallback = trimmed.split(separator: "/").first?.split(separator: ":").first.map(String.init) ?? trimmed
    let host = fallback.hasPrefix("www.") ? String(fallback.dropFirst(4)) : fallback
    return host.isEmpty ? nil : host
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
