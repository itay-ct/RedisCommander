import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const outputDir = path.join(rootDir, 'src', 'data')
const commandsDir = path.join(outputDir, 'commands')
const publicDataDir = path.join(rootDir, 'public', 'data')

const COMMANDS_URL = 'https://redis.io/docs/latest/commands/'
const INDEX_LINK_RE = /href="\/docs\/latest\/commands\/([^"/]+)\/"/g
const METADATA_BLOCK_RE = /```json metadata\n([\s\S]*?)\n```\n?([\s\S]*)$/
const DATE_MODIFIED_RE = /<meta itemprop="dateModified" content="([^"]+)"/
const EXCLUDE_SLUGS = new Set([
  'redis-8-6-commands',
  'redis-8-4-commands',
  'redis-8-2-commands',
  'redis-8-0-commands',
  'redis-7-4-commands',
  'redis-7-2-commands',
  'redis-6-2-commands',
])

const GROUP_LABELS = {
  bitmap: 'Bitmaps',
  bf: 'Bloom',
  bloom: 'Bloom',
  cf: 'Cuckoo',
  cluster: 'Cluster',
  cms: 'Count-Min Sketch',
  connection: 'Connection',
  generic: 'Generic',
  geo: 'Geo',
  graph: 'Graph',
  hash: 'Hashes',
  hyperloglog: 'HyperLogLog',
  json: 'JSON',
  list: 'Lists',
  pubsub: 'Pub/Sub',
  scripting: 'Scripting',
  search: 'Search',
  server: 'Server',
  set: 'Sets',
  sorted_set: 'Sorted Sets',
  'sorted-set': 'Sorted Sets',
  stream: 'Streams',
  suggestion: 'Suggestions',
  string: 'Strings',
  tdigest: 'T-Digest',
  timeseries: 'Time Series',
  topk: 'Top-K',
  transactions: 'Transactions',
  vector_set: 'Vector Sets',
}

async function fetchText(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'RedisApiExplorer/1.0',
      accept: 'text/html, text/markdown, application/json;q=0.9,*/*;q=0.8',
    },
  })

  if (!response.ok) {
    if (attempt < 4) {
      await wait(250 * attempt)
      return fetchText(url, attempt + 1)
    }

    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`)
  }

  return response.text()
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function unique(values) {
  return [...new Set(values)]
}

function escapeTitleCase(value) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getGroupLabel(group) {
  return GROUP_LABELS[group] ?? escapeTitleCase(group)
}

function stripBoilerplate(markdown) {
  const legendIndex = markdown.indexOf('## Code Examples Legend')
  if (legendIndex === -1) {
    return markdown.trim()
  }

  const splitIndex = markdown.indexOf('\n---\n', legendIndex)
  if (splitIndex === -1) {
    return markdown.trim()
  }

  return markdown.slice(splitIndex + '\n---\n'.length).trim()
}

function buildSections(markdown) {
  const lines = markdown.split('\n')
  const sections = []
  let current = { title: 'Overview', level: 1, content: [] }

  for (const line of lines) {
    const headingMatch = /^(##|###)\s+(.*)$/.exec(line)
    if (headingMatch) {
      const content = current.content.join('\n').trim()
      if (content) {
        sections.push({
          title: current.title,
          level: current.level,
          content,
        })
      }

      current = {
        title: headingMatch[2].trim(),
        level: headingMatch[1].length,
        content: [],
      }
      continue
    }

    current.content.push(line)
  }

  const trailingContent = current.content.join('\n').trim()
  if (trailingContent) {
    sections.push({
      title: current.title,
      level: current.level,
      content: trailingContent,
    })
  }

  return sections
}

function extractIntro(sections) {
  const overview = sections.find((section) => section.title === 'Overview')
  return overview?.content ?? ''
}

function parseCommandMarkdown(slug, rawMarkdown) {
  const markdown = rawMarkdown.trim()
  const match = METADATA_BLOCK_RE.exec(markdown)

  if (!match) {
    throw new Error(`Could not parse metadata block for ${slug}`)
  }

  const metadata = JSON.parse(match[1])
  const content = stripBoilerplate(match[2] ?? '')
  const sections = buildSections(content)

  return {
    metadata,
    content,
    sections,
  }
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

function normalizeCommandRecord(slug, parsed) {
  const { metadata, content, sections } = parsed
  const title = metadata.title?.trim()
  const group = metadata.group?.trim()

  if (!title || !group) {
    return null
  }

  const docsUrl = `${COMMANDS_URL}${slug}/`

  return {
    slug,
    title,
    description: metadata.description ?? '',
    docsUrl,
    group,
    groupLabel: getGroupLabel(group),
    syntax: metadata.syntax_fmt ?? title,
    complexity: metadata.complexity ?? null,
    since: metadata.since ?? null,
    arity: metadata.arity ?? null,
    aclCategories: metadata.acl_categories ?? [],
    commandFlags: metadata.command_flags ?? [],
    arguments: metadata.arguments ?? [],
    keySpecs: metadata.key_specs ?? [],
    redisCategories: unique(metadata.categories ?? []),
    tableOfContents: metadata.tableOfContents ?? { sections: [] },
    codeExamples: metadata.codeExamples ?? [],
    content,
    intro: extractIntro(sections),
    sections,
  }
}

function buildCategoryRecords(commands) {
  const counts = new Map()

  for (const command of commands) {
    counts.set(command.group, (counts.get(command.group) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([group, count]) => ({
      group,
      label: getGroupLabel(group),
      count,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count
      }

      return a.label.localeCompare(b.label)
    })
}

async function main() {
  console.log('Fetching commands index...')
  const indexHtml = await fetchText(COMMANDS_URL)
  const indexDate = DATE_MODIFIED_RE.exec(indexHtml)?.[1] ?? null
  const discoveredSlugs = unique(
    [...indexHtml.matchAll(INDEX_LINK_RE)]
      .map((match) => match[1])
      .filter((slug) => !EXCLUDE_SLUGS.has(slug)),
  ).sort()

  console.log(`Found ${discoveredSlugs.length} command pages`)

  const records = (
    await mapWithConcurrency(discoveredSlugs, 12, async (slug, index) => {
      const markdownUrl = `${COMMANDS_URL}${slug}/index.html.md`
      console.log(`[${index + 1}/${discoveredSlugs.length}] ${slug}`)
      const rawMarkdown = await fetchText(markdownUrl)
      return normalizeCommandRecord(slug, parseCommandMarkdown(slug, rawMarkdown))
    })
  )
    .filter(Boolean)
    .sort((a, b) => {
      if (a.group === b.group) {
        return a.title.localeCompare(b.title)
      }

      return a.group.localeCompare(b.group)
    })

  const commands = records.map((record) => ({
    arity: record.arity,
    complexity: record.complexity,
    description: record.description,
    group: record.group,
    since: record.since,
    slug: record.slug,
    syntax: record.syntax,
    title: record.title,
  }))

  const commandDetails = Object.fromEntries(records.map((record) => [record.slug, record]))

  await mkdir(commandsDir, { recursive: true })
  await rm(commandsDir, { recursive: true, force: true })
  await mkdir(commandsDir, { recursive: true })

  await Promise.all(
    records.map((record) =>
      writeFile(
        path.join(commandsDir, `${record.slug}.json`),
        JSON.stringify(record, null, 2) + '\n',
        'utf8',
      ),
    ),
  )

  const commandIndex = {
    generatedAt: new Date().toISOString(),
    sourceDate: indexDate,
    sourceUrl: COMMANDS_URL,
    commandCount: commands.length,
    categories: buildCategoryRecords(commands),
    commands,
  }

  await mkdir(outputDir, { recursive: true })
  await writeFile(
    path.join(outputDir, 'command-index.json'),
    JSON.stringify(commandIndex, null, 2) + '\n',
    'utf8',
  )
  await mkdir(publicDataDir, { recursive: true })
  await writeFile(
    path.join(publicDataDir, 'command-details.json'),
    JSON.stringify(commandDetails, null, 2) + '\n',
    'utf8',
  )

  console.log(`Wrote ${commands.length} commands to ${commandsDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
