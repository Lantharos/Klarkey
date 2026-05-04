type PasskeyBannerChoice<T> = {
  value: T
  title: string
  copy: string
}

export function presentPasskeyBanner<T>(input: {
  promptKey: string
  title: string
  copy: string
  choices: Array<PasskeyBannerChoice<T>>
  dismissLabel?: string
}): Promise<T | undefined>

export function promptPasskeyCreateChoice(input: {
  rpId?: string
  userName?: string
  itemName?: string
  suggestedMatch?: {
    itemId: string
    itemName: string
  }
}): Promise<{ itemId?: string; createNew: boolean } | undefined>

export function promptPasskeyGetChoice(
  choices: Array<{
    credentialId: string
    itemName: string
    userName?: string
  }>,
): Promise<string | undefined>
