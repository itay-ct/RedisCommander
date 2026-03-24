import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const outputDir = path.join(rootDir, 'src', 'data')
const commandsDir = path.join(outputDir, 'commands')
const publicDataDir = path.join(rootDir, 'public', 'data')
const vendorDir = path.join(rootDir, 'vendor', 'redis-docs')
const commandsSourceDir = path.join(vendorDir, 'content', 'commands')
const apiMappingSourceDir = path.join(vendorDir, 'data', 'command-api-mapping')
const sourceManifestPath = path.join(vendorDir, 'source-manifest.json')

const COMMANDS_URL = 'https://redis.io/docs/latest/commands/'
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/
const LEADING_NOTE_RE =
  /^\s*\{\{[<%]\s*note\b[^}]*[>%]\}\}\s*([\s\S]*?)\s*\{\{[<%]\s*\/note\s*[>%]\}\}\s*/i

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

function normalizeNullableString(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function isDeprecatedCommand(metadata) {
  return Boolean(
    normalizeNullableString(metadata.deprecated_since) ||
      (metadata.doc_flags ?? []).includes('deprecated') ||
      (metadata.command_flags ?? []).includes('deprecated'),
  )
}

function normalizeSourceKey(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function splitOverviewBody(markdown) {
  const headingIndex = markdown.search(/^##\s+/m)
  if (headingIndex === -1) {
    return {
      preface: markdown.trim(),
      remainder: '',
    }
  }

  return {
    preface: markdown.slice(0, headingIndex).trim(),
    remainder: markdown.slice(headingIndex).trim(),
  }
}

function extractLeadingNotes(markdown) {
  const notes = []
  let remaining = markdown.trim()

  while (remaining) {
    const match = LEADING_NOTE_RE.exec(remaining)
    if (!match) {
      break
    }

    notes.push(match[1].trim())
    remaining = remaining.slice(match[0].length).trim()
  }

  return {
    intro: remaining,
    notes,
  }
}

function stripShortcodes(markdown) {
  return markdown
    .replace(/\{\{[<%]\s*\/?\s*[\w.-]+\b[^}]*[>%]\}\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

function extractShortcodeBlock(markdown, name) {
  const regex = new RegExp(
    String.raw`\{\{[<%]\s*${name}\b[^}]*[>%]\}\}\s*([\s\S]*?)\s*\{\{[<%]\s*\/\s*${name}\s*[>%]\}\}`,
    'i',
  )

  return regex.exec(markdown)?.[1]?.trim() ?? null
}

function normalizeExampleBlock(markdown) {
  return markdown
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractExample(sections) {
  const exampleSection = sections.find((section) => /example/i.test(section.title))
  if (!exampleSection) {
    return null
  }

  const clientsExample = extractShortcodeBlock(exampleSection.content, 'clients-example')
  if (clientsExample) {
    return normalizeExampleBlock(clientsExample)
  }

  const redisCliExample = extractShortcodeBlock(exampleSection.content, 'redis-cli')
  if (redisCliExample) {
    return normalizeExampleBlock(redisCliExample)
  }

  const highlightedExample = extractShortcodeBlock(exampleSection.content, 'highlight')
  if (highlightedExample) {
    return normalizeExampleBlock(highlightedExample)
  }

  const fencedCodeMatch = /```[\w-]*\n([\s\S]*?)```/i.exec(exampleSection.content)
  if (fencedCodeMatch?.[1]) {
    return normalizeExampleBlock(fencedCodeMatch[1])
  }

  return null
}

function parseCommandMarkdown(slug, rawMarkdown) {
  const markdown = rawMarkdown.trim()
  const match = FRONTMATTER_RE.exec(markdown)

  if (!match) {
    throw new Error(`Could not parse frontmatter for ${slug}`)
  }

  const metadata = parseYaml(match[1]) ?? {}
  const rawBody = match[2]?.trim() ?? ''
  const { preface, remainder } = splitOverviewBody(rawBody)
  const { intro, notes } = extractLeadingNotes(preface)
  const sanitizedIntro = stripShortcodes(intro)
  const sanitizedNotes = notes.map(stripShortcodes).filter(Boolean)
  const normalizedBody = [sanitizedIntro, remainder].filter(Boolean).join('\n\n').trim()
  const sections = buildSections(normalizedBody)

  return {
    example: extractExample(sections),
    metadata,
    notes: sanitizedNotes,
    sections,
    content: normalizedBody,
    intro: sanitizedIntro,
  }
}

function normalizeApiMethods(apiCalls) {
  return Object.fromEntries(
    Object.entries(apiCalls ?? {})
      .map(([clientId, methods]) => {
        const normalizedMethods = (methods ?? [])
          .filter((method) => method?.signature?.trim())
          .map((method) => ({
            params: (method.params ?? []).map((param) => ({
              description: param.description ?? '',
              name: param.name ?? '',
              type: param.type ?? '',
            })),
            returns: method.returns
              ? {
                  description: method.returns.description ?? '',
                  type: method.returns.type ?? '',
                }
              : undefined,
            signature: method.signature.trim(),
          }))

        return [clientId, normalizedMethods]
      })
      .filter(([, methods]) => methods.length),
  )
}

function normalizeCommandRecord(slug, parsed, apiMethods) {
  const { metadata, content, example, intro, notes, sections } = parsed
  const title = metadata.title?.trim()
  const group = metadata.group?.trim()
  const deprecated = isDeprecatedCommand(metadata)

  if (metadata.hidden || !title || !group) {
    return null
  }

  const docsUrl = `${COMMANDS_URL}${slug}/`
  const description = metadata.description ?? metadata.summary ?? ''

  return {
    slug,
    title,
    description,
    docsUrl,
    group,
    groupLabel: getGroupLabel(group),
    syntax: metadata.syntax_fmt ?? title,
    complexity: metadata.complexity ?? null,
    since: metadata.since ?? null,
    arity: metadata.arity ?? null,
    aclCategories: metadata.acl_categories ?? [],
    apiMethods,
    commandFlags: metadata.command_flags ?? [],
    arguments: metadata.arguments ?? [],
    deprecated,
    deprecatedSince: normalizeNullableString(metadata.deprecated_since),
    keySpecs: metadata.key_specs ?? [],
    moduleName: normalizeNullableString(metadata.module),
    redisCategories: unique(metadata.categories ?? []),
    replacedBy: normalizeNullableString(metadata.replaced_by),
    tableOfContents: { sections: [] },
    codeExamples: [],
    content,
    example,
    intro: intro || description,
    notes,
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

async function getSourceDate() {
  try {
    const manifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'))
    const dates = [
      manifest.sources?.commands?.commitDate,
      manifest.sources?.apiMapping?.commitDate,
      manifest.mirroredAt,
    ].filter(Boolean)

    return dates.sort().at(-1) ?? null
  } catch {
    try {
      const [commandsStat, apiMappingStat] = await Promise.all([
        stat(commandsSourceDir),
        stat(apiMappingSourceDir),
      ])

      return [commandsStat.mtime.toISOString(), apiMappingStat.mtime.toISOString()].sort().at(-1) ?? null
    } catch {
      return null
    }
  }
}

async function getSourceFiles(sourceDir, extension) {
  const files = await readdir(sourceDir)
  return files.filter((file) => file.endsWith(extension)).sort()
}

async function buildApiMappingLookup() {
  const files = await getSourceFiles(apiMappingSourceDir, '.json')
  const lookup = new Map()

  for (const file of files) {
    const raw = await readFile(path.join(apiMappingSourceDir, file), 'utf8')
    const data = JSON.parse(raw)
    lookup.set(normalizeSourceKey(path.basename(file, '.json')), normalizeApiMethods(data.api_calls))
  }

  return lookup
}

function validateRecords(records, apiMappingLookup) {
  const seenSlugs = new Set()
  const errors = []
  const hasShortcode = (value) => /\{\{[<%]/.test(value)

  for (const record of records) {
    if (seenSlugs.has(record.slug)) {
      errors.push(`${record.slug}: duplicate slug`)
    }

    seenSlugs.add(record.slug)

    if (!record.title || !record.group || !record.syntax) {
      errors.push(`${record.slug}: missing required command fields`)
    }

    if (!record.intro && !record.description) {
      errors.push(`${record.slug}: missing intro and description`)
    }

    if (hasShortcode(record.intro)) {
      errors.push(`${record.slug}: intro still contains shortcode markup`)
    }

    if (record.notes.some((note) => hasShortcode(note))) {
      errors.push(`${record.slug}: note still contains shortcode markup`)
    }

    if (record.example && hasShortcode(record.example)) {
      errors.push(`${record.slug}: example still contains shortcode markup`)
    }

    const expectedApiMethods = apiMappingLookup.get(normalizeSourceKey(record.title))
    if (expectedApiMethods && Object.keys(expectedApiMethods).length && !Object.keys(record.apiMethods).length) {
      errors.push(`${record.slug}: expected API methods were not attached`)
    }
  }

  if (errors.length) {
    throw new Error(`Command validation failed:\n${errors.slice(0, 20).join('\n')}`)
  }
}

async function ensureLocalMirror() {
  try {
    await Promise.all([stat(commandsSourceDir), stat(apiMappingSourceDir)])
  } catch {
    throw new Error(
      `Redis docs source mirror is missing. Run "npm run sync:redis-docs" first or copy the upstream source into ${vendorDir}.`,
    )
  }
}

async function main() {
  await ensureLocalMirror()

  console.log('Reading Redis command source markdown from the local vendor mirror...')

  const [commandFiles, apiMappingLookup, sourceDate] = await Promise.all([
    getSourceFiles(commandsSourceDir, '.md'),
    buildApiMappingLookup(),
    getSourceDate(),
  ])

  console.log(`Found ${commandFiles.length} command markdown files`)

  const records = []

  for (const [index, file] of commandFiles.entries()) {
    const slug = path.basename(file, '.md')
    console.log(`[${index + 1}/${commandFiles.length}] ${slug}`)
    const rawMarkdown = await readFile(path.join(commandsSourceDir, file), 'utf8')
    const parsed = parseCommandMarkdown(slug, rawMarkdown)
    const title = normalizeSourceKey(parsed.metadata.title?.trim() ?? '')
    const apiMethods = title ? apiMappingLookup.get(title) ?? {} : {}
    const record = normalizeCommandRecord(slug, parsed, apiMethods)
    if (record) {
      records.push(record)
    }
  }

  records.sort((a, b) => {
    if (a.group === b.group) {
      return a.title.localeCompare(b.title)
    }

    return a.group.localeCompare(b.group)
  })

  validateRecords(records, apiMappingLookup)

  const commands = records.map((record) => ({
    arity: record.arity,
    complexity: record.complexity,
    deprecated: record.deprecated,
    deprecatedSince: record.deprecatedSince,
    description: record.description,
    group: record.group,
    moduleName: record.moduleName,
    replacedBy: record.replacedBy,
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
    sourceDate,
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
