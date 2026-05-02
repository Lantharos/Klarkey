function buildServiceSource(packageName) {
  return `package ${packageName}.credentialprovider

import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.provider.Action
import androidx.credentials.provider.AuthenticationAction
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginGetCredentialOption
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.CreateEntry
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.PasswordCredentialEntry
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import androidx.credentials.provider.PublicKeyCredentialEntry

@RequiresApi(34)
class KlarkeyCredentialProviderService : CredentialProviderService() {
  override fun onBeginGetCredentialRequest(
    request: BeginGetCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>
  ) {
    val builder = BeginGetCredentialResponse.Builder()
    val unlocked = KlarkeyCredentialStore.isUnlocked(this)
    val entries = KlarkeyCredentialStore.loadCredentials(this)
    val passkeys = KlarkeyCredentialStore.loadPasskeys(this)
    val addedEntries = request.beginGetCredentialOptions
      .map { option -> addEntriesForOption(builder, option, entries, passkeys) }
      .any { added -> added }

    if (!unlocked) {
      builder.addAuthenticationAction(AuthenticationAction.Builder("Unlock Klarkey", providerIntent("unlock")).build())
    }

    builder.addAction(
      Action.Builder("Open Klarkey", providerIntent("choose"))
        .setSubtitle("Choose a login, passkey, or one-time code")
        .build()
    )

    if (!addedEntries) {
      builder.addAction(
        Action.Builder("Save in Klarkey", providerIntent("save"))
          .setSubtitle("Open Klarkey to save this credential")
          .build()
      )
    }

    callback.onResult(builder.build())
  }

  override fun onBeginCreateCredentialRequest(
    request: BeginCreateCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>
  ) {
    val entry = CreateEntry(
      "Klarkey vault",
      providerIntent("save-credential"),
      "Save passwords and passkeys in Klarkey",
      null,
      null,
      0,
      0,
      0,
      false
    )

    callback.onResult(BeginCreateCredentialResponse.Builder().addCreateEntry(entry).build())
  }

  override fun onClearCredentialStateRequest(
    request: ProviderClearCredentialStateRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<Void?, ClearCredentialException>
  ) {
    KlarkeyCredentialStore.lock(this)
    callback.onResult(null)
  }

  private fun addEntriesForOption(
    builder: BeginGetCredentialResponse.Builder,
    option: BeginGetCredentialOption,
    entries: List<ProviderCredential>,
    passkeys: List<ProviderPasskey>
  ): Boolean {
    var added = false

    when (option) {
      is BeginGetPasswordOption -> {
        entries.filter { item -> item.hasPassword && !item.password.isNullOrEmpty() }.forEach { item ->
          builder.addCredentialEntry(
            PasswordCredentialEntry(
              context = this,
              username = item.username,
              pendingIntent = providerIntent("fill-password", item.id, "password"),
              beginGetPasswordOption = option,
              displayName = item.title,
              lastUsedTime = item.lastUsedTime,
              icon = providerIcon(),
              isAutoSelectAllowed = false,
              affiliatedDomain = item.domain,
              isDefaultIconPreferredAsSingleProvider = false
            )
          )
          added = true
        }
      }

      is BeginGetPublicKeyCredentialOption -> {
        val rpId = KlarkeyPasskeys.rpIdFromRequestJson(option.requestJson) ?: return false
        passkeys.filter { item -> item.rpId == rpId }.forEach { item ->
          builder.addCredentialEntry(
            PublicKeyCredentialEntry(
              context = this,
              username = item.username,
              pendingIntent = providerIntent("fill-passkey", item.id, "passkey"),
              beginGetPublicKeyCredentialOption = option,
              displayName = item.username,
              lastUsedTime = item.lastUsedTime,
              icon = providerIcon(),
              isAutoSelectAllowed = false,
              isDefaultIconPreferredAsSingleProvider = false
            )
          )
          added = true
        }
      }
    }

    return added
  }

  private fun providerIcon(): Icon {
    return Icon.createWithResource(this, applicationInfo.icon)
  }

  private fun providerIntent(flow: String, itemId: String? = null, credentialType: String? = null): PendingIntent {
    val intent = Intent(this, KlarkeyCredentialProviderActivity::class.java)
    intent.putExtra("flow", flow)
    itemId?.let { intent.putExtra("itemId", it) }
    credentialType?.let { intent.putExtra("credentialType", it) }

    return PendingIntent.getActivity(
      this,
      (flow + ":" + itemId + ":" + credentialType).hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
    )
  }
}
`;
}

module.exports = { buildServiceSource };
