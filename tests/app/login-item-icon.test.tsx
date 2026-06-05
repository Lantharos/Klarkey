import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginItemIcon } from '@/app/login-item-icon'

vi.mock('@/app/login-logo-cache', () => ({
  getCachedLoginLogo: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
}))

describe('login item icon', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('removes fallback initials after a transparent logo loads', async () => {
    render(<LoginItemIcon title="Github" logoDomain="github.com" />)

    expect(screen.getByText('Gi')).toBeInTheDocument()

    const logo = await screen.findByAltText('Github logo')
    fireEvent.load(logo)

    await waitFor(() => {
      expect(screen.queryByText('Gi')).toBeNull()
    })
  })
})
