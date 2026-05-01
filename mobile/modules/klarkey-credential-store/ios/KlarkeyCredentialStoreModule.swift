import AuthenticationServices
import ExpoModulesCore
import Foundation

public class KlarkeyCredentialStoreModule: Module {
  private let suiteName = "group.com.lantharos.klarkey"
  private let credentialsKey = "klarkey.ios.provider.credentials.v1"
  private let passkeysKey = "klarkey.ios.provider.passkeys.v1"
  private let unlockedUntilKey = "klarkey.ios.provider.unlockedUntil.v1"

  public func definition() -> ModuleDefinition {
    Name("KlarkeyCredentialStore")

    Function("replaceCredentials") { (payload: String, unlockedUntil: Double) -> Void in
      let previousPayload = defaults().string(forKey: credentialsKey)
      defaults().set(payload, forKey: credentialsKey)
      defaults().set(unlockedUntil, forKey: unlockedUntilKey)
      syncCredentialIdentities(previousPayload: previousPayload, nextPayload: payload)
    }

    Function("getProviderPasskeys") { () -> String in
      providerPasskeysPayload()
    }

    Function("lock") { () -> Void in
      defaults().set(0, forKey: unlockedUntilKey)
    }
  }

  private func providerPasskeysPayload() -> String {
    guard let data = defaults().data(forKey: passkeysKey),
      let passkeys = try? JSONDecoder().decode([ProviderPasskey].self, from: data)
    else {
      return "[]"
    }

    let payload = passkeys.map { passkey in
      [
        "id": passkey.id.base64URLEncodedString(),
        "rpId": passkey.relyingParty,
        "username": passkey.username,
        "createdAt": isoDay(passkey.lastUsedAt),
        "lastUsedAt": "Provider",
        "providerBacked": true
      ] as [String: Any]
    }
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
      let value = String(data: data, encoding: .utf8)
    else {
      return "[]"
    }
    return value
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
    guard let domain = credential.normalizedDomain else {
      return []
    }

    let serviceIdentifier = ASCredentialServiceIdentifier(identifier: domain, type: .domain)
    var identities: [any ASCredentialIdentity] = []

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

    return identities
  }

  private func defaults() -> UserDefaults {
    UserDefaults(suiteName: suiteName) ?? .standard
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
  let signCount: UInt32
  let lastUsedAt: Date
}

private struct SharedCredential: Codable {
  let id: String
  let title: String
  let username: String
  let domain: String?
  let password: String?
  let otpCode: String?
  let hasPassword: Bool
  let hasOtp: Bool?

  var normalizedDomain: String? {
    guard let domain else {
      return nil
    }

    let host = domain
      .replacingOccurrences(of: "https://", with: "")
      .replacingOccurrences(of: "http://", with: "")
      .replacingOccurrences(of: "www.", with: "")
      .split(separator: "/")
      .first
      .map(String.init)?
      .lowercased()

    return host?.isEmpty == false ? host : nil
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
