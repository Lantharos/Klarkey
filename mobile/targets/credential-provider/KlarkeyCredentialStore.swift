import AuthenticationServices
import Foundation

struct KlarkeySharedCredential: Codable {
  let id: String
  let title: String
  let username: String
  let domain: String?
  let domains: [String]?
  let password: String?
  let otpCode: String?
  let hasPassword: Bool
  let hasOtp: Bool?
  let hasPasskey: Bool
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
  private static let credentialsKey = "klarkey.ios.provider.credentials.v2"
  private static let unlockedUntilKey = "klarkey.ios.provider.unlockedUntil.v1"

  static func isUnlocked() -> Bool {
    guard let store = defaults() else {
      return false
    }
    return isUnlocked(defaults: store)
  }

  static func passwordCredential(
    for serviceIdentifiers: [ASCredentialServiceIdentifier]
  ) -> KlarkeyPasswordCredential? {
    let hosts = serviceIdentifiers.map(\.identifier).map(normalizeHost).filter { !$0.isEmpty }
    return credentials()
      .filter { credential in credential.hasPassword && credential.password?.isEmpty == false }
      .first { credential in
        guard !hosts.isEmpty else {
          return false
        }
        return hosts.contains { host in credentialMatches(credential, host: host) }
      }
      .map(toPasswordCredential)
  }

  static func passwordCredential(for identity: ASPasswordCredentialIdentity) -> KlarkeyPasswordCredential? {
    let host = normalizeHost(identity.serviceIdentifier.identifier)
    guard let recordIdentifier = identity.recordIdentifier, !host.isEmpty else {
      return nil
    }

    return credentials()
      .first { credential in
        credential.id == recordIdentifier &&
          credential.hasPassword &&
          credential.password?.isEmpty == false &&
          credentialMatches(credential, host: host)
      }
      .flatMap(toPasswordCredential)
  }

  static func oneTimeCodeCredential(
    for serviceIdentifiers: [ASCredentialServiceIdentifier]
  ) -> KlarkeyOneTimeCodeCredential? {
    credentialWithOneTimeCode(for: serviceIdentifiers)
  }

  static func oneTimeCodeCredential(for identity: ASOneTimeCodeCredentialIdentity) -> KlarkeyOneTimeCodeCredential? {
    let host = normalizeHost(identity.serviceIdentifier.identifier)
    guard let recordIdentifier = identity.recordIdentifier,
      recordIdentifier.hasSuffix(":otp"),
      !host.isEmpty
    else {
      return nil
    }
    let credentialId = String(recordIdentifier.dropLast(4))

    return credentials()
      .first { credential in
        credential.id == credentialId &&
          credential.hasOtp == true &&
          credential.otpCode?.isEmpty == false &&
          credentialMatches(credential, host: host)
      }
      .flatMap(toOneTimeCodeCredential)
  }

  static func textToInsert() -> String? {
    credentials().first { credential in !credential.username.isEmpty }?.username
  }

  private static func credentials() -> [KlarkeySharedCredential] {
    guard let store = defaults(),
      isUnlocked(defaults: store),
      let payload = KlarkeyProviderCrypto.readString(
        defaults: store,
        key: credentialsKey
      ),
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
    let hosts = serviceIdentifiers.map(\.identifier).map(normalizeHost).filter { !$0.isEmpty }
    return credentials()
      .filter { credential in credential.hasOtp == true && credential.otpCode?.isEmpty == false }
      .first { credential in
        guard !hosts.isEmpty else {
          return false
        }
        return hosts.contains { host in credentialMatches(credential, host: host) }
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

  private static func credentialDomains(_ credential: KlarkeySharedCredential) -> [String] {
    var values = (credential.domains ?? []).map(normalizeHost).filter { !$0.isEmpty }
    if let domain = credential.domain.map(normalizeHost), !domain.isEmpty {
      values.append(domain)
    }
    return Array(Set(values))
  }

  private static func domainMatches(_ domain: String, _ host: String) -> Bool {
    domain == host || (isSubdomainMatchAllowed(domain) && host.hasSuffix("." + domain))
  }

  private static func credentialMatches(_ credential: KlarkeySharedCredential, host: String) -> Bool {
    credentialDomains(credential).contains { domain in domainMatches(domain, host) }
  }

  private static func isSubdomainMatchAllowed(_ domain: String) -> Bool {
    domain.contains(".") && !domain.contains(":") && !isIPv4Address(domain)
  }

  private static func isIPv4Address(_ value: String) -> Bool {
    let parts = value.split(separator: ".")
    guard parts.count == 4 else {
      return false
    }
    return parts.allSatisfy { part in
      guard let octet = Int(part) else {
        return false
      }
      return octet >= 0 && octet <= 255
    }
  }

  private static func normalizeHost(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let candidate = trimmed.contains("://") ? trimmed : "https://" + trimmed
    if let host = URLComponents(string: candidate)?.host, !host.isEmpty {
      return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
    let fallback = trimmed.split(separator: "/").first?.split(separator: ":").first.map(String.init) ?? trimmed
    return fallback.hasPrefix("www.") ? String(fallback.dropFirst(4)) : fallback
  }

  private static func defaults() -> UserDefaults? {
    UserDefaults(suiteName: suiteName)
  }

  private static func isUnlocked(defaults: UserDefaults) -> Bool {
    defaults.double(forKey: unlockedUntilKey) > Date().timeIntervalSince1970 * 1000
  }
}
