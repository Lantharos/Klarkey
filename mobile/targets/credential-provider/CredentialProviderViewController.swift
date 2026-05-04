import AuthenticationServices
import UIKit

final class CredentialProviderViewController: ASCredentialProviderViewController {
  private let titleLabel = UILabel()
  private let messageLabel = UILabel()
  private let primaryButton = UIButton(type: .system)
  private let secondaryButton = UIButton(type: .system)
  private var primaryAction: (() -> Void)?
  private var secondaryAction: (() -> Void)?

  override func viewDidLoad() {
    super.viewDidLoad()
    configureView()
    render(title: "Klarkey", message: "Unlock Klarkey to fill credentials.", primaryTitle: "Open Klarkey")
  }

  override func prepareInterfaceForExtensionConfiguration() {
    render(
      title: "Enable Klarkey",
      message: "Turn on Klarkey for passwords, passkeys, one-time codes, and text insertion.",
      primaryTitle: "Done",
      primaryAction: { [weak self] in self?.extensionContext.completeExtensionConfigurationRequest() }
    )
  }

  override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
    guard KlarkeyCredentialStore.isUnlocked() else {
      render(
        title: "Unlock Klarkey",
        message: "Open Klarkey before filling a password.",
        primaryTitle: "Open Klarkey",
        primaryAction: { [weak self] in self?.requireInteraction() },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    guard let credential = KlarkeyCredentialStore.passwordCredential(for: serviceIdentifiers) else {
      render(
        title: "No saved password",
        message: "Open Klarkey and save a login before filling this app.",
        primaryTitle: "Open Klarkey",
        primaryAction: { [weak self] in self?.requireInteraction() },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    render(
      title: credential.serviceTitle,
      message: "Fill \(credential.username) from Klarkey.",
      primaryTitle: "Fill password",
      primaryAction: { [weak self] in self?.completePasswordCredential(credential) },
      secondaryTitle: "Cancel",
      secondaryAction: { [weak self] in self?.cancelForUser() }
    )
  }

  override func prepareCredentialList(
    for serviceIdentifiers: [ASCredentialServiceIdentifier],
    requestParameters: ASPasskeyCredentialRequestParameters
  ) {
    guard KlarkeyCredentialStore.isUnlocked() else {
      render(
        title: "Unlock Klarkey",
        message: "Open Klarkey before filling a passkey.",
        primaryTitle: "Open Klarkey",
        primaryAction: { [weak self] in self?.requireInteraction() },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    if let passkey = KlarkeyPasskeyStore.firstPasskey(
      relyingParty: requestParameters.relyingPartyIdentifier,
      allowedCredentials: requestParameters.allowedCredentials
    ) {
      render(
        title: "Fill passkey",
        message: "Use \(passkey.username) for \(passkey.relyingParty).",
        primaryTitle: "Fill passkey",
        primaryAction: { [weak self] in self?.completePasskeyAssertion(passkey, clientDataHash: requestParameters.clientDataHash) },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    render(
      title: "Choose a passkey",
      message: "Open Klarkey to approve a passkey for \(requestParameters.relyingPartyIdentifier).",
      primaryTitle: "Open Klarkey",
      primaryAction: { [weak self] in self?.requireInteraction() },
      secondaryTitle: "Cancel",
      secondaryAction: { [weak self] in self?.cancelForUser() }
    )
  }

  override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
    guard KlarkeyCredentialStore.isUnlocked() else {
      render(
        title: "Unlock Klarkey",
        message: "Open Klarkey before filling a one-time code.",
        primaryTitle: "Open Klarkey",
        primaryAction: { [weak self] in self?.requireInteraction() },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    let credential = KlarkeyCredentialStore.oneTimeCodeCredential(for: serviceIdentifiers)
    render(
      title: credential?.serviceTitle ?? "Choose a code",
      message: credential.map { "Fill a one-time code for \($0.username)." } ?? "Unlock Klarkey to fill a one-time code.",
      primaryTitle: credential == nil ? "Open Klarkey" : "Fill code",
      primaryAction: { [weak self] in
        if let credential {
          self?.completeOneTimeCodeCredential(credential)
        } else {
          self?.requireInteraction()
        }
      },
      secondaryTitle: "Cancel",
      secondaryAction: { [weak self] in self?.cancelForUser() }
    )
  }

  override func prepareInterfaceForUserChoosingTextToInsert() {
    render(
      title: "Choose text",
      message: "Fill a saved identity field from Klarkey.",
      primaryTitle: "Fill email",
      primaryAction: { [weak self] in
        guard let text = KlarkeyCredentialStore.textToInsert() else {
          self?.requireInteraction()
          return
        }
        self?.extensionContext.completeRequest(withTextToInsert: text)
      },
      secondaryTitle: "Cancel",
      secondaryAction: { [weak self] in self?.cancelForUser() }
    )
  }

  override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
    let needsUnlockedVault = credentialRequest is ASPasskeyCredentialRequest
      || credentialRequest is ASPasswordCredentialRequest
      || credentialRequest is ASOneTimeCodeCredentialRequest

    if !KlarkeyCredentialStore.isUnlocked() && needsUnlockedVault {
      render(
        title: "Unlock Klarkey",
        message: "Open Klarkey before filling this credential.",
        primaryTitle: "Open Klarkey",
        primaryAction: { [weak self] in self?.requireInteraction() },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    if let passkeyRequest = credentialRequest as? ASPasskeyCredentialRequest,
      let identity = passkeyRequest.credentialIdentity as? ASPasskeyCredentialIdentity,
      let passkey = KlarkeyPasskeyStore.passkey(for: identity) {
      render(
        title: "Fill passkey",
        message: "Use \(passkey.username) for \(passkey.relyingParty).",
        primaryTitle: "Fill passkey",
        primaryAction: { [weak self] in self?.completePasskeyAssertion(passkey, clientDataHash: passkeyRequest.clientDataHash) },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    if let passwordRequest = credentialRequest as? ASPasswordCredentialRequest {
      let identity = passwordRequest.credentialIdentity as? ASPasswordCredentialIdentity
      guard let credential = identity.flatMap({ KlarkeyCredentialStore.passwordCredential(for: $0) }) else {
        requireInteraction()
        return
      }
      render(
        title: "Fill password",
        message: "Fill \(credential.username) from Klarkey.",
        primaryTitle: "Fill password",
        primaryAction: { [weak self] in self?.completePasswordCredential(credential) },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    if let oneTimeCodeRequest = credentialRequest as? ASOneTimeCodeCredentialRequest {
      let identity = oneTimeCodeRequest.credentialIdentity as? ASOneTimeCodeCredentialIdentity
      guard let credential = identity.flatMap({ KlarkeyCredentialStore.oneTimeCodeCredential(for: $0) }) else {
        requireInteraction()
        return
      }

      render(
        title: "Fill code",
        message: "Fill a one-time code for \(credential.username).",
        primaryTitle: "Fill code",
        primaryAction: { [weak self] in self?.completeOneTimeCodeCredential(credential) },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    render(
      title: "Unlock Klarkey",
      message: "Authentication is required before filling this credential.",
      primaryTitle: "Open Klarkey",
      primaryAction: { [weak self] in self?.requireInteraction() },
      secondaryTitle: "Cancel",
      secondaryAction: { [weak self] in self?.cancelForUser() }
    )
  }

  override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
    if credentialRequest is ASPasskeyCredentialRequest && !KlarkeyCredentialStore.isUnlocked() {
      requireInteraction()
      return
    }

    if let passkeyRequest = credentialRequest as? ASPasskeyCredentialRequest,
      let identity = passkeyRequest.credentialIdentity as? ASPasskeyCredentialIdentity,
      let passkey = KlarkeyPasskeyStore.passkey(for: identity) {
      completePasskeyAssertion(passkey, clientDataHash: passkeyRequest.clientDataHash)
      return
    }

    if let passwordRequest = credentialRequest as? ASPasswordCredentialRequest {
      let identity = passwordRequest.credentialIdentity as? ASPasswordCredentialIdentity
      guard let credential = identity.flatMap({ KlarkeyCredentialStore.passwordCredential(for: $0) }) else {
        requireInteraction()
        return
      }
      completePasswordCredential(credential)
      return
    }

    if let oneTimeCodeRequest = credentialRequest as? ASOneTimeCodeCredentialRequest {
      let identity = oneTimeCodeRequest.credentialIdentity as? ASOneTimeCodeCredentialIdentity
      guard let credential = identity.flatMap({ KlarkeyCredentialStore.oneTimeCodeCredential(for: $0) }) else {
        requireInteraction()
        return
      }
      completeOneTimeCodeCredential(credential)
      return
    }

    requireInteraction()
  }

  override func prepareInterface(forPasskeyRegistration registrationRequest: any ASCredentialRequest) {
    guard KlarkeyCredentialStore.isUnlocked() else {
      render(
        title: "Unlock Klarkey",
        message: "Open Klarkey before saving a passkey.",
        primaryTitle: "Open Klarkey",
        primaryAction: { [weak self] in self?.requireInteraction() },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    if let request = registrationRequest as? ASPasskeyCredentialRequest,
      request.credentialIdentity is ASPasskeyCredentialIdentity {
      render(
        title: "Save passkey",
        message: "Save this passkey in Klarkey.",
        primaryTitle: "Save passkey",
        primaryAction: { [weak self] in self?.completePasskeyRegistration(request) },
        secondaryTitle: "Cancel",
        secondaryAction: { [weak self] in self?.cancelForUser() }
      )
      return
    }

    render(
      title: "Save passkey",
      message: "Open Klarkey to save this passkey in your vault.",
      primaryTitle: "Open Klarkey",
      primaryAction: { [weak self] in self?.requireInteraction() },
      secondaryTitle: "Cancel",
      secondaryAction: { [weak self] in self?.cancelForUser() }
    )
  }

  override func performWithoutUserInteractionIfPossible(passkeyRegistration registrationRequest: ASPasskeyCredentialRequest) {
    guard KlarkeyCredentialStore.isUnlocked() else {
      requireInteraction()
      return
    }

    completePasskeyRegistration(registrationRequest)
  }

  private func configureView() {
    view.backgroundColor = UIColor(red: 26 / 255, green: 26 / 255, blue: 27 / 255, alpha: 1)

    titleLabel.font = .systemFont(ofSize: 28, weight: .semibold)
    titleLabel.textColor = .white
    titleLabel.numberOfLines = 0

    messageLabel.font = .systemFont(ofSize: 15, weight: .regular)
    messageLabel.textColor = UIColor.white.withAlphaComponent(0.58)
    messageLabel.numberOfLines = 0

    [primaryButton, secondaryButton].forEach { button in
      button.layer.cornerRadius = 12
      button.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
      button.heightAnchor.constraint(equalToConstant: 48).isActive = true
    }

    primaryButton.tintColor = .white
    primaryButton.backgroundColor = UIColor.white.withAlphaComponent(0.12)
    primaryButton.addTarget(self, action: #selector(runPrimaryAction), for: .touchUpInside)

    secondaryButton.tintColor = UIColor.white.withAlphaComponent(0.72)
    secondaryButton.backgroundColor = UIColor.white.withAlphaComponent(0.06)
    secondaryButton.addTarget(self, action: #selector(runSecondaryAction), for: .touchUpInside)

    let stack = UIStackView(arrangedSubviews: [titleLabel, messageLabel, primaryButton, secondaryButton])
    stack.axis = .vertical
    stack.spacing = 16
    stack.alignment = .fill
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)

    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
    ])
  }

  private func render(
    title: String,
    message: String,
    primaryTitle: String,
    primaryAction: (() -> Void)? = nil,
    secondaryTitle: String? = nil,
    secondaryAction: (() -> Void)? = nil
  ) {
    titleLabel.text = title
    messageLabel.text = message
    primaryButton.setTitle(primaryTitle, for: .normal)
    secondaryButton.setTitle(secondaryTitle, for: .normal)
    secondaryButton.isHidden = secondaryTitle == nil
    self.primaryAction = primaryAction ?? { [weak self] in self?.requireInteraction() }
    self.secondaryAction = secondaryAction
  }

  private func completePasswordCredential(_ credential: KlarkeyPasswordCredential) {
    let passwordCredential = ASPasswordCredential(user: credential.username, password: credential.password)
    extensionContext.completeRequest(withSelectedCredential: passwordCredential)
  }

  private func completeOneTimeCodeCredential(_ credential: KlarkeyOneTimeCodeCredential) {
    extensionContext.completeOneTimeCodeRequest(using: ASOneTimeCodeCredential(code: credential.code))
  }

  private func completePasskeyRegistration(_ request: ASPasskeyCredentialRequest) {
    guard let credential = KlarkeyPasskeyStore.createRegistrationCredential(request: request) else {
      cancelForUser()
      return
    }

    extensionContext.completeRegistrationRequest(using: credential)
  }

  private func completePasskeyAssertion(_ passkey: KlarkeyStoredPasskey, clientDataHash: Data) {
    guard let credential = KlarkeyPasskeyStore.assertionCredential(passkey: passkey, clientDataHash: clientDataHash) else {
      cancelForUser()
      return
    }

    extensionContext.completeAssertionRequest(using: credential)
  }

  private func requireInteraction() {
    extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userInteractionRequired.rawValue))
  }

  private func cancelForUser() {
    extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue))
  }

  @objc private func runPrimaryAction() {
    primaryAction?()
  }

  @objc private func runSecondaryAction() {
    secondaryAction?()
  }
}
