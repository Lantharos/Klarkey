import { Globe } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { KeyHint, ReturnHint, ShortcutHint } from '@/app/palette'
import type { ItemFormValues } from '@/app/palette-types'
import { TotpField } from '@/app/totp-field'
import { randomId } from '@/shared/random-id'
import type { ActionExecutionResult, TotpDetails } from '@/shared/types'

const newCustomField = () => ({
  id: randomId('field'),
  label: '',
  value: '',
})

function FieldShell({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={`block border-b border-white/6 px-5 py-3 ${className ?? ''}`}>
      <div className="mb-2 text-[13px] text-white/42">{label}</div>
      {children}
    </label>
  )
}

function TextField({
  value,
  onChange,
  placeholder,
  autoFocus,
  onKeyDown,
  masked,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoFocus?: boolean
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
  masked?: boolean
}) {
  const [focused, setFocused] = useState(Boolean(autoFocus))

  return (
    <input
      type={masked && !focused ? 'password' : 'text'}
      autoFocus={autoFocus}
      data-nav-input="true"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      className="w-full bg-transparent text-[16px] text-white outline-none placeholder:text-white/24"
    />
  )
}

export function ItemFormPage({
  mode,
  initialValue,
  existingOtp,
  execution,
  loading,
  onAutoSave,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  initialValue: ItemFormValues
  existingOtp?: TotpDetails
  execution?: ActionExecutionResult
  loading: boolean
  onAutoSave?: (value: ItemFormValues) => Promise<ActionExecutionResult | undefined>
  onSubmit: (value: ItemFormValues) => void
}) {
  const [value, setValue] = useState<ItemFormValues>(initialValue)
  const formRef = useRef<HTMLFormElement>(null)
  const focusTargetRef = useRef<string | undefined>(undefined)
  const saveTimeoutRef = useRef<number | undefined>(undefined)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const baselineRef = useRef(JSON.stringify(initialValue))
  const submitCurrentValue = () => onSubmit(value)

  useEffect(() => {
    if (!focusTargetRef.current) {
      return
    }

    const node = formRef.current?.querySelector<HTMLElement>(`[data-focus-key="${focusTargetRef.current}"]`)
    node?.focus()
    focusTargetRef.current = undefined
  }, [value])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const scheduleAutoSave = (nextValue: ItemFormValues) => {
    if (mode !== 'edit' || loading || !onAutoSave) {
      return
    }

    const serialized = JSON.stringify(nextValue)
    if (serialized === baselineRef.current) {
      return
    }

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current)
    }

    setSaveState('saving')
    saveTimeoutRef.current = window.setTimeout(() => {
      void onAutoSave(nextValue).then((result) => {
        if (result?.status === 'error') {
          setSaveState('error')
          return
        }

        baselineRef.current = serialized
        setSaveState('saved')
      })
    }, 180)
  }

  const updateValue = (updater: (current: ItemFormValues) => ItemFormValues) => {
    setValue((current) => {
      const nextValue = updater(current)
      scheduleAutoSave(nextValue)
      return nextValue
    })
  }

  const moveFieldFocus = (direction: 1 | -1, current: HTMLElement) => {
    const nodes = formRef.current?.querySelectorAll<HTMLElement>('[data-nav-input="true"]')
    if (!nodes?.length) {
      return
    }

    const all = Array.from(nodes)
    const index = all.indexOf(current)
    if (index === -1) {
      return
    }

    const next = all[index + direction]
    next?.focus()
  }

  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && event.currentTarget instanceof HTMLInputElement) {
      const websiteIndex = event.currentTarget.dataset.websiteIndex
      const customFieldIndex = event.currentTarget.dataset.customFieldIndex
      const customFieldSide = event.currentTarget.dataset.customFieldSide

      if (websiteIndex !== undefined) {
        event.preventDefault()
        const nextIndex = value.websites.length
        focusTargetRef.current = `website-${nextIndex}`
        updateValue((current) => ({
          ...current,
          websites: [...current.websites, ''],
        }))
        return
      }

      if (customFieldIndex !== undefined && customFieldSide) {
        event.preventDefault()
        const nextIndex = value.customFields.length
        focusTargetRef.current = `custom-${nextIndex}-${customFieldSide}`
        updateValue((current) => ({
          ...current,
          customFields: [...current.customFields, newCustomField()],
        }))
        return
      }
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    if (event.currentTarget instanceof HTMLTextAreaElement) {
      const { selectionStart, selectionEnd, value: text } = event.currentTarget
      const before = text.slice(0, selectionStart)
      const after = text.slice(selectionEnd)

      if (selectionStart !== selectionEnd) {
        return
      }

      if (event.key === 'ArrowUp' && before.includes('\n')) {
        return
      }

      if (event.key === 'ArrowDown' && after.includes('\n')) {
        return
      }
    }

    event.preventDefault()
    moveFieldFocus(event.key === 'ArrowDown' ? 1 : -1, event.currentTarget)
  }

  const showWebsites = value.itemType === 'login'
  const showCustomFields = value.itemType !== 'note' && value.itemType !== 'ssh-key'
  const showNotes = value.itemType !== 'note' && value.itemType !== 'ssh-key'
  type IdentityFieldKey =
    | 'username'
    | 'firstName'
    | 'middleName'
    | 'lastName'
    | 'company'
    | 'jobTitle'
    | 'birthDate'
    | 'email'
    | 'phone'
    | 'addressLine1'
    | 'addressLine2'
    | 'city'
    | 'state'
    | 'postalCode'
    | 'country'
  const identityFields: Array<{
    key: IdentityFieldKey
    label: string
    placeholder: string
  }> = [
    { key: 'username', label: 'Username', placeholder: 'alexmorgan' },
    { key: 'firstName', label: 'First name', placeholder: 'Alex' },
    { key: 'middleName', label: 'Middle name', placeholder: 'Jamie' },
    { key: 'lastName', label: 'Last name', placeholder: 'Morgan' },
    { key: 'company', label: 'Company', placeholder: 'OpenAI' },
    { key: 'jobTitle', label: 'Job title', placeholder: 'Product designer' },
    { key: 'birthDate', label: 'Birthday', placeholder: '1995-04-12' },
    { key: 'email', label: 'Email', placeholder: 'alex@example.com' },
    { key: 'phone', label: 'Phone', placeholder: '+49 151 12345678' },
    { key: 'addressLine1', label: 'Address line 1', placeholder: 'Street address' },
    { key: 'addressLine2', label: 'Address line 2', placeholder: 'Apartment, suite, floor' },
    { key: 'city', label: 'City', placeholder: 'Berlin' },
    { key: 'state', label: 'State / region', placeholder: 'Berlin' },
    { key: 'postalCode', label: 'Postal code', placeholder: '10115' },
    { key: 'country', label: 'Country', placeholder: 'Germany' },
  ]
  type CardFieldKey =
    | 'cardholderName'
    | 'cardNumber'
    | 'cardExpiry'
    | 'cardExpiryMonth'
    | 'cardExpiryYear'
    | 'cardCvc'
    | 'cardBrand'
    | 'billingPostalCode'
  const cardFields: Array<{
    key: CardFieldKey
    label: string
    placeholder: string
    masked?: boolean
  }> = [
    { key: 'cardholderName', label: 'Name on card', placeholder: 'Alex Morgan' },
    { key: 'cardNumber', label: 'Card number', placeholder: '4242 4242 4242 4242' },
    { key: 'cardExpiry', label: 'Expiry', placeholder: '04/29' },
    { key: 'cardExpiryMonth', label: 'Expiry month', placeholder: '04' },
    { key: 'cardExpiryYear', label: 'Expiry year', placeholder: '2029' },
    { key: 'cardCvc', label: 'Security code', placeholder: '123', masked: true },
    { key: 'cardBrand', label: 'Network', placeholder: 'Visa' },
    { key: 'billingPostalCode', label: 'Billing postal code', placeholder: '10115' },
  ]

  return (
    <form
      ref={formRef}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (mode === 'create' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          submitCurrentValue()
        }
      }}
      onSubmit={(event) => {
        event.preventDefault()
        submitCurrentValue()
      }}
    >
      <div className={value.itemType === 'note' ? 'flex min-h-0 flex-1 flex-col' : 'min-h-0 flex-1 overflow-y-auto'}>
        <FieldShell label={value.itemType === 'note' ? 'Title' : 'Name'}>
          <TextField
            autoFocus
            value={value.itemName}
            onChange={(itemName) => updateValue((current) => ({ ...current, itemName }))}
            onKeyDown={onFieldKeyDown}
            placeholder={
              value.itemType === 'note'
                ? 'Meeting follow-up'
                : value.itemType === 'identity'
                  ? 'Personal identity'
                  : value.itemType === 'card'
                    ? 'Payment card'
                    : value.itemType === 'ssh-key'
                      ? 'GitHub signing key'
                    : 'Netflix'
            }
          />
        </FieldShell>

        {value.itemType === 'login' ? (
          <>
            {value.ssoProvider ? (
              <FieldShell label="Sign in with">
                <TextField
                  value={value.ssoProvider}
                  onChange={(ssoProvider) => updateValue((current) => ({ ...current, ssoProvider }))}
                  onKeyDown={onFieldKeyDown}
                  placeholder="Google, GitHub, Apple..."
                />
              </FieldShell>
            ) : null}
            <FieldShell label={value.ssoProvider ? 'Account' : 'Username'}>
              <TextField
                value={value.username}
                onChange={(username) => updateValue((current) => ({ ...current, username }))}
                onKeyDown={onFieldKeyDown}
                placeholder={value.ssoProvider ? 'me@example.com' : 'me@example.com'}
              />
            </FieldShell>
            <FieldShell label="Password">
              <TextField
                masked
                value={value.password}
                onChange={(password) => updateValue((current) => ({ ...current, password }))}
                onKeyDown={onFieldKeyDown}
                placeholder={mode === 'create' ? 'Leave blank to generate one' : 'Password'}
              />
            </FieldShell>
            <FieldShell label="Authenticator">
              <TotpField
                value={value.otp}
                onChange={(otp) => updateValue((current) => ({ ...current, otp }))}
                onKeyDown={onFieldKeyDown}
                existingOtp={existingOtp}
              />
            </FieldShell>
          </>
        ) : null}

        {value.itemType === 'identity' ? (
          <>
            {identityFields.map((field) => (
              <FieldShell key={field.key} label={field.label}>
                <TextField
                  value={value[field.key]}
                  onChange={(nextValue) => updateValue((current) => ({ ...current, [field.key]: nextValue }))}
                  onKeyDown={onFieldKeyDown}
                  placeholder={field.placeholder}
                />
              </FieldShell>
            ))}
          </>
        ) : null}

        {value.itemType === 'card' ? (
          <>
            {cardFields.map((field) => (
              <FieldShell key={field.key} label={field.label}>
                <TextField
                  masked={field.masked}
                  value={value[field.key]}
                  onChange={(nextValue) => updateValue((current) => ({ ...current, [field.key]: nextValue }))}
                  onKeyDown={onFieldKeyDown}
                  placeholder={field.placeholder}
                />
              </FieldShell>
            ))}
          </>
        ) : null}

        {value.itemType === 'ssh-key' ? (
          <>
            <FieldShell label="Private key">
              <textarea
                data-nav-input="true"
                value={value.sshPrivateKey}
                onChange={(event) => updateValue((current) => ({ ...current, sshPrivateKey: event.target.value }))}
                onKeyDown={onFieldKeyDown}
                placeholder={mode === 'create' ? 'Leave blank to generate a new Ed25519 key, or paste an existing private key.' : 'Paste a replacement private key to rotate this item.'}
                className="min-h-[120px] w-full resize-y bg-transparent text-[15px] text-white outline-none placeholder:text-white/24"
              />
            </FieldShell>
            {mode === 'edit' || value.sshPublicKey.trim() ? (
              <FieldShell label="Public key">
                <textarea
                  data-nav-input="true"
                  value={value.sshPublicKey}
                  onKeyDown={onFieldKeyDown}
                  placeholder="Public key is derived automatically when a private key is saved."
                  className="min-h-[84px] w-full resize-y bg-transparent text-[15px] text-white outline-none placeholder:text-white/24"
                  readOnly
                />
              </FieldShell>
            ) : null}
            <FieldShell label="Key comment">
              <TextField
                value={value.sshComment}
                onChange={(sshComment) => updateValue((current) => ({ ...current, sshComment }))}
                onKeyDown={onFieldKeyDown}
                placeholder="me@github"
              />
            </FieldShell>
          </>
        ) : null}

        {value.itemType === 'note' ? (
          <FieldShell label="Note" className="flex min-h-0 flex-1 flex-col border-b-0">
            <textarea
              data-nav-input="true"
              value={value.content}
              onChange={(event) => updateValue((current) => ({ ...current, content: event.target.value }))}
              onKeyDown={onFieldKeyDown}
              placeholder="Write anything you want to keep close."
              className="min-h-0 flex-1 w-full resize-none bg-transparent text-[15px] text-white outline-none placeholder:text-white/24"
            />
          </FieldShell>
        ) : null}

        {showWebsites ? (
          <div className="border-b border-white/6 px-5 py-3">
            <div className="mb-2 text-[13px] text-white/42">Websites</div>
            <div className="space-y-2">
              {value.websites.map((website, index) => (
                <div key={`website_${index}`} className="flex items-center gap-2 rounded-[10px] bg-white/4 px-3 py-2.5">
                  <Globe size={15} className="shrink-0 text-white/32" />
                  <input
                    data-nav-input="true"
                    data-focus-key={`website-${index}`}
                    data-website-index={index}
                    value={website}
                    onChange={(event) => {
                      updateValue((current) => {
                        const websites = [...current.websites]
                        websites[index] = event.target.value
                        return { ...current, websites }
                      })
                    }}
                    onKeyDown={onFieldKeyDown}
                    placeholder="https://example.com"
                    className="w-full bg-transparent text-[15px] text-white outline-none placeholder:text-white/24"
                  />
                  {value.websites.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        updateValue((current) => ({
                          ...current,
                          websites: current.websites.filter((_, websiteIndex) => websiteIndex !== index),
                        }))
                      }
                      className="text-[13px] text-white/34 transition hover:text-white/62"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showCustomFields ? (
          <div className="border-b border-white/6 px-5 py-3">
            <div className="mb-2 text-[13px] text-white/42">Fields</div>
            <div className="space-y-2">
              {value.customFields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)_auto] gap-2 rounded-[10px] bg-white/4 px-3 py-2.5"
                >
                  <input
                    data-nav-input="true"
                    data-focus-key={`custom-${index}-label`}
                    data-custom-field-index={index}
                    data-custom-field-side="label"
                    value={field.label}
                    onChange={(event) => {
                      updateValue((current) => {
                        const customFields = [...current.customFields]
                        customFields[index] = { ...customFields[index], label: event.target.value }
                        return { ...current, customFields }
                      })
                    }}
                    onKeyDown={onFieldKeyDown}
                    placeholder="Field"
                    className="bg-transparent text-[15px] text-white outline-none placeholder:text-white/24"
                  />
                  <input
                    data-nav-input="true"
                    data-focus-key={`custom-${index}-value`}
                    data-custom-field-index={index}
                    data-custom-field-side="value"
                    value={field.value}
                    onChange={(event) => {
                      updateValue((current) => {
                        const customFields = [...current.customFields]
                        customFields[index] = { ...customFields[index], value: event.target.value }
                        return { ...current, customFields }
                      })
                    }}
                    onKeyDown={onFieldKeyDown}
                    placeholder="Value"
                    className="bg-transparent text-[15px] text-white outline-none placeholder:text-white/24"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateValue((current) => ({
                        ...current,
                        customFields:
                          current.customFields.length === 1
                            ? [newCustomField()]
                            : current.customFields.filter((candidate) => candidate.id !== field.id),
                      }))
                    }
                    className="text-[13px] text-white/34 transition hover:text-white/62"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showNotes ? (
          <FieldShell label="Notes">
            <textarea
              data-nav-input="true"
              value={value.notes}
              onChange={(event) => updateValue((current) => ({ ...current, notes: event.target.value }))}
              onKeyDown={onFieldKeyDown}
              placeholder="Notes"
              className="min-h-[88px] w-full resize-none bg-transparent text-[15px] text-white outline-none placeholder:text-white/24"
            />
          </FieldShell>
        ) : null}
      </div>
      <div className="h-px bg-white/8" />
      <div className="flex items-center justify-between gap-4 px-5 py-3 text-[14px] text-white/42">
        <span className={execution?.status === 'error' ? 'text-red-300/85' : undefined}>
          {loading
            ? 'Loading item...'
            : execution?.status === 'error'
              ? execution.message
              : mode === 'edit'
                ? saveState === 'saving'
                  ? 'Saving...'
                  : saveState === 'saved'
                    ? 'Saved.'
                    : saveState === 'error'
                      ? 'Could not save.'
                      : 'Saved automatically.'
                : execution?.message ?? 'Press Ctrl + Return to create.'}
        </span>
        <div className="flex items-center gap-2">
          <KeyHint>Esc</KeyHint>
          {mode === 'create' ? (
            <ShortcutHint>
              <span>Ctrl</span>
              <span>+</span>
              <ReturnHint embedded />
            </ShortcutHint>
          ) : null}
        </div>
      </div>
    </form>
  )
}
