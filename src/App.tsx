import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { AsciiArtPane } from './components/AsciiArtPane'
import { ShuffleText } from './components/ShuffleText'
import commandIndexJson from './data/command-index.json'
import { commandDetailCatalog } from './data/loadCommandDetails'
import { PRIMARY_GROUPS, getCategoryMeta } from './lib/categoryMeta'
import { formatArity, formatCount, resolveRedisHref } from './lib/format'
import type {
  ApiMethod,
  CategoryMenuItem,
  CategoryRecord,
  CategoryShelf,
  CommandArgument,
  CommandDetail,
  CommandIndex,
  CommandSummary,
} from './types'

type PaneFocus = 'categories' | 'commands' | 'details'

type CategoryBrowserItem =
  | CategoryMenuItem
  | {
      accent: string
      artLabel: string
      kind: 'back'
      label: string
      tagline: string
    }

const CATEGORY_ROWS = 11
const COMMAND_ROWS = 14
const ARGUMENT_ROWS = 6
const FIND_RESULT_LIMIT = 6
const API_METHOD_LIMIT = 4
const RELEASE_VERSION = '1.10'
const REPO_URL = 'https://github.com/itay-ct/RedisCommander'
const CLIENT_COOKIE_NAME = 'redis-commander-client'
const DEFAULT_CLIENT_ID = 'redis-cli'

const CLIENT_OPTIONS = [
  { id: DEFAULT_CLIENT_ID, label: 'Redis CLI' },
  { id: 'redis_py', label: 'Python' },
  { id: 'node_redis', label: 'Node.js' },
  { id: 'jedis', label: 'Java-Sync' },
  { id: 'lettuce_sync', label: 'Lettuce-Sync' },
  { id: 'lettuce_async', label: 'Java-Async' },
  { id: 'lettuce_reactive', label: 'Java-Reactive' },
  { id: 'go-redis', label: 'Go' },
  { id: 'nredisstack_sync', label: 'C#-Sync' },
  { id: 'nredisstack_async', label: 'C#-Async' },
  { id: 'php', label: 'PHP' },
  { id: 'redis_rs_sync', label: 'Rust-Sync' },
  { id: 'redis_rs_async', label: 'Rust-Async' },
] as const

type ClientOption = (typeof CLIENT_OPTIONS)[number]
type ApiMethodTokenKind = 'comment' | 'method' | 'param-name' | 'punct' | 'return' | 'type'
type ApiMethodToken = {
  kind: ApiMethodTokenKind
  text: string
}
type ApiMethodLine = ApiMethodToken[]
type ExcerptBlock =
  | {
      kind: 'list'
      items: string[]
    }
  | {
      kind: 'paragraph'
      text: string
    }

const commandIndex = commandIndexJson as CommandIndex

const showMoreItem: CategoryBrowserItem = {
  accent: '#58d7ff',
  artLabel: 'Archive',
  kind: 'more',
  label: 'SHOW MORE',
  tagline: 'Step into the extended Redis surface: search, vectors, modules, and server operations.',
}

const backToCoreItem: CategoryBrowserItem = {
  accent: '#ffd95a',
  artLabel: 'Core',
  kind: 'back',
  label: '.. CORE CATEGORIES',
  tagline: 'Return to the core Redis command families.',
}

const fallbackIntroBlocks: ExcerptBlock[] = [
  {
    kind: 'paragraph',
    text: 'Select a command to open its local Redis transcript.',
  },
]

function clampIndex(index: number, size: number) {
  if (size <= 0) {
    return 0
  }

  return Math.min(Math.max(index, 0), size - 1)
}

function wrapIndex(index: number, size: number) {
  if (size <= 0) {
    return 0
  }

  return ((index % size) + size) % size
}

function buildCommandsByGroup(commands: CommandSummary[]) {
  const record: Record<string, CommandSummary[]> = {}

  for (const command of commands) {
    if (!record[command.group]) {
      record[command.group] = []
    }

    record[command.group].push(command)
  }

  return record
}

function buildCategoryRecords(
  groups: Record<string, CommandSummary[]>,
  categories: CommandIndex['categories'],
) {
  const counts = new Map(categories.map((category) => [category.group, category.count]))

  return Object.keys(groups)
    .map((group) => {
      const meta = getCategoryMeta(group)
      return {
        accent: meta.accent,
        artLabel: meta.artLabel,
        count: counts.get(group) ?? groups[group].length,
        group,
        label: meta.label,
        tagline: meta.tagline,
      } satisfies CategoryRecord
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count
      }

      return left.label.localeCompare(right.label)
    })
}

function windowSlice<T>(items: T[], activeIndex: number, size: number) {
  if (items.length <= size) {
    return {
      items,
      start: 0,
    }
  }

  const half = Math.floor(size / 2)
  let start = Math.max(0, activeIndex - half)
  start = Math.min(start, items.length - size)

  return {
    items: items.slice(start, start + size),
    start,
  }
}

function formatCounter(position: number, total: number) {
  const width = Math.max(2, String(total).length)
  const safePosition = total === 0 ? 0 : position
  return `${String(safePosition).padStart(width, '0')}/${String(total).padStart(width, '0')}`
}

function formatClock(value: Date) {
  return value.toLocaleTimeString('en-GB', {
    hour12: false,
  })
}

function toPlainText(value: string) {
  return value
    .replace(/\{\{[<%][\s\S]*?[>%]\}\}/g, ' ')
    .replace(/```[\s\S]*?```/g, ' [code sample] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, '• ')
    .replace(/\|/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractExcerptBlocks(value: string, maxBlocks: number, maxChars: number): ExcerptBlock[] {
  const chunks = value
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  const excerpt: ExcerptBlock[] = []
  let total = 0

  for (const chunk of chunks) {
    if (excerpt.length >= maxBlocks) {
      break
    }

    const lines = chunk
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)

    const listItems: string[] = []

    for (const line of lines) {
      if (/^[-*+]\s+/.test(line)) {
        listItems.push(line.replace(/^[-*+]\s+/, '').trim())
        continue
      }

      if (listItems.length) {
        listItems[listItems.length - 1] = `${listItems[listItems.length - 1]} ${line}`.trim()
      } else {
        listItems.length = 0
        break
      }
    }

    const block: ExcerptBlock =
      listItems.length && listItems.length <= lines.length
        ? {
            items: listItems,
            kind: 'list',
          }
        : {
            kind: 'paragraph',
            text: lines.join(' ').trim(),
          }

    const blockText =
      block.kind === 'list' ? block.items.join(' ').trim() : block.text

    if (!blockText) {
      continue
    }

    if (excerpt.length > 0 && total + blockText.length > maxChars) {
      break
    }

    excerpt.push(block)
    total += blockText.length
  }

  if (!excerpt.length) {
    const fallback = toPlainText(value)
    return fallback
      ? [
          {
            kind: 'paragraph',
            text: fallback,
          },
        ]
      : []
  }

  return excerpt
}

function stripExampleMarkup(value: string) {
  return value
    .replace(/<summary>[\s\S]*?<\/summary>/gi, '\n')
    .replace(/<\/?details[^>]*>/gi, '\n')
    .replace(/```[\w-]*\n([\s\S]*?)```/g, '\n$1\n')
    .replace(/<\/?[^>]+>/g, '\n')
    .replace(/\r/g, '')
}

function normalizeRedisCommandLine(line: string) {
  const cleaned = line
    .replace(/^\s*(?:redis>|>)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) {
    return null
  }

  if (cleaned.endsWith(':')) {
    return null
  }

  if (/^(?:OK|QUEUED|PONG|nil|null|\(.*\)|\d+\)|-ERR|\.\.\.)$/i.test(cleaned)) {
    return null
  }

  if (!/^[A-Z][A-Z0-9._-]*(?:\s|$)/.test(cleaned)) {
    return null
  }

  return cleaned
}

function extractRedisCliSnippet(value: string) {
  const lines = stripExampleMarkup(value)
    .split('\n')
    .map(normalizeRedisCommandLine)
    .filter((line): line is string => Boolean(line))

  const uniqueLines = [...new Set(lines)]
  return uniqueLines.slice(0, 10).join('\n')
}

function getExampleCard(
  detail: CommandDetail | null,
  command: CommandSummary | null,
): {
  content: string
} {
  if (!detail) {
    return {
      content: 'Select a Redis command from the middle pane to open its local command summary.',
    }
  }

  if (detail.example) {
    return {
      content: detail.example,
    }
  }

  for (const section of detail.sections.filter((entry) => /example/i.test(entry.title))) {
    const snippet = extractRedisCliSnippet(section.content)
    if (snippet) {
      return {
        content: snippet,
      }
    }
  }

  return {
    content: command?.syntax ?? detail.syntax ?? 'No Redis CLI example in local cache.',
  }
}

function buildFallbackDetail(command: CommandSummary, groupLabel: string): CommandDetail {
  return {
    aclCategories: [],
    apiMethods: {},
    arguments: [],
    arity: command.arity,
    codeExamples: [],
    commandFlags: [],
    complexity: command.complexity,
    content: command.description,
    description: command.description,
    docsUrl: resolveRedisHref(commandIndex.sourceUrl, `./${command.slug}/`),
    example: null,
    group: command.group,
    groupLabel,
    intro: command.description,
    keySpecs: [],
    notes: [],
    redisCategories: [command.group],
    sections: [
      {
        content: command.description || 'No local transcript excerpt is available for this command.',
        level: 1,
        title: 'Overview',
      },
    ],
    since: command.since,
    slug: command.slug,
    syntax: command.syntax,
    tableOfContents: { sections: [] },
    title: command.title,
  }
}

function formatArgumentLabel(argument: CommandArgument) {
  return argument.display_text ?? argument.token ?? argument.name
}

function normalizeCommandSearchValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getCommandSearchResults(commands: CommandSummary[], query: string, limit: number) {
  const normalizedQuery = normalizeCommandSearchValue(query)
  if (!normalizedQuery) {
    return []
  }

  const tokens = normalizedQuery.split(' ')

  return commands
    .map((command) => {
      const titleKey = normalizeCommandSearchValue(command.title)
      const slugKey = normalizeCommandSearchValue(command.slug)
      const groupKey = normalizeCommandSearchValue(command.group)
      const syntaxKey = normalizeCommandSearchValue(command.syntax ?? '')
      const descriptionKey = normalizeCommandSearchValue(command.description ?? '')

      let score = Number.POSITIVE_INFINITY

      if (titleKey === normalizedQuery || slugKey === normalizedQuery) {
        score = 0
      } else if (titleKey.startsWith(normalizedQuery)) {
        score = 1
      } else if (slugKey.startsWith(normalizedQuery)) {
        score = 2
      } else if (tokens.every((token) => titleKey.includes(token))) {
        score = 3
      } else if (tokens.every((token) => slugKey.includes(token))) {
        score = 4
      } else if (tokens.every((token) => syntaxKey.includes(token))) {
        score = 5
      } else if (tokens.every((token) => groupKey.includes(token))) {
        score = 6
      } else if (tokens.every((token) => descriptionKey.includes(token))) {
        score = 7
      } else {
        return null
      }

      return {
        command,
        score,
      }
    })
    .filter((entry): entry is { command: CommandSummary; score: number } => Boolean(entry))
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score
      }

      if (left.command.title.length !== right.command.title.length) {
        return left.command.title.length - right.command.title.length
      }

      return left.command.title.localeCompare(right.command.title)
    })
    .slice(0, limit)
    .map((entry) => entry.command)
}

function getCompletionTail(query: string, command: CommandSummary | null) {
  if (!command) {
    return ''
  }

  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return ''
  }

  const candidates = [command.title, command.slug]
  for (const candidate of candidates) {
    if (candidate.toLowerCase().startsWith(trimmedQuery.toLowerCase())) {
      return candidate.slice(trimmedQuery.length)
    }
  }

  return ''
}

function cleanupInlineMarkdown(value: string) {
  return value
    .replace(/\\([()[\]_*`])/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1$2')
}

function readCookie(name: string) {
  if (typeof document === 'undefined') {
    return null
  }

  const prefix = `${name}=`
  const match = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix))

  return match ? decodeURIComponent(match.slice(prefix.length)) : null
}

function writeCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') {
    return
  }

  const expires = new Date()
  expires.setDate(expires.getDate() + days)
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`
}

function getClientOptions(detail: CommandDetail | null) {
  if (!detail) {
    return [CLIENT_OPTIONS[0]]
  }

  const options: ClientOption[] = [CLIENT_OPTIONS[0]]

  for (const option of CLIENT_OPTIONS.slice(1)) {
    if ((detail.apiMethods[option.id] ?? []).length) {
      options.push(option)
    }
  }

  return options
}

function getClientOptionById(clientId: string) {
  return CLIENT_OPTIONS.find((option) => option.id === clientId) ?? CLIENT_OPTIONS[0]
}

function normalizeInlineText(value: string | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

function createApiMethodToken(kind: ApiMethodTokenKind, text: string): ApiMethodToken {
  return { kind, text }
}

function parseApiMethodSignature(signature: string) {
  const cleaned = normalizeInlineText(signature)
  if (!cleaned) {
    return {
      leadingReturnType: '',
      methodName: 'method',
    }
  }

  const head = cleaned.includes('(') ? cleaned.slice(0, cleaned.indexOf('(')).trim() : cleaned
  const methodName = head.split(/\s+/).at(-1)?.split('.').at(-1) ?? head
  const leadingReturnType = head.slice(0, Math.max(0, head.length - methodName.length)).trim()

  return {
    leadingReturnType,
    methodName,
  }
}

function buildApiMethodLines(method: ApiMethod): ApiMethodLine[] {
  const { leadingReturnType, methodName } = parseApiMethodSignature(method.signature)
  const returnType = normalizeInlineText(method.returns?.type) || leadingReturnType
  const returnDescription = normalizeInlineText(method.returns?.description)

  if (!method.params.length) {
    const line: ApiMethodLine = [
      createApiMethodToken('method', methodName),
      createApiMethodToken('punct', '()'),
    ]

    if (returnType) {
      line.push(createApiMethodToken('punct', ' → '))
      line.push(createApiMethodToken('return', returnType))
    }

    if (returnDescription) {
      line.push(createApiMethodToken('comment', ` // ${returnDescription}`))
    }

    return [line]
  }

  const lines: ApiMethodLine[] = [[createApiMethodToken('method', methodName), createApiMethodToken('punct', '(')]]

  method.params.forEach((param, index) => {
    const paramName = normalizeInlineText(param.name) || `arg${index + 1}`
    const paramType = normalizeInlineText(param.type)
    const paramDescription = normalizeInlineText(param.description)
    const line: ApiMethodLine = [
      createApiMethodToken('punct', '  '),
      createApiMethodToken('param-name', paramName),
    ]

    if (paramType) {
      line.push(createApiMethodToken('punct', ': '))
      line.push(createApiMethodToken('type', paramType))
    }

    if (index < method.params.length - 1) {
      line.push(createApiMethodToken('punct', ','))
    }

    if (paramDescription) {
      line.push(createApiMethodToken('comment', ` // ${paramDescription}`))
    }

    lines.push(line)
  })

  const closingLine: ApiMethodLine = [createApiMethodToken('punct', ')')]

  if (returnType) {
    closingLine.push(createApiMethodToken('punct', ' → '))
    closingLine.push(createApiMethodToken('return', returnType))
  }

  if (returnDescription) {
    closingLine.push(createApiMethodToken('comment', ` // ${returnDescription}`))
  }

  lines.push(closingLine)
  return lines
}

const commandsByGroup = buildCommandsByGroup(commandIndex.commands)
const commandReferenceLookup = new Map<string, CommandSummary>()

for (const command of commandIndex.commands) {
  commandReferenceLookup.set(normalizeCommandSearchValue(command.title), command)
  commandReferenceLookup.set(normalizeCommandSearchValue(command.slug), command)
}

const categoryRecords = buildCategoryRecords(commandsByGroup, commandIndex.categories)
const categoryLookup = Object.fromEntries(
  categoryRecords.map((category) => [category.group, category]),
) as Record<string, CategoryRecord>
const primaryCategories = PRIMARY_GROUPS.map((group) => categoryLookup[group]).filter(Boolean)
const secondaryCategories = categoryRecords.filter(
  (category) => !PRIMARY_GROUPS.includes(category.group),
)
const primaryMenu: CategoryBrowserItem[] = [
  ...primaryCategories.map((category) => ({ ...category, kind: 'category' as const })),
  showMoreItem,
]
const secondaryMenu: CategoryBrowserItem[] = [
  backToCoreItem,
  ...secondaryCategories.map((category) => ({ ...category, kind: 'category' as const })),
]
const initialGroup = primaryCategories[0]?.group ?? categoryRecords[0]?.group ?? ''
const docsSnapshotLabel = commandIndex.sourceDate
  ? new Date(commandIndex.sourceDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  : 'n/a'

function App() {
  const [paneFocus, setPaneFocus] = useState<PaneFocus>('categories')
  const [categoryShelf, setCategoryShelf] = useState<CategoryShelf>('primary')
  const [primaryIndex, setPrimaryIndex] = useState(0)
  const [secondaryIndex, setSecondaryIndex] = useState(secondaryCategories.length ? 1 : 0)
  const [activeGroup, setActiveGroup] = useState(initialGroup)
  const [commandCursors, setCommandCursors] = useState<Record<string, number>>({})
  const [clock, setClock] = useState(() => formatClock(new Date()))
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findIndex, setFindIndex] = useState(0)
  const [preferredClientId, setPreferredClientId] = useState(() => readCookie(CLIENT_COOKIE_NAME) ?? DEFAULT_CLIENT_ID)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const deferredFindQuery = useDeferredValue(findQuery)

  const categoryMenu = categoryShelf === 'primary' ? primaryMenu : secondaryMenu
  const categoryIndex = categoryShelf === 'primary' ? primaryIndex : secondaryIndex
  const highlightedCategoryItem = categoryMenu[categoryIndex] ?? categoryMenu[0] ?? showMoreItem
  const currentCategory = categoryLookup[activeGroup] ?? primaryCategories[0] ?? categoryRecords[0] ?? null
  const currentCommands = commandsByGroup[activeGroup] ?? []
  const currentCommandIndex = clampIndex(commandCursors[activeGroup] ?? 0, currentCommands.length)
  const selectedCommand = currentCommands[currentCommandIndex] ?? null
  const commandDetail = selectedCommand
    ? commandDetailCatalog[selectedCommand.slug] ??
      buildFallbackDetail(selectedCommand, currentCategory?.label ?? 'Redis')
    : null
  const categoryWindow = windowSlice(categoryMenu, categoryIndex, CATEGORY_ROWS)
  const commandWindow = windowSlice(currentCommands, currentCommandIndex, COMMAND_ROWS)
  const previewArguments = commandDetail?.arguments.slice(0, ARGUMENT_ROWS) ?? []
  const extraArgumentCount = Math.max((commandDetail?.arguments.length ?? 0) - previewArguments.length, 0)
  const detailIntroBlocks: ExcerptBlock[] = commandDetail
    ? extractExcerptBlocks(
        commandDetail.intro || commandDetail.description || selectedCommand?.description || '',
        5,
        980,
      )
    : fallbackIntroBlocks
  const detailNotes = commandDetail?.notes ?? []
  const exampleCard = getExampleCard(commandDetail, selectedCommand)
  const availableClientOptions = getClientOptions(commandDetail)
  const preferredClient = getClientOptionById(preferredClientId)
  const selectedClientOption =
    availableClientOptions.find((option) => option.id === preferredClientId) ?? availableClientOptions[0]
  const headerClientOption = commandDetail ? selectedClientOption : preferredClient
  const selectedApiMethods =
    commandDetail && selectedClientOption.id !== DEFAULT_CLIENT_ID
      ? commandDetail.apiMethods[selectedClientOption.id] ?? []
      : []
  const visibleApiMethods = selectedApiMethods.slice(0, API_METHOD_LIMIT)
  const hiddenApiMethodCount = Math.max(selectedApiMethods.length - visibleApiMethods.length, 0)
  const categoryAccent = highlightedCategoryItem.accent
  const currentAccent = currentCategory?.accent ?? '#ff4438'
  const docsUrl =
    commandDetail?.docsUrl ??
    (selectedCommand
      ? resolveRedisHref(commandIndex.sourceUrl, `./${selectedCommand.slug}/`)
      : commandIndex.sourceUrl)
  const categoryPanelTitle = categoryShelf === 'primary' ? 'Core' : 'More'
  const commandPanelTitle = currentCategory?.label ?? 'Commands'
  const detailPanelTitle = selectedCommand?.title ?? 'Dossier'
  const categoryPanelStyle = { '--panel-accent': categoryAccent } as CSSProperties
  const commandPanelStyle = { '--panel-accent': currentAccent } as CSSProperties
  const detailPanelStyle = { '--panel-accent': currentAccent } as CSSProperties
  const headerStyle = { '--brand-accent': currentAccent } as CSSProperties
  const findResults = getCommandSearchResults(commandIndex.commands, deferredFindQuery, FIND_RESULT_LIMIT)
  const activeFindIndex = clampIndex(findIndex, findResults.length)
  const highlightedFindResult = findResults[activeFindIndex] ?? null
  const findCompletionTail = getCompletionTail(findQuery, highlightedFindResult)

  useEffect(() => {
    writeCookie(CLIENT_COOKIE_NAME, preferredClientId)
  }, [preferredClientId])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClock(formatClock(new Date()))
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!findOpen) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      findInputRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [findOpen])

  useEffect(() => {
    const pageTitle = selectedCommand
      ? `${selectedCommand.title} // Redis Commander`
      : currentCategory
        ? `${currentCategory.label} // Redis Commander`
        : 'Redis Commander'

    document.title = pageTitle
  }, [currentCategory, selectedCommand])

  function openCoreShelf() {
    if (!primaryCategories.length) {
      return
    }

    const primaryMatch = primaryCategories.findIndex((category) => category.group === activeGroup)
    const nextIndex = primaryMatch >= 0 ? primaryMatch : 0
    const nextGroup = primaryCategories[nextIndex]?.group ?? activeGroup

    startTransition(() => {
      setCategoryShelf('primary')
      setPrimaryIndex(nextIndex)
      setActiveGroup(nextGroup)
      setPaneFocus('categories')
    })
  }

  function openMoreShelf() {
    if (!secondaryCategories.length) {
      return
    }

    const secondaryMatch = secondaryCategories.findIndex((category) => category.group === activeGroup)
    const nextCategoryIndex = secondaryMatch >= 0 ? secondaryMatch : 0
    const nextMenuIndex = nextCategoryIndex + 1
    const nextGroup = secondaryCategories[nextCategoryIndex]?.group ?? activeGroup

    startTransition(() => {
      setCategoryShelf('secondary')
      setSecondaryIndex(nextMenuIndex)
      setActiveGroup(nextGroup)
      setPaneFocus('categories')
    })
  }

  function openFindPalette() {
    setFindOpen(true)
    setFindQuery('')
    setFindIndex(0)
  }

  function closeFindPalette() {
    setFindOpen(false)
    setFindQuery('')
    setFindIndex(0)
  }

  function setCategoryCursor(nextIndex: number, shelf: CategoryShelf = categoryShelf) {
    const menu = shelf === 'primary' ? primaryMenu : secondaryMenu
    if (!menu.length) {
      return
    }

    const safeIndex = clampIndex(nextIndex, menu.length)
    const item = menu[safeIndex]

    if (shelf === 'primary') {
      setPrimaryIndex(safeIndex)
    } else {
      setSecondaryIndex(safeIndex)
    }

    if (item.kind === 'category') {
      setActiveGroup(item.group)
    }
  }

  function moveCategoryCursor(delta: number) {
    setCategoryCursor(categoryIndex + delta)
  }

  function jumpCategoryCursor(position: 'start' | 'end') {
    setCategoryCursor(position === 'start' ? 0 : categoryMenu.length - 1)
  }

  function activateHighlightedCategory() {
    if (highlightedCategoryItem.kind === 'more') {
      openMoreShelf()
      return
    }

    if (highlightedCategoryItem.kind === 'back') {
      openCoreShelf()
      return
    }

    setPaneFocus('commands')
  }

  function activateCategoryItem(item: CategoryBrowserItem) {
    if (item.kind === 'more') {
      openMoreShelf()
      return
    }

    if (item.kind === 'back') {
      openCoreShelf()
      return
    }

    setActiveGroup(item.group)
    setPaneFocus('commands')
  }

  function setCommandCursor(nextIndex: number) {
    if (!currentCommands.length) {
      return
    }

    const safeIndex = clampIndex(nextIndex, currentCommands.length)
    setCommandCursors((previous) => ({
      ...previous,
      [activeGroup]: safeIndex,
    }))
  }

  function moveCommandCursor(delta: number) {
    setCommandCursor(currentCommandIndex + delta)
  }

  function jumpCommandCursor(position: 'start' | 'end') {
    setCommandCursor(position === 'start' ? 0 : currentCommands.length - 1)
  }

  function moveFocus(delta: number) {
    const order: PaneFocus[] = ['categories', 'commands', 'details']
    const currentIndex = order.indexOf(paneFocus)
    const maxIndex = selectedCommand ? order.length - 1 : 1
    const nextIndex = Math.min(Math.max(currentIndex + delta, 0), maxIndex)
    setPaneFocus(order[nextIndex])
  }

  function advanceFocus() {
    if (paneFocus === 'categories') {
      activateHighlightedCategory()
      return
    }

    if (paneFocus === 'commands') {
      if (selectedCommand) {
        setPaneFocus('details')
      }
      return
    }

    openOfficialDocs()
  }

  function revealCommand(command: CommandSummary) {
    const groupCommands = commandsByGroup[command.group] ?? []
    const nextCommandIndex = groupCommands.findIndex((entry) => entry.slug === command.slug)
    const nextPrimaryIndex = primaryCategories.findIndex((category) => category.group === command.group)
    const nextSecondaryIndex = secondaryCategories.findIndex((category) => category.group === command.group)

    startTransition(() => {
      if (nextPrimaryIndex >= 0) {
        setCategoryShelf('primary')
        setPrimaryIndex(nextPrimaryIndex)
      } else if (nextSecondaryIndex >= 0) {
        setCategoryShelf('secondary')
        setSecondaryIndex(nextSecondaryIndex + 1)
      }

      if (nextCommandIndex >= 0) {
        setCommandCursors((previous) => ({
          ...previous,
          [command.group]: nextCommandIndex,
        }))
      }

      setActiveGroup(command.group)
      setPaneFocus('details')
      setFindOpen(false)
      setFindQuery('')
      setFindIndex(0)
    })
  }

  function commitFindSelection(command: CommandSummary | null) {
    if (!command) {
      return
    }

    revealCommand(command)
  }

  function resolveReferencedCommand(label: string, target: string) {
    const normalizedTarget = target.trim()
    const slugMatch =
      /\/commands\/([^/#?]+)\/?/i.exec(normalizedTarget) ?? /^\.\/([^/#?]+)\/?$/i.exec(normalizedTarget)

    if (slugMatch) {
      return commandReferenceLookup.get(normalizeCommandSearchValue(slugMatch[1])) ?? null
    }

    return commandReferenceLookup.get(normalizeCommandSearchValue(label)) ?? null
  }

  function renderRichParagraph(paragraph: string, keyPrefix: string) {
    const content = cleanupInlineMarkdown(paragraph)
    const tokenPattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]*)\)/g
    const nodes: ReactNode[] = []
    let cursor = 0

    for (const match of content.matchAll(tokenPattern)) {
      const index = match.index ?? 0

      if (index > cursor) {
        nodes.push(content.slice(cursor, index))
      }

      if (match[1]) {
        nodes.push(
          <code className="dossier__inline-code" key={`${keyPrefix}-code-${index}`}>
            {match[1]}
          </code>,
        )
      } else {
        const label = cleanupInlineMarkdown(match[2] ?? '').replace(/`/g, '').trim()
        const target = match[3] ?? ''
        const linkedCommand = resolveReferencedCommand(label, target)

        if (linkedCommand) {
          nodes.push(
            <button
              className="dossier__inline-link"
              key={`${keyPrefix}-link-${index}`}
              onClick={() => revealCommand(linkedCommand)}
              tabIndex={-1}
              type="button"
            >
              {label}
            </button>,
          )
        } else {
          nodes.push(label)
        }
      }

      cursor = index + match[0].length
    }

    if (cursor < content.length) {
      nodes.push(content.slice(cursor))
    }

    return nodes
  }

  function renderRichBlock(block: ExcerptBlock, keyPrefix: string, kind: 'intro' | 'note') {
    if (block.kind === 'list') {
      const itemClass = kind === 'intro' ? 'dossier__intro-list-item' : 'dossier__note-list-item'

      return (
        <div className="dossier__inline-list" key={keyPrefix}>
          {block.items.map((item, itemIndex) => (
            <p className={itemClass} key={`${keyPrefix}-item-${itemIndex}`}>
              {renderRichParagraph(item, `${keyPrefix}-item-${itemIndex}`)}
            </p>
          ))}
        </div>
      )
    }

    return kind === 'intro' ? (
      <p className="dossier__intro-copy" key={keyPrefix}>
        {renderRichParagraph(block.text, keyPrefix)}
      </p>
    ) : (
      <p className="dossier__note-copy" key={keyPrefix}>
        {renderRichParagraph(block.text, keyPrefix)}
      </p>
    )
  }

  function goBack() {
    if (paneFocus === 'details') {
      setPaneFocus('commands')
      return
    }

    if (paneFocus === 'commands') {
      setPaneFocus('categories')
      return
    }

    if (categoryShelf === 'secondary') {
      openCoreShelf()
    }
  }

  function openOfficialDocs() {
    if (!selectedCommand) {
      return
    }

    window.open(docsUrl, '_blank', 'noopener,noreferrer')
  }

  function openRepository() {
    window.open(REPO_URL, '_blank', 'noopener,noreferrer')
  }

  function shiftClientSelection(delta: number) {
    if (availableClientOptions.length <= 1) {
      return
    }

    const currentIndex = availableClientOptions.findIndex((option) => option.id === selectedClientOption.id)
    const nextIndex = wrapIndex(currentIndex + delta, availableClientOptions.length)
    const nextClient = availableClientOptions[nextIndex]

    if (nextClient) {
      setPreferredClientId(nextClient.id)
    }
  }

  function handleFindKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeFindPalette()
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'Tab') {
      event.preventDefault()
      if (findResults.length) {
        setFindIndex((previous) => clampIndex(previous + 1, findResults.length))
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (findResults.length) {
        setFindIndex((previous) => clampIndex(previous - 1, findResults.length))
      }
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setFindIndex(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      if (findResults.length) {
        setFindIndex(findResults.length - 1)
      }
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      commitFindSelection(highlightedFindResult)
    }
  }

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return
    }

    const target = event.target as HTMLElement | null
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return
    }

    if (findOpen) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeFindPalette()
      }

      return
    }

    if (event.key === 'F1') {
      event.preventDefault()
      openCoreShelf()
      return
    }

    if (event.key === 'F2') {
      event.preventDefault()
      setPaneFocus('commands')
      return
    }

    if (event.key === 'F3') {
      event.preventDefault()
      if (selectedCommand) {
        setPaneFocus('details')
      }
      return
    }

    if (event.key === 'F4') {
      event.preventDefault()
      openMoreShelf()
      return
    }

    if (event.key === 'F5') {
      event.preventDefault()
      openOfficialDocs()
      return
    }

    if (event.key === 'F10') {
      event.preventDefault()
      openRepository()
      return
    }

    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault()
      openFindPalette()
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      moveFocus(event.shiftKey ? -1 : 1)
      return
    }

    if (event.key === 'Escape' || event.key === 'Backspace') {
      event.preventDefault()
      goBack()
      return
    }

    if (event.key === 'o' || event.key === 'O') {
      event.preventDefault()
      openOfficialDocs()
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveFocus(-1)
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveFocus(1)
      return
    }

    if (paneFocus === 'categories') {
      if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        moveCategoryCursor(-1)
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        moveCategoryCursor(1)
        return
      }

      if (event.key === 'PageUp') {
        event.preventDefault()
        moveCategoryCursor(-5)
        return
      }

      if (event.key === 'PageDown') {
        event.preventDefault()
        moveCategoryCursor(5)
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        jumpCategoryCursor('start')
        return
      }

      if (event.key === 'End') {
        event.preventDefault()
        jumpCategoryCursor('end')
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        advanceFocus()
      }

      return
    }

    if (paneFocus === 'commands') {
      if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault()
        moveCommandCursor(-1)
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault()
        moveCommandCursor(1)
        return
      }

      if (event.key === 'PageUp') {
        event.preventDefault()
        moveCommandCursor(-8)
        return
      }

      if (event.key === 'PageDown') {
        event.preventDefault()
        moveCommandCursor(8)
        return
      }

      if (event.key === 'Home') {
        event.preventDefault()
        jumpCommandCursor('start')
        return
      }

      if (event.key === 'End') {
        event.preventDefault()
        jumpCommandCursor('end')
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        advanceFocus()
      }

      return
    }

    if (paneFocus === 'details') {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        shiftClientSelection(-1)
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        shiftClientSelection(1)
        return
      }
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      advanceFocus()
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const footerStatus = [
    { label: 'FOCUS', value: paneFocus.toUpperCase() },
    { label: 'SHELF', value: categoryShelf.toUpperCase() },
    { label: 'CAT', value: formatCounter(categoryIndex + 1, categoryMenu.length) },
    { label: 'CMD', value: formatCounter(selectedCommand ? currentCommandIndex + 1 : 0, currentCommands.length) },
  ]

  const footerButtons = [
    {
      action: openCoreShelf,
      disabled: !primaryCategories.length,
      hotkey: 'F1',
      label: 'Core',
    },
    {
      action: () => setPaneFocus('commands'),
      disabled: !currentCommands.length,
      hotkey: 'F2',
      label: 'Commands',
    },
    {
      action: () => selectedCommand && setPaneFocus('details'),
      disabled: !selectedCommand,
      hotkey: 'F3',
      label: 'Dossier',
    },
    {
      action: openMoreShelf,
      disabled: !secondaryCategories.length,
      hotkey: 'F4',
      label: 'More',
    },
    {
      action: openOfficialDocs,
      disabled: !selectedCommand,
      hotkey: 'F5',
      label: 'Docs',
    },
    ...(paneFocus === 'details'
      ? [
          {
            action: () => shiftClientSelection(1),
            disabled: availableClientOptions.length <= 1,
            hotkey: 'UP/DN',
            label: 'Select client',
          },
        ]
      : []),
    {
      action: openFindPalette,
      disabled: false,
      hotkey: 'F',
      label: 'Find',
    },
    {
      action: () => moveFocus(1),
      disabled: false,
      hotkey: 'TAB',
      label: 'Pane',
    },
    {
      action: openRepository,
      disabled: false,
      hotkey: 'F10',
      label: 'GitHub',
    },
  ]

  return (
    <main className="shell">
      <div aria-hidden="true" className="shell__scanlines" />

      <header className="dos-header" style={headerStyle}>
        <div className="dos-header__status">
          <span className="dos-header__brand">Redis Commander</span>
          <span>{commandIndex.commandCount} commands</span>
          <span>snapshot {docsSnapshotLabel}</span>
          <span>Client: {headerClientOption.label}</span>
          <time className="dos-header__clock">{clock}</time>
          <button className="dos-header__link" onClick={openRepository} type="button">
            version {RELEASE_VERSION}
          </button>
        </div>
      </header>

      <section className="workspace">
        <section
          className={`dos-panel ${paneFocus === 'categories' ? 'dos-panel--focus' : ''}`}
          style={categoryPanelStyle}
        >
          <div className="dos-panel__bar">
            <span>{categoryPanelTitle}</span>
            <span>{formatCounter(categoryIndex + 1, categoryMenu.length)}</span>
          </div>

          <div className="dos-panel__body">
            <div className="dos-list" role="listbox" aria-label="Redis command categories">
              {Array.from({ length: CATEGORY_ROWS }, (_, rowIndex) => {
                const item = categoryWindow.items[rowIndex]
                if (!item) {
                  return <div aria-hidden="true" className="dos-row dos-row--empty" key={`category-empty-${rowIndex}`} />
                }

                const actualIndex = categoryWindow.start + rowIndex
                const active = actualIndex === categoryIndex
                const countLabel =
                  item.kind === 'category'
                    ? String(item.count).padStart(3, '0')
                    : item.kind === 'more'
                      ? `${String(secondaryCategories.length).padStart(2, '0')}+`
                      : 'UP'

                return (
                  <button
                    className={`dos-row ${active ? 'dos-row--active' : ''}`}
                    key={`${item.kind}-${item.label}`}
                    onClick={() => {
                      setPaneFocus('categories')
                      setCategoryCursor(actualIndex)
                    }}
                    onDoubleClick={() => {
                      setPaneFocus('categories')
                      setCategoryCursor(actualIndex)
                      activateCategoryItem(item)
                    }}
                    type="button"
                  >
                    <span className="dos-row__index">
                      {item.kind === 'back' ? '..' : String(actualIndex + 1).padStart(2, '0')}
                    </span>
                    {active ? (
                      <ShuffleText
                        animateKey={`category:${categoryShelf}:${actualIndex}:${item.label}`}
                        className="dos-row__label"
                        text={item.label}
                      />
                    ) : (
                      <span className="dos-row__label">{item.label}</span>
                    )}
                    <span className="dos-row__meta">{countLabel}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="dos-panel__footer">
            <span>{highlightedCategoryItem.label}</span>
            <span>
              {highlightedCategoryItem.kind === 'category'
                ? formatCount(highlightedCategoryItem.count)
                : `${secondaryCategories.length} extra groups`}
            </span>
            <span className="dos-panel__footer-copy">{highlightedCategoryItem.tagline}</span>
          </div>
        </section>

        <section
          className={`dos-panel ${paneFocus === 'commands' ? 'dos-panel--focus' : ''}`}
          style={commandPanelStyle}
        >
          <div className="dos-panel__bar">
            <span>{commandPanelTitle}</span>
            <span>{formatCounter(selectedCommand ? currentCommandIndex + 1 : 0, currentCommands.length)}</span>
          </div>

          <div className="dos-panel__body">
            <div className="dos-list" role="listbox" aria-label={`${currentCategory?.label ?? 'Redis'} commands`}>
              {Array.from({ length: COMMAND_ROWS }, (_, rowIndex) => {
                const command = commandWindow.items[rowIndex]
                if (!command) {
                  return <div aria-hidden="true" className="dos-row dos-row--empty" key={`command-empty-${rowIndex}`} />
                }

                const actualIndex = commandWindow.start + rowIndex
                const active = actualIndex === currentCommandIndex

                return (
                  <button
                    className={`dos-row ${active ? 'dos-row--active' : ''}`}
                    key={command.slug}
                    onClick={() => {
                      setPaneFocus('commands')
                      setCommandCursor(actualIndex)
                    }}
                    onDoubleClick={() => {
                      setPaneFocus('details')
                      setCommandCursor(actualIndex)
                    }}
                    type="button"
                  >
                    <span className="dos-row__index">{String(actualIndex + 1).padStart(2, '0')}</span>
                    {active ? (
                      <ShuffleText
                        animateKey={`command:${command.slug}:${actualIndex}`}
                        className="dos-row__label"
                        text={command.title}
                      />
                    ) : (
                      <span className="dos-row__label">{command.title}</span>
                    )}
                    <span className="dos-row__meta">{command.since ?? 'docs'}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="dos-panel__footer">
            <span>{selectedCommand?.title ?? 'No command selected'}</span>
            <span>
              {selectedCommand
                ? `since ${selectedCommand.since ?? 'n/a'} / arity ${formatArity(selectedCommand.arity)}`
                : 'Select a category to browse'}
            </span>
            <span className="dos-panel__footer-copy">
              {selectedCommand?.description || currentCategory?.tagline || 'Redis command explorer'}
            </span>
          </div>
        </section>

        <div className="workspace__right">
          <section
            className={`dos-panel ${paneFocus === 'details' ? 'dos-panel--focus' : ''}`}
            style={detailPanelStyle}
          >
            <div className="dos-panel__bar">
              <span>{detailPanelTitle}</span>
              <span>{selectedCommand ? 'Docs' : ''}</span>
            </div>

            <div className="dos-panel__body">
              <div className="dossier">
                <div className="dossier__hero">
                  <div className="dossier__hero-top">
                    <h1 className="dossier__title">{selectedCommand?.title ?? 'NO COMMAND SELECTED'}</h1>
                    <span className="dossier__complexity">
                      {selectedCommand?.complexity ?? 'complexity n/a'}
                    </span>
                  </div>
                  <code className="dossier__syntax">
                    {selectedCommand?.syntax ?? 'Choose a Redis command from the middle pane.'}
                  </code>
                  <div className="dossier__intro">
                    {detailIntroBlocks.map((block, blockIndex) =>
                      renderRichBlock(
                        block,
                        `${selectedCommand?.slug ?? 'detail'}-intro-${blockIndex}`,
                        'intro',
                      ),
                    )}
                  </div>
                </div>

                <div className="dossier__body dossier__body--simple">
                  <div className="dossier__stack">
                    <section className="dossier__card dossier__card--example">
                      <div className="dossier__card-bar">{selectedClientOption.label}</div>
                      {selectedClientOption.id === DEFAULT_CLIENT_ID ? (
                        <div className="dossier__example">
                          <pre className="dossier__example-code">{exampleCard.content}</pre>
                        </div>
                      ) : (
                        <div className="dossier__api">
                          {visibleApiMethods.length ? (
                            <>
                              {visibleApiMethods.map((method, methodIndex) => {
                                const lines = buildApiMethodLines(method)

                                return (
                                  <article
                                    className="dossier__api-method"
                                    key={`${selectedCommand?.slug ?? 'client'}-${selectedClientOption.id}-${methodIndex}-${method.signature}`}
                                  >
                                    <pre className="dossier__api-code">
                                      {lines.map((line, lineIndex) => (
                                        <span
                                          className="dossier__api-line"
                                          key={`${selectedClientOption.id}-${methodIndex}-line-${lineIndex}`}
                                        >
                                          {line.map((token, tokenIndex) => (
                                            <span
                                              className={`dossier__api-token dossier__api-token--${token.kind}`}
                                              key={`${selectedClientOption.id}-${methodIndex}-line-${lineIndex}-token-${tokenIndex}`}
                                            >
                                              {token.text}
                                            </span>
                                          ))}
                                          {lineIndex < lines.length - 1 ? '\n' : null}
                                        </span>
                                      ))}
                                    </pre>
                                  </article>
                                )
                              })}
                              {hiddenApiMethodCount ? (
                                <div className="dossier__api-more">+{hiddenApiMethodCount} more overloads in the official docs</div>
                              ) : null}
                            </>
                          ) : (
                            <div className="dossier__api-empty">
                              No API methods are mapped for this client in the local Redis docs mirror.
                            </div>
                          )}
                        </div>
                      )}
                    </section>

                    {detailNotes.length ? (
                      <section className="dossier__card dossier__card--note">
                        <div className="dossier__card-bar">Note</div>
                        <div className="dossier__notes">
                          {detailNotes.map((note, noteIndex) => (
                            <div className="dossier__note-block" key={`${selectedCommand?.slug ?? 'detail'}-note-${noteIndex}`}>
                              {extractExcerptBlocks(note, 3, 420).map((block, blockIndex) =>
                                renderRichBlock(
                                  block,
                                  `${selectedCommand?.slug ?? 'detail'}-note-${noteIndex}-${blockIndex}`,
                                  'note',
                                ),
                              )}
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </div>

                  <section className="dossier__card">
                    <div className="dossier__card-bar">Arguments</div>
                    <div className="dossier__arguments">
                      {previewArguments.length ? (
                        <>
                          {previewArguments.map((argument) => (
                            <div className="dossier__argument" key={`${argument.name}-${argument.type}`}>
                              <span className="dossier__argument-name">{formatArgumentLabel(argument)}</span>
                              <span className="dossier__argument-meta">
                                {argument.type}
                                {argument.optional ? ' / optional' : ' / required'}
                              </span>
                            </div>
                          ))}
                          {extraArgumentCount ? (
                            <div className="dossier__argument dossier__argument--more">
                              <span className="dossier__argument-name">+{extraArgumentCount} more</span>
                              <span className="dossier__argument-meta">open docs for the full argument tree</span>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="dossier__argument dossier__argument--more">
                          <span className="dossier__argument-name">No explicit arguments in cache</span>
                          <span className="dossier__argument-meta">see the official docs for the full argument tree</span>
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </div>

            <div className="dos-panel__footer dos-panel__footer--compact">
              <span />
              <span>{paneFocus === 'details' ? 'ENTER opens docs' : ''}</span>
            </div>
          </section>

          <AsciiArtPane
            accent={currentAccent}
            group={currentCategory?.group ?? 'archive'}
            label={currentCategory?.artLabel ?? currentCategory?.label ?? 'Redis'}
          />
        </div>
      </section>

      {findOpen ? (
        <div className="find-overlay" onClick={closeFindPalette} role="presentation">
          <section
            aria-label="Find Redis command"
            aria-modal="true"
            className="find-palette"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            style={detailPanelStyle}
          >
            <div className="find-palette__bar">
              <span>Find Command</span>
              <span>{formatCounter(activeFindIndex + 1, findResults.length)}</span>
            </div>

            <div className="find-palette__input-shell">
              <span className="find-palette__prompt">C:&gt;</span>

              <div className="find-palette__input-track">
                <span aria-hidden="true" className="find-palette__completion">
                  <span className="find-palette__typed">{findQuery}</span>
                  <span className="find-palette__ghost">{findCompletionTail}</span>
                </span>

                <input
                  autoCapitalize="off"
                  autoComplete="off"
                  autoCorrect="off"
                  className="find-palette__input"
                  onChange={(event) => {
                    setFindQuery(event.target.value)
                    setFindIndex(0)
                  }}
                  onKeyDown={handleFindKeyDown}
                  placeholder="type a Redis command"
                  ref={findInputRef}
                  spellCheck={false}
                  value={findQuery}
                />
              </div>
            </div>

            <div className="find-palette__results" role="listbox" aria-label="Command search results">
              {findResults.length ? (
                findResults.map((command, index) => {
                  const active = index === activeFindIndex

                  return (
                    <button
                      aria-selected={active}
                      className={`find-palette__result ${active ? 'find-palette__result--active' : ''}`}
                      key={command.slug}
                      onClick={() => commitFindSelection(command)}
                      onMouseEnter={() => setFindIndex(index)}
                      type="button"
                    >
                      <span className="find-palette__result-title">{command.title}</span>
                      <span className="find-palette__result-meta">{getCategoryMeta(command.group).label}</span>
                      <span className="find-palette__result-copy">
                        {command.description || command.syntax || 'Open the dossier to inspect this command.'}
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="find-palette__empty">
                  {findQuery.trim()
                    ? 'No cached Redis commands match that query.'
                    : 'Type a Redis verb, module prefix, or command fragment to jump straight into the dossier.'}
                </div>
              )}
            </div>

            <div className="find-palette__footer">
              <span>{highlightedFindResult?.syntax ?? 'Arrow keys move through the command matches.'}</span>
              <span>ENTER select / ESC close</span>
            </div>
          </section>
        </div>
      ) : null}

      <footer className="dos-footer">
        <div className="dos-footer__status">
          {footerStatus.map((item) => (
            <span className="dos-footer__token" key={item.label}>
              <strong>{item.label}</strong> {item.value}
            </span>
          ))}
        </div>

        <div className="dos-footer__keys">
          {footerButtons.map((button) => (
            <button
              className={`dos-key ${button.hotkey === 'TAB' ? 'dos-key--tab' : ''}`}
              disabled={button.disabled}
              key={button.hotkey}
              onClick={button.action}
              type="button"
            >
              <span className="dos-key__hotkey">{button.hotkey}</span>
              <span className="dos-key__label">{button.label}</span>
            </button>
          ))}
        </div>
      </footer>
    </main>
  )
}

export default App
