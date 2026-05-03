function buildAutofillSource(packageName) {
  return `package ${packageName}.credentialprovider

import android.app.assist.AssistStructure
import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.CancellationSignal
import android.os.Build
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.Field
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.InlinePresentation
import android.service.autofill.Presentations
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.view.inputmethod.InlineSuggestionsRequest
import android.widget.RemoteViews
import android.widget.inline.InlinePresentationSpec
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi
import ${packageName}.R

class KlarkeyAutofillService : AutofillService() {
  override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback
  ) {
    val structure = request.fillContexts.lastOrNull()?.structure
    if (structure == null) {
      callback.onSuccess(null)
      return
    }
    val isUnlocked = KlarkeyCredentialStore.isUnlocked(this)

    val targets = AutofillTargets()
    for (index in 0 until structure.windowNodeCount) {
      collectTargets(structure.getWindowNodeAt(index).rootViewNode, targets)
    }

    if (!targets.hasFillTarget()) {
      callback.onSuccess(null)
      return
    }

    val saveInfo = saveInfo(targets)
    val credentials = KlarkeyCredentialStore.loadCredentials(this)
      .filter { item -> item.hasPassword && item.username.isNotBlank() }
      .filter { item -> credentialMatchesTarget(item, targets, structure.activityComponent?.packageName) }
    val inlineRequest = inlineRequest(request)
    val responseCredentials = inlineRequest?.limit(credentials) ?: credentials

    if (credentials.isEmpty() && saveInfo == null) {
      callback.onSuccess(null)
      return
    }

    val response = FillResponse.Builder()
    responseCredentials.forEachIndexed { index, credential ->
      val inlineSpec = inlineRequest?.specAt(index)
      val dataset = datasetBuilder(credential.title, credential.username, inlineSpec)
      if (isUnlocked) {
        targets.username?.let { id ->
          setTextValue(dataset, id, credential.username, credential.title, credential.username, inlineSpec)
        }
        targets.password?.let { id ->
          credential.password?.let { password ->
            setTextValue(dataset, id, password, credential.title, credential.username, inlineSpec)
          }
        }
      } else {
        dataset.setAuthentication(providerIntent("fill-password", credential.id, "password"))
        targets.username?.let { id ->
          setLockedValue(dataset, id, credential.title, credential.username, inlineSpec)
        }
        targets.password?.let { id ->
          setLockedValue(dataset, id, credential.title, credential.username, inlineSpec)
        }
      }
      response.addDataset(dataset.build())
    }
    saveInfo?.let { response.setSaveInfo(it) }

    callback.onSuccess(response.build())
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    val values = AutofillLoginValues()
    var appPackage: String? = null
    var sawStructure = false

    request.fillContexts.forEach { context ->
      val structure = context.structure
      sawStructure = true
      appPackage = appPackage ?: structure.activityComponent?.packageName
      for (index in 0 until structure.windowNodeCount) {
        collectValues(structure.getWindowNodeAt(index).rootViewNode, values)
      }
    }

    if (!sawStructure) {
      callback.onFailure("Klarkey could not read the login form.")
      return
    }

    val username = values.username ?: values.fallbackUsername ?: values.webDomain ?: appPackage ?: "Saved login"
    val password = values.password
    if (password.isNullOrBlank()) {
      callback.onFailure("Klarkey could not find a password to save.")
      return
    }

    KlarkeyCredentialStore.savePasswordCredential(this, username, password, values.webDomain ?: appPackage)
    callback.onSuccess()
  }

  private fun collectTargets(node: AssistStructure.ViewNode, targets: AutofillTargets) {
    targets.webDomain = targets.webDomain ?: normalizeHost(node.webDomain)

    val id = node.autofillId
    if (id != null) {
      when (classify(node)) {
        FieldKind.Username -> if (targets.username == null) targets.username = id
        FieldKind.Password -> if (targets.password == null) targets.password = id
        null -> Unit
      }
    }

    for (index in 0 until node.childCount) {
      collectTargets(node.getChildAt(index), targets)
    }
  }

  private fun collectValues(node: AssistStructure.ViewNode, values: AutofillLoginValues) {
    values.webDomain = values.webDomain ?: normalizeHost(node.webDomain)

    val value = nodeValue(node)
    if (!value.isNullOrBlank()) {
      when (classify(node)) {
        FieldKind.Username -> if (values.username == null) values.username = value
        FieldKind.Password -> if (values.password == null) values.password = value
        null -> if (values.fallbackUsername == null && canUseAsFallbackUsername(node, value)) values.fallbackUsername = value
      }
    }

    for (index in 0 until node.childCount) {
      collectValues(node.getChildAt(index), values)
    }
  }

  private fun classify(node: AssistStructure.ViewNode): FieldKind? {
    val details = fieldDetails(node)

    if (isPasswordInput(node) || details.contains("password") || details.contains("current-password") || details.contains("new-password")) {
      return FieldKind.Password
    }

    return when {
      details.contains("username") -> FieldKind.Username
      details.contains("email") -> FieldKind.Username
      details.contains("login") -> FieldKind.Username
      details.contains("user") -> FieldKind.Username
      details.contains("account") -> FieldKind.Username
      details.contains("identifier") -> FieldKind.Username
      else -> null
    }
  }

  private fun nodeValue(node: AssistStructure.ViewNode): String? {
    val autofillValue = node.autofillValue
    val autofillText = if (autofillValue?.isText == true) {
      autofillValue.textValue?.toString()
    } else {
      null
    }
    return firstNonBlank(autofillText, node.text?.toString())
  }

  private fun firstNonBlank(vararg values: String?): String? {
    return values
      .mapNotNull { value -> value?.trim() }
      .firstOrNull { value -> value.isNotBlank() }
  }

  private fun fieldDetails(node: AssistStructure.ViewNode): String {
    val hints = node.autofillHints?.joinToString(" ") ?: ""
    val htmlInfo = node.htmlInfo
    val htmlAttributes = htmlInfo?.attributes?.joinToString(" ") { attribute ->
      listOfNotNull(attribute.first, attribute.second).joinToString(" ")
    }

    return listOfNotNull(
      hints,
      node.hint,
      node.idEntry,
      node.idPackage,
      node.idType,
      node.className,
      node.contentDescription?.toString(),
      htmlInfo?.tag,
      htmlAttributes
    ).joinToString(" ").lowercase()
  }

  private fun isPasswordInput(node: AssistStructure.ViewNode): Boolean {
    val variation = node.inputType and InputType.TYPE_MASK_VARIATION
    return variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
      variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
  }

  private fun canUseAsFallbackUsername(node: AssistStructure.ViewNode, value: String): Boolean {
    if (!isTextEntry(node) || isPasswordInput(node) || value.length > 160) {
      return false
    }

    val details = fieldDetails(node)
    return details.contains("input") ||
      details.contains("email") ||
      details.contains("user") ||
      details.contains("login") ||
      value.contains("@")
  }

  private fun isTextEntry(node: AssistStructure.ViewNode): Boolean {
    return node.autofillType == View.AUTOFILL_TYPE_TEXT ||
      node.inputType != 0 ||
      node.htmlInfo?.tag?.equals("input", ignoreCase = true) == true
  }

  private fun presentation(title: String, subtitle: String): RemoteViews {
    return RemoteViews(packageName, R.layout.klarkey_autofill_suggestion).apply {
      setImageViewResource(R.id.klarkey_autofill_icon, applicationInfo.icon)
      setTextViewText(R.id.klarkey_autofill_title, title)
      setTextViewText(R.id.klarkey_autofill_subtitle, subtitle)
    }
  }

  private fun presentations(title: String, subtitle: String, inlineSpec: InlinePresentationSpec?): Presentations {
    val remoteViews = presentation(title, subtitle)
    val builder = Presentations.Builder()
      .setMenuPresentation(remoteViews)
      .setDialogPresentation(remoteViews)
    inlinePresentation(title, subtitle, inlineSpec)?.let { inline ->
      builder.setInlinePresentation(inline)
    }
    return builder.build()
  }

  private fun datasetBuilder(title: String, subtitle: String, inlineSpec: InlinePresentationSpec?): Dataset.Builder {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      return Dataset.Builder(presentations(title, subtitle, inlineSpec))
    }

    return legacyDatasetBuilder(title, subtitle, inlineSpec)
  }

  private fun setTextValue(dataset: Dataset.Builder, id: AutofillId, value: String, title: String, subtitle: String, inlineSpec: InlinePresentationSpec?) {
    val autofillValue = AutofillValue.forText(value)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      dataset.setField(
        id,
        Field.Builder()
          .setValue(autofillValue)
          .setPresentations(presentations(title, subtitle, inlineSpec))
          .build()
      )
      return
    }

    legacySetTextValue(dataset, id, autofillValue, title, subtitle, inlineSpec)
  }

  private fun setLockedValue(dataset: Dataset.Builder, id: AutofillId, title: String, subtitle: String, inlineSpec: InlinePresentationSpec?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      dataset.setField(
        id,
        Field.Builder()
          .setPresentations(presentations(title, subtitle, inlineSpec))
          .build()
      )
      return
    }

    legacySetLockedValue(dataset, id, title, subtitle, inlineSpec)
  }

  @Suppress("DEPRECATION")
  private fun legacyDatasetBuilder(title: String, subtitle: String, inlineSpec: InlinePresentationSpec?): Dataset.Builder {
    val dataset = Dataset.Builder(presentation(title, subtitle))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      inlinePresentation(title, subtitle, inlineSpec)?.let { inline ->
        dataset.setInlinePresentation(inline)
      }
    }
    return dataset
  }

  @Suppress("DEPRECATION")
  private fun legacySetTextValue(dataset: Dataset.Builder, id: AutofillId, value: AutofillValue, title: String, subtitle: String, inlineSpec: InlinePresentationSpec?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      inlinePresentation(title, subtitle, inlineSpec)?.let { inline ->
        dataset.setValue(id, value, presentation(title, subtitle), inline)
        return
      }
    }

    dataset.setValue(id, value, presentation(title, subtitle))
  }

  @Suppress("DEPRECATION")
  private fun legacySetLockedValue(dataset: Dataset.Builder, id: AutofillId, title: String, subtitle: String, inlineSpec: InlinePresentationSpec?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      inlinePresentation(title, subtitle, inlineSpec)?.let { inline ->
        dataset.setValue(id, null, presentation(title, subtitle), inline)
        return
      }
    }

    dataset.setValue(id, null, presentation(title, subtitle))
  }

  private fun inlineRequest(request: FillRequest): AutofillInlineRequest? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      return null
    }

    val requestValue = request.inlineSuggestionsRequest ?: return null
    val specs = requestValue.inlinePresentationSpecs
    if (specs.isEmpty()) {
      return null
    }

    return AutofillInlineRequest(specs, requestValue.maxSuggestionCount)
  }

  private fun inlinePresentation(title: String, subtitle: String, inlineSpec: InlinePresentationSpec?): InlinePresentation? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || inlineSpec == null) {
      return null
    }

    if (!UiVersions.getVersions(inlineSpec.style).contains(UiVersions.INLINE_UI_VERSION_1)) {
      return null
    }

    val content = InlineSuggestionUi.newContentBuilder(providerPendingIntent("choose"))
      .setContentDescription(title)
      .setTitle(title)
      .setSubtitle(subtitle)
      .setStartIcon(Icon.createWithResource(this, applicationInfo.icon))
      .build()

    return InlinePresentation(content.slice, inlineSpec, false)
  }

  private fun providerIntent(flow: String, itemId: String? = null, credentialType: String? = null): android.content.IntentSender {
    return providerPendingIntent(flow, itemId, credentialType).intentSender
  }

  private fun providerPendingIntent(flow: String, itemId: String? = null, credentialType: String? = null): PendingIntent {
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

  private fun saveInfo(targets: AutofillTargets): SaveInfo? {
    val username = targets.username
    val password = targets.password ?: return null
    val type = SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD
    val requiredIds = if (username == null) {
      arrayOf(password)
    } else {
      arrayOf(username, password)
    }

    return SaveInfo.Builder(type, requiredIds).build()
  }

  private fun credentialMatchesTarget(credential: ProviderCredential, targets: AutofillTargets, appPackage: String?): Boolean {
    val targetWebDomain = targets.webDomain
    val credentialDomains = credential.domains.mapNotNull { domain -> normalizeHost(domain) }
    val credentialTitleDomain = normalizeHost(credential.title)

    if (!targetWebDomain.isNullOrBlank()) {
      return credentialDomains.any { domain -> domainsMatch(domain, targetWebDomain) } ||
        domainsMatch(credentialTitleDomain, targetWebDomain)
    }

    val targetPackage = normalizeHost(appPackage)
    return credentialDomains.any { domain -> domainsMatch(domain, targetPackage) }
  }

  private fun domainsMatch(candidate: String?, target: String?): Boolean {
    if (candidate.isNullOrBlank() || target.isNullOrBlank()) {
      return false
    }

    return candidate == target || candidate.endsWith("." + target) || target.endsWith("." + candidate)
  }

  private fun normalizeHost(value: String?): String? {
    val trimmed = value?.trim()?.lowercase()?.removePrefix("https://")?.removePrefix("http://") ?: return null
    val host = trimmed.substringBefore("/").substringBefore(":").removePrefix("www.")
    return host.takeIf { it.isNotBlank() }
  }
}

private enum class FieldKind {
  Username,
  Password
}

private data class AutofillTargets(
  var username: AutofillId? = null,
  var password: AutofillId? = null,
  var webDomain: String? = null
) {
  fun hasFillTarget(): Boolean {
    return username != null || password != null
  }
}

private data class AutofillLoginValues(
  var username: String? = null,
  var password: String? = null,
  var fallbackUsername: String? = null,
  var webDomain: String? = null
)

private data class AutofillInlineRequest(
  val specs: List<InlinePresentationSpec>,
  val maxSuggestionCount: Int
) {
  fun specAt(index: Int): InlinePresentationSpec {
    return specs.getOrNull(index) ?: specs.last()
  }

  fun limit(credentials: List<ProviderCredential>): List<ProviderCredential> {
    if (maxSuggestionCount == InlineSuggestionsRequest.SUGGESTION_COUNT_UNLIMITED) {
      return credentials
    }

    return credentials.take(maxSuggestionCount.coerceAtLeast(1))
  }
}
`;
}

module.exports = { buildAutofillSource };
