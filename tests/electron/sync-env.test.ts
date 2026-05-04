import { describe, expect, it } from 'vitest'
import { resolveKlarkeyEnvRoots } from '@/electron/sync/env'

describe('desktop sync environment loading', () => {
  it('does not load dotenv files from launch directories in packaged builds', () => {
    expect(resolveKlarkeyEnvRoots({
      isPackaged: true,
      cwd: 'C:\\Users\\person\\Downloads',
      appPath: 'C:\\Program Files\\Klarkey\\resources\\app.asar',
      resourcesPath: 'C:\\Program Files\\Klarkey\\resources',
      execPath: 'C:\\Program Files\\Klarkey\\Klarkey.exe',
    })).toEqual([])
  })

  it('keeps dotenv discovery available for unpackaged development runs', () => {
    expect(resolveKlarkeyEnvRoots({
      isPackaged: false,
      cwd: 'E:\\Desktop\\klarkey',
      appPath: 'E:\\Desktop\\klarkey',
      resourcesPath: 'E:\\Desktop\\klarkey\\node_modules\\electron\\dist\\resources',
      execPath: 'E:\\Desktop\\klarkey\\node_modules\\electron\\dist\\electron.exe',
    })).toEqual([
      'E:\\Desktop\\klarkey',
      'E:\\Desktop',
      'E:\\Desktop\\klarkey\\node_modules\\electron\\dist\\resources',
      'E:\\Desktop\\klarkey\\node_modules\\electron\\dist',
    ])
  })
})
