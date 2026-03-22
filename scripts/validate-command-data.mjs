import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const vendorDir = path.join(rootDir, 'vendor', 'redis-docs')
const commandsSourceDir = path.join(vendorDir, 'content', 'commands')
const apiMappingSourceDir = path.join(vendorDir, 'data', 'command-api-mapping')
const commandIndexPath = path.join(rootDir, 'src', 'data', 'command-index.json')
const commandDetailsPath = path.join(rootDir, 'public', 'data', 'command-details.json')
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/

function fail(message) {
  throw new Error(message)
}

function normalizeSourceKey(value) {
  return value.replace(/\s+/g, ' ').trim()
}

function hasShortcode(value) {
  return /\{\{[<%]/.test(value)
}

const [commandIndex, commandDetails, commandSourceFiles, apiMappingFiles] = await Promise.all([
  readFile(commandIndexPath, 'utf8').then((value) => JSON.parse(value)),
  readFile(commandDetailsPath, 'utf8').then((value) => JSON.parse(value)),
  readdir(commandsSourceDir),
  readdir(apiMappingSourceDir),
])

const sourceCommands = []

for (const file of commandSourceFiles.filter((entry) => entry.endsWith('.md')).sort()) {
  const rawMarkdown = await readFile(path.join(commandsSourceDir, file), 'utf8')
  const match = FRONTMATTER_RE.exec(rawMarkdown.trim())

  if (!match) {
    fail(`Could not parse source frontmatter for ${file}`)
  }

  const metadata = parseYaml(match[1]) ?? {}
  if (metadata.hidden || !metadata.title || !metadata.group) {
    continue
  }

  sourceCommands.push({
    slug: file.replace(/\.md$/, ''),
    title: normalizeSourceKey(metadata.title),
  })
}

const sourceSlugs = sourceCommands.map((entry) => entry.slug).sort()
const generatedSlugs = commandIndex.commands.map((command) => command.slug).sort()

if (sourceSlugs.length !== generatedSlugs.length) {
  fail(`Source/generation count mismatch: ${sourceSlugs.length} source files vs ${generatedSlugs.length} commands`)
}

for (let index = 0; index < sourceSlugs.length; index += 1) {
  if (sourceSlugs[index] !== generatedSlugs[index]) {
    fail(`Slug mismatch at index ${index}: expected ${sourceSlugs[index]}, received ${generatedSlugs[index]}`)
  }
}

const commandTitleLookup = new Map(sourceCommands.map((entry) => [entry.title, entry.slug]))
const sourceApiMappings = []

for (const file of apiMappingFiles.filter((entry) => entry.endsWith('.json')).sort()) {
  const rawMapping = await readFile(path.join(apiMappingSourceDir, file), 'utf8')
  const parsedMapping = JSON.parse(rawMapping)
  const hasMethods = Object.values(parsedMapping.api_calls ?? {}).some((methods) =>
    Array.isArray(methods) && methods.some((method) => method?.signature?.trim()),
  )

  sourceApiMappings.push({
    hasMethods,
    title: normalizeSourceKey(file.replace(/\.json$/, '')),
  })
}

const sourceApiMappingKeys = sourceApiMappings.map((entry) => entry.title).sort()

const mappedCommandTitlesWithMethods = sourceApiMappings
  .filter((entry) => entry.hasMethods && commandTitleLookup.has(entry.title))
  .map((entry) => entry.title)
const placeholderApiMappings = sourceApiMappings.filter((entry) => !entry.hasMethods)
const orphanApiMappings = sourceApiMappingKeys.filter((title) => !commandTitleLookup.has(title))

for (const command of commandIndex.commands) {
  const detail = commandDetails[command.slug]
  if (!detail) {
    fail(`Missing detail payload for ${command.slug}`)
  }

  if (!detail.title || !detail.group || !detail.syntax) {
    fail(`Missing required detail fields for ${command.slug}`)
  }

  if (hasShortcode(detail.intro)) {
    fail(`Intro still contains shortcode markup for ${command.slug}`)
  }

  if (detail.example && hasShortcode(detail.example)) {
    fail(`Example still contains shortcode markup for ${command.slug}`)
  }

  if ((detail.notes ?? []).some((note) => hasShortcode(note))) {
    fail(`Note still contains shortcode markup for ${command.slug}`)
  }

  const sourceTitle = sourceCommands.find((entry) => entry.slug === command.slug)?.title
  const expectsApiMethods = sourceTitle ? mappedCommandTitlesWithMethods.includes(sourceTitle) : false
  const hasApiMethods = Object.keys(detail.apiMethods ?? {}).length > 0

  if (expectsApiMethods && !hasApiMethods) {
    fail(`Expected API methods for ${command.slug} (${sourceTitle})`)
  }
}

const mget = commandDetails.mget
if (!mget) {
  fail('MGET detail payload is missing')
}

if (!(mget.notes?.[0] ?? '').includes("behavior varies in clustered Redis environments")) {
  fail('MGET note was not separated into the note payload')
}

if (mget.intro.includes("behavior varies in clustered Redis environments")) {
  fail('MGET intro still contains the clustered-environment note')
}

const smove = commandDetails.smove
if (!smove) {
  fail('SMOVE detail payload is missing')
}

if (!smove.intro.includes('destination` for other clients.')) {
  fail('SMOVE intro no longer contains the full source/destination sentence')
}

const expire = commandDetails.expire
if (!expire) {
  fail('EXPIRE detail payload is missing')
}

if (!(expire.apiMethods?.redis_py?.[0]?.signature ?? '').includes('expire(')) {
  fail('EXPIRE redis-py API methods were not mapped correctly')
}

console.log(`Validated ${generatedSlugs.length} generated commands against the local Redis docs source mirror.`)
console.log(
  `Validated API method mappings for ${mappedCommandTitlesWithMethods.length} commands (${placeholderApiMappings.length} empty upstream mapping files, ${orphanApiMappings.length} orphan mapping files ignored).`,
)
