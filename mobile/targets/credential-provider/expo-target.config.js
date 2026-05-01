module.exports = (config) => ({
  type: "credentials-provider",
  name: "KlarkeyCredentialProvider",
  displayName: "Klarkey",
  bundleIdentifier: ".CredentialProvider",
  deploymentTarget: "18.0",
  frameworks: ["AuthenticationServices", "CryptoKit", "Security"],
  entitlements: {
    "com.apple.developer.authentication-services.autofill-credential-provider": true,
    "com.apple.security.application-groups": [`group.${config.ios.bundleIdentifier}`],
    "com.apple.developer.associated-domains": config.ios.associatedDomains,
  },
});
