import type { CreateIdentityInput } from '@/shared/types'

export const seedServices = ['GitHub', 'Discord', 'Stripe', 'Netflix', 'Twitter']

export const seedIdentities: CreateIdentityInput[] = [
  { serviceName: 'GitHub', preferredLabel: 'Work' },
  { serviceName: 'GitHub', preferredLabel: 'Personal' },
  { serviceName: 'Discord', preferredLabel: 'Primary' },
  { serviceName: 'Stripe', preferredLabel: 'Ops' },
  { serviceName: 'Netflix', preferredLabel: 'Family' },
]
