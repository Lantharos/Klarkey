function buildActivitySource(packageName) {
  return `package ${packageName}.credentialprovider

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CreatePasswordResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PasswordCredential
import androidx.credentials.provider.PendingIntentHandler

class KlarkeyCredentialProviderActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    when (intent.getStringExtra("flow")) {
      "fill-password" -> finishPasswordSelection()
      "fill-passkey" -> finishPasskeySelection()
      "save-credential" -> finishCreateSelection()
      else -> {
        openKlarkey(intent.getStringExtra("flow") ?: "choose")
        setResult(RESULT_CANCELED)
        finish()
      }
    }
  }

  private fun finishPasswordSelection() {
    if (!KlarkeyCredentialStore.isUnlocked(this)) {
      openKlarkey("unlock")
      setResult(RESULT_CANCELED)
      finish()
      return
    }

    val itemId = intent.getStringExtra("itemId")
    val credential = KlarkeyCredentialStore.loadCredentials(this)
      .firstOrNull { item -> item.id == itemId && item.hasPassword && !item.password.isNullOrEmpty() }

    if (credential?.password == null) {
      setResult(RESULT_CANCELED)
      finish()
      return
    }

    val result = Intent()
    PendingIntentHandler.setGetCredentialResponse(
      result,
      GetCredentialResponse(PasswordCredential(credential.username, credential.password))
    )
    setResult(RESULT_OK, result)
    finish()
  }

  private fun finishPasskeySelection() {
    if (!KlarkeyCredentialStore.isUnlocked(this)) {
      openKlarkey("unlock")
      setResult(RESULT_CANCELED)
      finish()
      return
    }

    val passkey = KlarkeyCredentialStore.passkeyById(this, intent.getStringExtra("itemId"))
    val providerRequest = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
    val option = providerRequest?.credentialOptions?.filterIsInstance<GetPublicKeyCredentialOption>()?.firstOrNull()
    if (passkey == null || option == null) {
      setResult(RESULT_CANCELED)
      finish()
      return
    }

    val credential = KlarkeyPasskeys.getAssertion(option, passkey)
    if (credential == null) {
      setResult(RESULT_CANCELED)
      finish()
      return
    }

    KlarkeyCredentialStore.savePasskey(this, passkey.copy(signCount = passkey.signCount + 1))
    val result = Intent()
    PendingIntentHandler.setGetCredentialResponse(result, GetCredentialResponse(credential))
    setResult(RESULT_OK, result)
    finish()
  }

  private fun finishCreateSelection() {
    if (!KlarkeyCredentialStore.isUnlocked(this)) {
      openKlarkey("unlock")
      setResult(RESULT_CANCELED)
      finish()
      return
    }

    val providerRequest = PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent)
    when (val request = providerRequest?.callingRequest) {
      is CreatePasswordRequest -> finishCreatePassword(request)
      is CreatePublicKeyCredentialRequest -> finishCreatePasskey(request)
      else -> {
        openKlarkey("save")
        setResult(RESULT_CANCELED)
        finish()
      }
    }
  }

  private fun finishCreatePassword(request: CreatePasswordRequest) {
    KlarkeyCredentialStore.savePasswordCredential(this, request.id, request.password, request.origin)
    val result = Intent()
    PendingIntentHandler.setCreateCredentialResponse(result, CreatePasswordResponse())
    setResult(RESULT_OK, result)
    finish()
  }

  private fun finishCreatePasskey(request: CreatePublicKeyCredentialRequest) {
    val response = KlarkeyPasskeys.createRegistration(this, request)
    if (response == null) {
      setResult(RESULT_CANCELED)
      finish()
      return
    }

    val result = Intent()
    PendingIntentHandler.setCreateCredentialResponse(result, response)
    setResult(RESULT_OK, result)
    finish()
  }

  private fun openKlarkey(flow: String) {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launchIntent.action = "com.lantharos.klarkey.CREDENTIAL_PROVIDER"
    launchIntent.putExtra("flow", flow)
    intent.getStringExtra("itemId")?.let { itemId -> launchIntent.putExtra("itemId", itemId) }
    intent.getStringExtra("credentialType")?.let { type -> launchIntent.putExtra("credentialType", type) }
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    startActivity(launchIntent)
  }
}
`;
}

module.exports = { buildActivitySource };
