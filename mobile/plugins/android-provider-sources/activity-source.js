function buildActivitySource(packageName) {
  return `package ${packageName}.credentialprovider

import android.app.Activity
import android.app.assist.AssistStructure
import android.content.Intent
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.service.autofill.Dataset
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CreatePasswordResponse
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PasswordCredential
import androidx.credentials.provider.PendingIntentHandler
import ${packageName}.R

class KlarkeyCredentialProviderActivity : Activity() {
  private val unlockWindowMs = 5 * 60 * 1000L

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
      authenticateThen { finishPasswordSelection() }
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

    val structure = autofillStructure()
    if (structure != null) {
      finishAutofillPasswordSelection(credential)
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
      authenticateThen { finishPasskeySelection() }
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
      authenticateThen { finishCreateSelection() }
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

  private fun finishAutofillPasswordSelection(credential: ProviderCredential) {
    val structure = autofillStructure()
    if (structure == null || credential.password == null) {
      finishCanceled()
      return
    }

    val targets = ActivityAutofillTargets()
    for (index in 0 until structure.windowNodeCount) {
      collectTargets(structure.getWindowNodeAt(index).rootViewNode, targets)
    }

    val dataset = Dataset.Builder(presentation(credential.title, credential.username))
    var hasValue = false
    targets.username?.let { id ->
      dataset.setValue(id, AutofillValue.forText(credential.username), presentation(credential.title, credential.username))
      hasValue = true
    }
    targets.password?.let { id ->
      dataset.setValue(id, AutofillValue.forText(credential.password), presentation(credential.title, credential.username))
      hasValue = true
    }

    if (!hasValue) {
      finishCanceled()
      return
    }

    val result = Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset.build())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      result.putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT_EPHEMERAL_DATASET, true)
    }
    setResult(RESULT_OK, result)
    finish()
  }

  private fun authenticateThen(onUnlocked: () -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
      openKlarkey("unlock")
      finishCanceled()
      return
    }

    val builder = BiometricPrompt.Builder(this)
      .setTitle("Unlock Klarkey")
      .setSubtitle("Confirm to fill this login")

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.setAllowedAuthenticators(
        BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
      )
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      builder.setDeviceCredentialAllowed(true)
    } else {
      builder.setNegativeButton("Cancel", mainExecutor) { _, _ -> finishCanceled() }
    }

    builder.build().authenticate(
      CancellationSignal(),
      mainExecutor,
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          KlarkeyCredentialStore.unlock(this@KlarkeyCredentialProviderActivity, System.currentTimeMillis() + unlockWindowMs)
          onUnlocked()
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          finishCanceled()
        }
      }
    )
  }

  private fun presentation(title: String, subtitle: String): RemoteViews {
    return RemoteViews(packageName, R.layout.klarkey_autofill_suggestion).apply {
      setImageViewResource(R.id.klarkey_autofill_icon, applicationInfo.icon)
      setTextViewText(R.id.klarkey_autofill_title, title)
      setTextViewText(R.id.klarkey_autofill_subtitle, subtitle)
    }
  }

  private fun collectTargets(node: AssistStructure.ViewNode, targets: ActivityAutofillTargets) {
    val id = node.autofillId
    if (id != null) {
      when (classify(node)) {
        ActivityFieldKind.Username -> if (targets.username == null) targets.username = id
        ActivityFieldKind.Password -> if (targets.password == null) targets.password = id
        null -> Unit
      }
    }

    for (index in 0 until node.childCount) {
      collectTargets(node.getChildAt(index), targets)
    }
  }

  private fun classify(node: AssistStructure.ViewNode): ActivityFieldKind? {
    val hints = node.autofillHints?.joinToString(" ") ?: ""
    val details = listOfNotNull(
      hints,
      node.hint?.toString(),
      node.idEntry,
      node.className?.toString()
    ).joinToString(" ").lowercase()

    if (details.contains("password")) {
      return ActivityFieldKind.Password
    }

    return when {
      details.contains("username") -> ActivityFieldKind.Username
      details.contains("email") -> ActivityFieldKind.Username
      details.contains("login") -> ActivityFieldKind.Username
      details.contains("user") -> ActivityFieldKind.Username
      else -> null
    }
  }

  private fun autofillStructure(): AssistStructure? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE, AssistStructure::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE)
    }
  }

  private fun finishCanceled() {
    setResult(RESULT_CANCELED)
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

private enum class ActivityFieldKind {
  Username,
  Password
}

private data class ActivityAutofillTargets(
  var username: AutofillId? = null,
  var password: AutofillId? = null
)
`;
}

module.exports = { buildActivitySource };
