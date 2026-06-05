import { useCallback, useEffect, useMemo, useState } from 'react'
import { itemInitials } from '@/app/palette-utils'
import { getCachedLoginLogo } from '@/app/login-logo-cache'
import { buildLoginLogoUrl, normalizeLoginLogoDomain } from '@/shared/login-logo'

function CachedLoginLogoImage({
  source,
  title,
  onMissing,
  onReady,
}: {
  source: string
  title: string
  onMissing: () => void
  onReady: () => void
}) {
  const [resolvedSource, setResolvedSource] = useState<string>()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false

    void getCachedLoginLogo(source).then((nextSource) => {
      if (cancelled) {
        return
      }

      if (!nextSource) {
        onMissing()
        return
      }

      setResolvedSource(nextSource)
    })

    return () => {
      cancelled = true
    }
  }, [onMissing, source])

  if (!resolvedSource) {
    return null
  }

  return (
    <img
      src={resolvedSource}
      alt={`${title} logo`}
      className={`absolute inset-0 h-8 w-8 bg-white/6 object-contain transition-opacity duration-150 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      draggable={false}
      onLoad={() => {
        setLoaded(true)
        onReady()
      }}
      onError={onMissing}
    />
  )
}

export function LoginItemIcon({
  title,
  logoDomain,
  logoName,
}: {
  title: string
  logoDomain?: string
  logoName?: string
}) {
  const sources = useMemo(() => {
    const resolvedDomain = normalizeLoginLogoDomain(logoDomain) ?? normalizeLoginLogoDomain(title)
    const resolvedName = logoName?.trim() || title.trim()

    return [
      ...(resolvedDomain ? [buildLoginLogoUrl('domain', resolvedDomain)] : []),
      ...(resolvedName ? [buildLoginLogoUrl('name', resolvedName)] : []),
    ]
  }, [logoDomain, logoName, title])

  const sourcesKey = sources.join('\n')
  const [sourceState, setSourceState] = useState({ index: 0, key: sourcesKey })
  const sourceIndex = sourceState.key === sourcesKey ? sourceState.index : 0
  const source = sources[sourceIndex]
  const initials = itemInitials(title || 'Klarkey')
  const [readySource, setReadySource] = useState<string>()
  const logoReady = readySource === source
  const handleMissing = useCallback(() => {
    setSourceState((current) => ({
      key: sourcesKey,
      index: (current.key === sourcesKey ? current.index : 0) + 1,
    }))
  }, [sourcesKey])
  const handleReady = useCallback(() => {
    if (source) {
      setReadySource(source)
    }
  }, [source])

  if (!source) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-sky-500/20 text-[12px] font-semibold text-sky-200">
        {initials}
      </div>
    )
  }

  return (
    <div className="relative h-8 w-8 overflow-hidden rounded-[9px] bg-white/6">
      {!logoReady ? (
        <div className="flex h-8 w-8 items-center justify-center bg-sky-500/20 text-[12px] font-semibold text-sky-200">
          {initials}
        </div>
      ) : null}
      <CachedLoginLogoImage
        key={source}
        source={source}
        title={title}
        onMissing={handleMissing}
        onReady={handleReady}
      />
    </div>
  )
}
