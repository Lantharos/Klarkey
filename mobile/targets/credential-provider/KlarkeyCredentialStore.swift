import AuthenticationServices
import Foundation

struct KlarkeySharedCredential: Codable {
  let id: String
  let title: String
  let username: String
  let domain: String?
  let password: String?
  let otpCode: String?
  let hasPassword: Bool
  let hasOtp: Bool?
  let hasPasskey: Bool
  let lastUsedAt: Double
}

struct KlarkeyPasswordCredential {
  let serviceTitle: String
  let username: String
  let password: String
}

struct KlarkeyOneTimeCodeCredential {
  let serviceTitle: String
  let username: String
  let code: String
}

enum KlarkeyCredentialStore {
  private static let suiteName = "group.com.lantharos.klarkey"
  private static let credentialsKey = "klarkey.ios.provider.credentials.v1"
  private static let unlockedUntilKey = "klarkey.ios.provider.unlockedUntil.v1"

  static func isUnlocked() -> Bool {
    defaults().double(forKey: unlockedUntilKey) > Date().timeIntervalSince1970 * 1000
  }

  static func passwordCredential(
    for serviceIdentifiers: [ASCredentialServiceIdentifier]
  ) -> KlarkeyPasswordCredential? {
    let hosts = serviceIdentifiers.map(\.identifier).map(normalizeHost)
    return credentials()
      .filter { credential in credential.hasPassword && credential.password?.isEmpty == false }
      .first { credential in
        guard let domain = credential.domain.map(normalizeHost), !hosts.isEmpty else {
          return true
        }
        return hosts.contains(domain) || hosts.contains { host in host.hasSuffix("." + domain) }
      }
      .map(toPasswordCredential)
  }

  static func fallbackPasswordCredential() -> KlarkeyPasswordCredential? {
    credentials()
      .filter { credential in credential.hasPassword && credential.password?.isEmpty == false }
      .first
      .map(toPasswordCredential)
  }

  static func passwordCredential(for identity: ASPasswordCredentialIdentity) -> KlarkeyPasswordCredential? {
    guard let recordIdentifier = identity.recordIdentifier else {
      return nil
    }

    return credentials()
      .first { credential in credential.id == recordIdentifier && credential.hasPassword && credential.password?.isEmpty == false }
      .flatMap(toPasswordCredential)
  }

  static func oneTimeCodeCredential(
    for serviceIdentifiers: [ASCredentialServiceIdentifier]
  ) -> KlarkeyOneTimeCodeCredential? {
    credentialWithOneTimeCode(for: serviceIdentifiers) ?? fallbackOneTimeCodeCredential()
  }

  static func fallbackOneTimeCodeCredential() -> KlarkeyOneTimeCodeCredential? {
    credentials()
      .filter { credential in credential.hasOtp == true && credential.otpCode?.isEmpty == false }
      .first
      .map(toOneTimeCodeCredential)
  }

  static func oneTimeCodeCredential(for identity: ASOneTimeCodeCredentialIdentity) -> KlarkeyOneTimeCodeCredential? {
    guard let recordIdentifier = identity.recordIdentifier?.replacingOccurrences(of: ":otp", with: "") else {
      return nil
    }

    return credentials()
      .first { credential in credential.id == recordIdentifier && credential.hasOtp == true && credential.otpCode?.isEmpty == false }
      .flatMap(toOneTimeCodeCredential)
  }

  static func textToInsert() -> String? {
    credentials().first { credential in !credential.username.isEmpty }?.username
  }

  private static func credentials() -> [KlarkeySharedCredential] {
    guard isUnlocked(),
      let payload = defaults().string(forKey: credentialsKey),
      let data = payload.data(using: .utf8),
      let credentials = try? JSONDecoder().decode([KlarkeySharedCredential].self, from: data)
    else {
      return []
    }
    return credentials
  }

  private static func toPasswordCredential(_ credential: KlarkeySharedCredential) -> KlarkeyPasswordCredential? {
    guard let password = credential.password, !password.isEmpty else {
      return nil
    }
    return KlarkeyPasswordCredential(
      serviceTitle: credential.title,
      username: credential.username,
      password: password
    )
  }

  private static func credentialWithOneTimeCode(
    for serviceIdentifiers: [ASCredentialServiceIdentifier]
  ) -> KlarkeyOneTimeCodeCredential? {
    let hosts = serviceIdentifiers.map(\.identifier).map(normalizeHost)
    return credentials()
      .filter { credential in credential.hasOtp == true && credential.otpCode?.isEmpty == false }
      .first { credential in
        guard let domain = credential.domain.map(normalizeHost), !hosts.isEmpty else {
          return true
        }
        return hosts.contains(domain) || hosts.contains { host in host.hasSuffix("." + domain) }
      }
      .map(toOneTimeCodeCredential)
  }

  private static func toOneTimeCodeCredential(_ credential: KlarkeySharedCredential) -> KlarkeyOneTimeCodeCredential? {
    guard let code = credential.otpCode, !code.isEmpty else {
      return nil
    }
    return KlarkeyOneTimeCodeCredential(
      serviceTitle: credential.title,
      username: credential.username,
      code: code
    )
  }

  private static func normalizeHost(_ value: String) -> String {
    value
      .replacingOccurrences(of: "https://", with: "")
      .replacingOccurrences(of: "http://", with: "")
      .replacingOccurrences(of: "www.", with: "")
      .split(separator: "/")
      .first
      .map(String.init)?
      .lowercased() ?? value.lowercased()
  }

  private static func defaults() -> UserDefaults {
    UserDefaults(suiteName: suiteName) ?? .standard
  }
}
