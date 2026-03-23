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
type MobileLayoutMode = 'desktop' | 'portrait' | 'landscape'
type MobileNavPane = 'categories' | 'commands'

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
const RELEASE_VERSION = '1.16'
const REPO_URL = 'https://github.com/itay-ct/RedisCommander'
const CLIENT_COOKIE_NAME = 'redis-commander-client'
const DEFAULT_CLIENT_ID = 'redis-cli'
const MOBILE_LAYOUT_MAX_WIDTH = 1024
const MOBILE_LANDSCAPE_MIN_WIDTH = 700
const MOBILE_SWIPE_THRESHOLD = 48

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

type ExcerptOptions = {
  stopAtHeading?: boolean
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

function getMobileLayoutMode(): MobileLayoutMode {
  if (typeof window === 'undefined') {
    return 'desktop'
  }

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  if (!coarsePointer || window.innerWidth > MOBILE_LAYOUT_MAX_WIDTH) {
    return 'desktop'
  }

  return window.innerWidth >= MOBILE_LANDSCAPE_MIN_WIDTH && window.innerWidth > window.innerHeight
    ? 'landscape'
    : 'portrait'
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

function extractExcerptBlocks(
  value: string,
  maxBlocks: number,
  maxChars: number,
  options: ExcerptOptions = {},
): ExcerptBlock[] {
  let normalizedValue = value
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (options.stopAtHeading) {
    const introLines: string[] = []

    for (const line of normalizedValue.split('\n')) {
      if (/^\s{0,3}#{2,6}\s+/.test(line)) {
        break
      }

      introLines.push(line)
    }

    normalizedValue = introLines.join('\n').trim()
  }

  const chunks = normalizedValue
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
  const [mobileLayout, setMobileLayout] = useState<MobileLayoutMode>(() => getMobileLayoutMode())
  const [mobileNavPane, setMobileNavPane] = useState<MobileNavPane>('categories')
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
  const [mobileClientPickerOpen, setMobileClientPickerOpen] = useState(false)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const activeCategoryRowRef = useRef<HTMLButtonElement | null>(null)
  const activeCommandRowRef = useRef<HTMLButtonElement | null>(null)
  const detailScrollRef = useRef<HTMLDivElement | null>(null)
  const swipeStateRef = useRef<{
    axis: 'x' | 'y' | null
    lastX: number
    lastY: number
    startX: number
    startY: number
  } | null>(null)
  const deferredFindQuery = useDeferredValue(findQuery)
  const isMobileLayout = mobileLayout !== 'desktop'
  const isMobilePortrait = mobileLayout === 'portrait'
  const isMobileLandscape = mobileLayout === 'landscape'

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
  const detailIntroBlocks: ExcerptBlock[] = commandDetail
    ? extractExcerptBlocks(
        commandDetail.intro || commandDetail.description || selectedCommand?.description || '',
        5,
        980,
        { stopAtHeading: true },
      )
    : fallbackIntroBlocks
  const detailIntroTextLength = detailIntroBlocks.reduce(
    (total, block) =>
      total + (block.kind === 'list' ? block.items.join(' ').length : block.text.length),
    0,
  )
  const detailIntroMaxHeight =
    detailIntroTextLength > 720 ? '15.5rem' : detailIntroTextLength > 520 ? '14rem' : detailIntroTextLength > 360 ? '12.5rem' : '10rem'
  const previewArgumentRows =
    detailIntroTextLength > 720 ? Math.max(3, ARGUMENT_ROWS - 2) : detailIntroTextLength > 520 ? ARGUMENT_ROWS - 1 : ARGUMENT_ROWS
  const previewArguments = commandDetail?.arguments.slice(0, previewArgumentRows) ?? []
  const extraArgumentCount = Math.max((commandDetail?.arguments.length ?? 0) - previewArguments.length, 0)
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
  const dossierStyle = { '--dossier-intro-max': detailIntroMaxHeight } as CSSProperties
  const headerStyle = { '--brand-accent': currentAccent } as CSSProperties
  const findResults = getCommandSearchResults(commandIndex.commands, deferredFindQuery, FIND_RESULT_LIMIT)
  const activeFindIndex = clampIndex(findIndex, findResults.length)
  const highlightedFindResult = findResults[activeFindIndex] ?? null
  const findCompletionTail = getCompletionTail(findQuery, highlightedFindResult)

  useEffect(() => {
    writeCookie(CLIENT_COOKIE_NAME, preferredClientId)
  }, [preferredClientId])

  useEffect(() => {
    const syncLayout = () => {
      setMobileLayout(getMobileLayoutMode())
    }

    syncLayout()
    window.addEventListener('resize', syncLayout)
    return () => window.removeEventListener('resize', syncLayout)
  }, [])

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

  useEffect(() => {
    if (!isMobileLayout) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      if (isMobileLandscape) {
        if (mobileNavPane === 'categories') {
          if (typeof activeCategoryRowRef.current?.scrollIntoView === 'function') {
            activeCategoryRowRef.current.scrollIntoView({ block: 'nearest' })
          }
        } else {
          if (typeof activeCommandRowRef.current?.scrollIntoView === 'function') {
            activeCommandRowRef.current.scrollIntoView({ block: 'nearest' })
          }
        }

        return
      }

      if (paneFocus === 'categories') {
        if (typeof activeCategoryRowRef.current?.scrollIntoView === 'function') {
          activeCategoryRowRef.current.scrollIntoView({ block: 'nearest' })
        }
        return
      }

      if (paneFocus === 'commands') {
        if (typeof activeCommandRowRef.current?.scrollIntoView === 'function') {
          activeCommandRowRef.current.scrollIntoView({ block: 'nearest' })
        }
        return
      }

      if (typeof detailScrollRef.current?.scrollTo === 'function') {
        detailScrollRef.current.scrollTo({ top: 0 })
      }
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [
    categoryIndex,
    categoryShelf,
    currentCommandIndex,
    isMobileLandscape,
    isMobileLayout,
    mobileNavPane,
    paneFocus,
    selectedCommand?.slug,
  ])

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
      setMobileNavPane('categories')
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
      setMobileNavPane('categories')
      setPaneFocus('categories')
    })
  }

  function openFindPalette() {
    setMobileClientPickerOpen(false)
    setFindOpen(true)
    setFindQuery('')
    setFindIndex(0)
  }

  function closeFindPalette() {
    setFindOpen(false)
    setFindQuery('')
    setFindIndex(0)
  }

  function setMobileTab(nextPane: PaneFocus) {
    if (nextPane === 'commands' && !currentCommands.length) {
      return
    }

    if (nextPane === 'details' && !selectedCommand) {
      return
    }

    if (isMobileLandscape) {
      if (nextPane === 'categories' || nextPane === 'commands') {
        setMobileNavPane(nextPane)
      }
    }

    setMobileClientPickerOpen(false)
    setPaneFocus(nextPane)
  }

  function shiftMobilePane(delta: number) {
    const order: PaneFocus[] = selectedCommand
      ? ['categories', 'commands', 'details']
      : currentCommands.length
        ? ['categories', 'commands']
        : ['categories']

    const currentIndex = order.indexOf(paneFocus)
    const nextIndex = clampIndex(currentIndex + delta, order.length)
    const nextPane = order[nextIndex]

    if (nextPane) {
      setMobileTab(nextPane)
    }
  }

  function handleMobileSwipeStart(event: React.TouchEvent<HTMLElement>) {
    if (!isMobilePortrait || findOpen) {
      return
    }

    const touch = event.touches[0]
    if (!touch) {
      return
    }

    swipeStateRef.current = {
      axis: null,
      lastX: touch.clientX,
      lastY: touch.clientY,
      startX: touch.clientX,
      startY: touch.clientY,
    }
  }

  function handleMobileSwipeMove(event: React.TouchEvent<HTMLElement>) {
    const state = swipeStateRef.current
    if (!state || !isMobilePortrait || findOpen) {
      return
    }

    const touch = event.touches[0]
    if (!touch) {
      return
    }

    state.lastX = touch.clientX
    state.lastY = touch.clientY

    const deltaX = touch.clientX - state.startX
    const deltaY = touch.clientY - state.startY

    if (!state.axis) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) {
        return
      }

      state.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y'
    }

    if (state.axis === 'x') {
      event.preventDefault()
    }
  }

  function handleMobileSwipeEnd() {
    const state = swipeStateRef.current
    swipeStateRef.current = null

    if (!state || !isMobilePortrait || findOpen || state.axis !== 'x') {
      return
    }

    const deltaX = state.lastX - state.startX
    const deltaY = state.lastY - state.startY

    if (
      Math.abs(deltaX) < MOBILE_SWIPE_THRESHOLD ||
      Math.abs(deltaX) <= Math.abs(deltaY) * 1.2
    ) {
      return
    }

    shiftMobilePane(deltaX < 0 ? 1 : -1)
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
      setMobileNavPane('commands')
      setPaneFocus('details')
      setMobileClientPickerOpen(false)
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
            <div className={itemClass} key={`${keyPrefix}-item-${itemIndex}`}>
              <span aria-hidden="true" className="dossier__list-bullet">
                &gt;
              </span>
              <span className="dossier__list-copy">
                {renderRichParagraph(item, `${keyPrefix}-item-${itemIndex}`)}
              </span>
            </div>
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

  const mobileToolbarTab = isMobileLandscape
    ? paneFocus === 'details'
      ? 'details'
      : mobileNavPane
    : paneFocus

  function renderCategoryRows(mobile = false) {
    const items = mobile ? categoryMenu : categoryWindow.items
    const totalRows = mobile ? items.length : CATEGORY_ROWS

    return (
      <div className={`dos-list ${mobile ? 'dos-list--mobile' : ''}`} role="listbox" aria-label="Redis command categories">
        {Array.from({ length: totalRows }, (_, rowIndex) => {
          const item = items[rowIndex]
          if (!item) {
            return mobile ? null : <div aria-hidden="true" className="dos-row dos-row--empty" key={`category-empty-${rowIndex}`} />
          }

          const actualIndex = mobile ? rowIndex : categoryWindow.start + rowIndex
          const active = actualIndex === categoryIndex
          const countLabel =
            item.kind === 'category'
              ? String(item.count).padStart(3, '0')
              : item.kind === 'more'
                ? `${String(secondaryCategories.length).padStart(2, '0')}+`
                : 'UP'

          return (
            <button
              className={`dos-row ${mobile ? 'dos-row--touch' : ''} ${active ? 'dos-row--active' : ''}`}
              key={`${item.kind}-${item.label}`}
              onClick={() => {
                setCategoryCursor(actualIndex)

                if (mobile) {
                  setMobileClientPickerOpen(false)
                  setMobileNavPane(item.kind === 'category' ? 'commands' : 'categories')
                  activateCategoryItem(item)
                  return
                }

                setPaneFocus('categories')
              }}
              onDoubleClick={
                mobile
                  ? undefined
                  : () => {
                      setPaneFocus('categories')
                      setCategoryCursor(actualIndex)
                      activateCategoryItem(item)
                    }
              }
              ref={mobile && active ? activeCategoryRowRef : undefined}
              type="button"
            >
              <span className="dos-row__index">
                {item.kind === 'back' ? '..' : String(actualIndex + 1).padStart(2, '0')}
              </span>
              {active && !mobile ? (
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
    )
  }

  function renderCommandRows(mobile = false) {
    const items = mobile ? currentCommands : commandWindow.items
    const totalRows = mobile ? items.length : COMMAND_ROWS

    return (
      <div className={`dos-list ${mobile ? 'dos-list--mobile' : ''}`} role="listbox" aria-label={`${currentCategory?.label ?? 'Redis'} commands`}>
        {Array.from({ length: totalRows }, (_, rowIndex) => {
          const command = items[rowIndex]
          if (!command) {
            return mobile ? null : <div aria-hidden="true" className="dos-row dos-row--empty" key={`command-empty-${rowIndex}`} />
          }

          const actualIndex = mobile ? rowIndex : commandWindow.start + rowIndex
          const active = actualIndex === currentCommandIndex

          return (
            <button
              className={`dos-row ${mobile ? 'dos-row--touch' : ''} ${active ? 'dos-row--active' : ''}`}
              key={command.slug}
              onClick={() => {
                setCommandCursor(actualIndex)

                if (mobile) {
                  setMobileClientPickerOpen(false)
                  setMobileNavPane('commands')
                  setMobileTab('details')
                  return
                }

                setPaneFocus('commands')
              }}
              onDoubleClick={
                mobile
                  ? undefined
                  : () => {
                      setPaneFocus('details')
                      setCommandCursor(actualIndex)
                    }
              }
              ref={mobile && active ? activeCommandRowRef : undefined}
              type="button"
            >
              <span className="dos-row__index">{String(actualIndex + 1).padStart(2, '0')}</span>
              {active && !mobile ? (
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
    )
  }

  function renderCategoryPanel(mobile = false) {
    return (
      <section
        className={`dos-panel ${mobile ? 'dos-panel--mobile' : ''} ${paneFocus === 'categories' ? 'dos-panel--focus' : ''}`}
        style={categoryPanelStyle}
      >
        <div className="dos-panel__bar">
          <span>{categoryPanelTitle}</span>
          <span>{formatCounter(categoryIndex + 1, categoryMenu.length)}</span>
        </div>

        <div className={`dos-panel__body ${mobile ? 'dos-panel__body--mobile-scroll' : ''}`}>
          {renderCategoryRows(mobile)}
        </div>

        <div className={`dos-panel__footer ${mobile ? 'dos-panel__footer--mobile' : ''}`}>
          <span>{highlightedCategoryItem.label}</span>
          <span>
            {highlightedCategoryItem.kind === 'category'
              ? formatCount(highlightedCategoryItem.count)
              : `${secondaryCategories.length} extra groups`}
          </span>
          <span className="dos-panel__footer-copy">{highlightedCategoryItem.tagline}</span>
        </div>
      </section>
    )
  }

  function renderCommandPanel(mobile = false) {
    return (
      <section
        className={`dos-panel ${mobile ? 'dos-panel--mobile' : ''} ${paneFocus === 'commands' ? 'dos-panel--focus' : ''}`}
        style={commandPanelStyle}
      >
        <div className="dos-panel__bar">
          <span>{commandPanelTitle}</span>
          <span>{formatCounter(selectedCommand ? currentCommandIndex + 1 : 0, currentCommands.length)}</span>
        </div>

        <div className={`dos-panel__body ${mobile ? 'dos-panel__body--mobile-scroll' : ''}`}>
          {renderCommandRows(mobile)}
        </div>

        <div className={`dos-panel__footer ${mobile ? 'dos-panel__footer--mobile' : ''}`}>
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
    )
  }

  function renderDetailPanel(mobile = false) {
    const showMobileClientPicker = mobile && availableClientOptions.length > 1

    return (
      <section
        className={`dos-panel ${mobile ? 'dos-panel--mobile' : ''} ${paneFocus === 'details' ? 'dos-panel--focus' : ''}`}
        style={detailPanelStyle}
      >
        <div className="dos-panel__bar">
          <span>{detailPanelTitle}</span>
          {mobile && selectedCommand ? (
            <button className="dos-panel__bar-action" onClick={openOfficialDocs} type="button">
              Docs
            </button>
          ) : (
            <span>{selectedCommand ? 'Docs' : ''}</span>
          )}
        </div>

        <div
          className={`dos-panel__body ${mobile ? 'dos-panel__body--mobile-scroll' : ''}`}
          ref={mobile ? detailScrollRef : undefined}
        >
          <div className={`dossier ${mobile ? 'dossier--mobile' : ''}`} style={dossierStyle}>
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
                  {showMobileClientPicker ? (
                    <>
                      <button
                        className={`dossier__card-bar dossier__card-bar--button ${mobileClientPickerOpen ? 'dossier__card-bar--open' : ''}`}
                        onClick={() => setMobileClientPickerOpen((previous) => !previous)}
                        type="button"
                      >
                        <span>{selectedClientOption.label}</span>
                        <span>{mobileClientPickerOpen ? 'Hide' : 'Client'}</span>
                      </button>
                      {mobileClientPickerOpen ? (
                        <div className="dossier__client-picker">
                          {availableClientOptions.map((option) => (
                            <button
                              className={`dossier__client-option ${option.id === selectedClientOption.id ? 'dossier__client-option--active' : ''}`}
                              key={option.id}
                              onClick={() => {
                                setPreferredClientId(option.id)
                                setMobileClientPickerOpen(false)
                              }}
                              type="button"
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="dossier__card-bar">{selectedClientOption.label}</div>
                  )}
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

        {mobile ? null : (
          <div className="dos-panel__footer dos-panel__footer--compact">
            <span />
            <span>{paneFocus === 'details' ? 'ENTER opens docs' : ''}</span>
          </div>
        )}
      </section>
    )
  }

  function renderLandscapeNavigationPanel() {
    const showingCategories = mobileNavPane === 'categories'
    const navCount = showingCategories
      ? formatCounter(categoryIndex + 1, categoryMenu.length)
      : formatCounter(selectedCommand ? currentCommandIndex + 1 : 0, currentCommands.length)

    return (
      <section
        className={`dos-panel dos-panel--mobile ${paneFocus !== 'details' ? 'dos-panel--focus' : ''}`}
        style={showingCategories ? categoryPanelStyle : commandPanelStyle}
      >
        <div className="dos-panel__bar dos-panel__bar--mobile-toggle">
          <div className="mobile-nav-toggle" role="tablist" aria-label="Mobile navigation pane">
            {(['categories', 'commands'] as const).map((pane) => (
              <button
                aria-selected={mobileNavPane === pane}
                className={`mobile-nav-toggle__button ${mobileNavPane === pane ? 'mobile-nav-toggle__button--active' : ''}`}
                key={pane}
                onClick={() => {
                  setMobileClientPickerOpen(false)
                  setMobileNavPane(pane)
                  setPaneFocus(pane)
                }}
                type="button"
              >
                {pane === 'categories' ? 'Categories' : 'Commands'}
              </button>
            ))}
          </div>
          <span>{navCount}</span>
        </div>

        <div className="dos-panel__body dos-panel__body--mobile-scroll">
          {showingCategories ? renderCategoryRows(true) : renderCommandRows(true)}
        </div>

        <div className="dos-panel__footer dos-panel__footer--mobile">
          {showingCategories ? (
            <>
              <span>{highlightedCategoryItem.label}</span>
              <span>
                {highlightedCategoryItem.kind === 'category'
                  ? formatCount(highlightedCategoryItem.count)
                  : `${secondaryCategories.length} extra groups`}
              </span>
              <span className="dos-panel__footer-copy">{highlightedCategoryItem.tagline}</span>
            </>
          ) : (
            <>
              <span>{selectedCommand?.title ?? 'No command selected'}</span>
              <span>
                {selectedCommand
                  ? `since ${selectedCommand.since ?? 'n/a'} / arity ${formatArity(selectedCommand.arity)}`
                  : 'Select a category to browse'}
              </span>
              <span className="dos-panel__footer-copy">
                {selectedCommand?.description || currentCategory?.tagline || 'Redis command explorer'}
              </span>
            </>
          )}
        </div>
      </section>
    )
  }

  return (
    <main
      className={`shell ${isMobileLayout ? `shell--mobile shell--mobile-${mobileLayout}` : ''}`}
    >
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

      {isMobileLayout ? (
        <>
          <section className="mobile-toolbar" style={headerStyle}>
            <div className="mobile-toolbar__banner">Experienced best on desktop</div>
            <div className="mobile-toolbar__controls">
              <div className="mobile-toolbar__tabs" role="tablist" aria-label="Mobile panes">
                {(['categories', 'commands', 'details'] as const).map((tab) => (
                  <button
                    aria-selected={mobileToolbarTab === tab}
                    className={`mobile-toolbar__tab ${mobileToolbarTab === tab ? 'mobile-toolbar__tab--active' : ''}`}
                    disabled={
                      (tab === 'commands' && !currentCommands.length) ||
                      (tab === 'details' && !selectedCommand)
                    }
                    key={tab}
                    onClick={() => setMobileTab(tab)}
                    type="button"
                  >
                    {tab === 'categories' ? 'Categories' : tab === 'commands' ? 'Commands' : 'Dossier'}
                  </button>
                ))}
              </div>

              <div className="mobile-toolbar__actions">
                <button className="mobile-toolbar__action" onClick={openFindPalette} type="button">
                  Find
                </button>
                {selectedCommand ? (
                  <button className="mobile-toolbar__action" onClick={openOfficialDocs} type="button">
                    Docs
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {isMobilePortrait ? (
            <section
              className="mobile-workspace mobile-workspace--portrait"
              onTouchEnd={handleMobileSwipeEnd}
              onTouchMove={handleMobileSwipeMove}
              onTouchStart={handleMobileSwipeStart}
            >
              {paneFocus === 'categories'
                ? renderCategoryPanel(true)
                : paneFocus === 'commands'
                  ? renderCommandPanel(true)
                  : renderDetailPanel(true)}
            </section>
          ) : (
            <section className="mobile-workspace mobile-workspace--landscape">
              <div className="mobile-workspace__nav">{renderLandscapeNavigationPanel()}</div>
              <div className="mobile-workspace__detail">{renderDetailPanel(true)}</div>
            </section>
          )}
        </>
      ) : (
        <section className="workspace">
          {renderCategoryPanel()}
          {renderCommandPanel()}

          <div className="workspace__right">
            {renderDetailPanel()}
            <AsciiArtPane
              accent={currentAccent}
              group={currentCategory?.group ?? 'archive'}
              label={currentCategory?.artLabel ?? currentCategory?.label ?? 'Redis'}
            />
          </div>
        </section>
      )}

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

      {isMobileLayout ? null : (
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
      )}
    </main>
  )
}

export default App
