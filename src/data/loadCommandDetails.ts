import type { CommandDetail } from '../types'

type CommandDetailCatalog = Record<string, CommandDetail>

async function loadCommandDetails(): Promise<CommandDetailCatalog> {
  if (typeof fetch !== 'function') {
    return {}
  }

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}data/command-details.json`, {
      cache: 'force-cache',
    })

    if (!response.ok) {
      throw new Error(`Unable to read command cache (${response.status})`)
    }

    return (await response.json()) as CommandDetailCatalog
  } catch (error) {
    console.error('Redis command cache could not be loaded.', error)
    return {}
  }
}

export const commandDetailCatalog = await loadCommandDetails()
