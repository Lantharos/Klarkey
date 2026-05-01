function buildAutofillSource(packageName) {
  return `package ${packageName}.credentialprovider

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.os.Build
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.Field
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.Presentations
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews

class KlarkeyAutofillService : AutofillService() {
  override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback
  ) {
    val structure = request.fillContexts.lastOrNull()?.structure
    if (structure == null || !KlarkeyCredentialStore.isUnlocked(this)) {
      callback.onSuccess(null)
      return
    }

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
      .filter { item -> item.hasPassword && !item.password.isNullOrEmpty() }

    if (credentials.isEmpty() && saveInfo == null) {
      callback.onSuccess(null)
      return
    }

    val response = FillResponse.Builder()
    credentials.forEach { credential ->
      val dataset = datasetBuilder(credential.title)
      targets.username?.let { id ->
        setTextValue(dataset, id, credential.username, credential.username)
      }
      targets.password?.let { id ->
        credential.password?.let { password ->
          setTextValue(dataset, id, password, "Password for " + credential.username)
        }
      }
      response.addDataset(dataset.build())
    }
    saveInfo?.let { response.setSaveInfo(it) }

    callback.onSuccess(response.build())
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    val structure = request.fillContexts.lastOrNull()?.structure
    if (structure == null) {
      callback.onFailure("Klarkey could not read the login form.")
      return
    }

    val values = AutofillLoginValues()
    for (index in 0 until structure.windowNodeCount) {
      collectValues(structure.getWindowNodeAt(index).rootViewNode, values)
    }

    val username = values.username
    val password = values.password
    if (username.isNullOrBlank() || password.isNullOrBlank()) {
      callback.onFailure("Klarkey could not find a username and password to save.")
      return
    }

    KlarkeyCredentialStore.savePasswordCredential(this, username, password, structure.activityComponent?.packageName)
    callback.onSuccess()
  }

  private fun collectTargets(node: AssistStructure.ViewNode, targets: AutofillTargets) {
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
    val value = node.autofillValue?.textValue?.toString()?.trim()
    if (!value.isNullOrBlank()) {
      when (classify(node)) {
        FieldKind.Username -> if (values.username == null) values.username = value
        FieldKind.Password -> if (values.password == null) values.password = value
        null -> Unit
      }
    }

    for (index in 0 until node.childCount) {
      collectValues(node.getChildAt(index), values)
    }
  }

  private fun classify(node: AssistStructure.ViewNode): FieldKind? {
    val hints = node.autofillHints?.joinToString(" ") ?: ""
    val details = listOfNotNull(
      hints,
      node.hint?.toString(),
      node.idEntry,
      node.className?.toString()
    ).joinToString(" ").lowercase()

    if (details.contains("password")) {
      return FieldKind.Password
    }

    return when {
      details.contains("username") -> FieldKind.Username
      details.contains("email") -> FieldKind.Username
      details.contains("login") -> FieldKind.Username
      details.contains("user") -> FieldKind.Username
      else -> null
    }
  }

  private fun presentation(label: String): RemoteViews {
    return RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
      setTextViewText(android.R.id.text1, label)
    }
  }

  private fun presentations(label: String): Presentations {
    val remoteViews = presentation(label)
    return Presentations.Builder()
      .setMenuPresentation(remoteViews)
      .setDialogPresentation(remoteViews)
      .build()
  }

  private fun datasetBuilder(label: String): Dataset.Builder {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      return Dataset.Builder(presentations(label))
    }

    return legacyDatasetBuilder(label)
  }

  private fun setTextValue(dataset: Dataset.Builder, id: AutofillId, value: String, label: String) {
    val autofillValue = AutofillValue.forText(value)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      dataset.setField(
        id,
        Field.Builder()
          .setValue(autofillValue)
          .setPresentations(presentations(label))
          .build()
      )
      return
    }

    legacySetTextValue(dataset, id, autofillValue, label)
  }

  @Suppress("DEPRECATION")
  private fun legacyDatasetBuilder(label: String): Dataset.Builder {
    return Dataset.Builder(presentation(label))
  }

  @Suppress("DEPRECATION")
  private fun legacySetTextValue(dataset: Dataset.Builder, id: AutofillId, value: AutofillValue, label: String) {
    dataset.setValue(id, value, presentation(label))
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
}

private enum class FieldKind {
  Username,
  Password
}

private data class AutofillTargets(
  var username: AutofillId? = null,
  var password: AutofillId? = null
) {
  fun hasFillTarget(): Boolean {
    return username != null || password != null
  }
}

private data class AutofillLoginValues(
  var username: String? = null,
  var password: String? = null
)
`;
}

module.exports = { buildAutofillSource };
