import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const vendorDir = path.join(rootDir, 'vendor', 'redis-docs')
const commandsTargetDir = path.join(vendorDir, 'content', 'commands')
const apiMappingTargetDir = path.join(vendorDir, 'data', 'command-api-mapping')
const manifestPath = path.join(vendorDir, 'source-manifest.json')

const GITHUB_COMMANDS_API =
  'https://api.github.com/repos/redis/docs/contents/content/commands?ref=main'
const GITHUB_COMMANDS_COMMIT_API =
  'https://api.github.com/repos/redis/docs/commits?path=content/commands&sha=main&per_page=1'
const GITHUB_API_MAPPING_API =
  'https://api.github.com/repos/redis/docs/contents/data/command-api-mapping?ref=main'
const GITHUB_API_MAPPING_COMMIT_API =
  'https://api.github.com/repos/redis/docs/commits?path=data/command-api-mapping&sha=main&per_page=1'

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'RedisCommander/1.16',
      accept: 'application/json;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) {
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
      return fetchJson(url, attempt + 1)
    }

    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

async function fetchText(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'RedisCommander/1.16',
      accept: 'text/plain, application/json;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) {
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
      return fetchText(url, attempt + 1)
    }

    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`)
  }

  return response.text()
}

async function mapWithConcurrency(items, concurrency, handler) {
  const results = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await handler(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )

  return results
}

async function syncDirectory({ apiUrl, label, targetDir }) {
  console.log(`Fetching ${label} listing...`)
  const entries = await fetchJson(apiUrl)
  const files = entries
    .filter((entry) => entry.type === 'file' && entry.download_url)
    .sort((left, right) => left.name.localeCompare(right.name))

  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })

  await mapWithConcurrency(files, 12, async (entry, index) => {
    console.log(`[${label} ${index + 1}/${files.length}] ${entry.name}`)
    const content = await fetchText(entry.download_url)
    await writeFile(path.join(targetDir, entry.name), content, 'utf8')
  })

  return {
    count: files.length,
    files: files.map((entry) => entry.name),
  }
}

async function main() {
  const [commandResult, apiMappingResult, commandCommits, apiMappingCommits] = await Promise.all([
    syncDirectory({
      apiUrl: GITHUB_COMMANDS_API,
      label: 'commands',
      targetDir: commandsTargetDir,
    }),
    syncDirectory({
      apiUrl: GITHUB_API_MAPPING_API,
      label: 'api-mapping',
      targetDir: apiMappingTargetDir,
    }),
    fetchJson(GITHUB_COMMANDS_COMMIT_API),
    fetchJson(GITHUB_API_MAPPING_COMMIT_API),
  ])

  await mkdir(vendorDir, { recursive: true })

  const manifest = {
    mirroredAt: new Date().toISOString(),
    repo: 'redis/docs',
    ref: 'main',
    sources: {
      apiMapping: {
        commitDate: apiMappingCommits[0]?.commit?.committer?.date ?? null,
        commitSha: apiMappingCommits[0]?.sha ?? null,
        count: apiMappingResult.count,
        path: 'data/command-api-mapping',
      },
      commands: {
        commitDate: commandCommits[0]?.commit?.committer?.date ?? null,
        commitSha: commandCommits[0]?.sha ?? null,
        count: commandResult.count,
        path: 'content/commands',
      },
    },
  }

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  const commandsFiles = await readdir(commandsTargetDir)
  const apiMappingFiles = await readdir(apiMappingTargetDir)

  console.log(`Mirrored ${commandsFiles.length} command markdown files to ${commandsTargetDir}`)
  console.log(`Mirrored ${apiMappingFiles.length} API mapping files to ${apiMappingTargetDir}`)
  console.log(`Wrote source manifest to ${manifestPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
