import { startTransition, useEffect, useEffectEvent, useState, type CSSProperties } from 'react'

import { AsciiArtPane } from './components/AsciiArtPane'
import { ShuffleText } from './components/ShuffleText'
import commandIndexJson from './data/command-index.json'
import { commandDetailCatalog } from './data/loadCommandDetails'
import { PRIMARY_GROUPS, getCategoryMeta } from './lib/categoryMeta'
import { formatArity, formatCount, resolveRedisHref } from './lib/format'
import type {
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
const RELEASE_VERSION = '1.01'
const REPO_URL = 'https://github.com/itay-ct/RedisCommandTerminal'

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

function clampIndex(index: number, size: number) {
  if (size <= 0) {
    return 0
  }

  return Math.min(Math.max(index, 0), size - 1)
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

function makeExcerpt(value: string, maxLines: number, maxChars: number) {
  const lines = toPlainText(value)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const excerpt: string[] = []
  let total = 0

  for (const line of lines) {
    const nextTotal = total + line.length
    if (excerpt.length >= maxLines || nextTotal > maxChars) {
      break
    }

    excerpt.push(line)
    total = nextTotal
  }

  return excerpt.join('\n')
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
    arguments: [],
    arity: command.arity,
    codeExamples: [],
    commandFlags: [],
    complexity: command.complexity,
    content: command.description,
    description: command.description,
    docsUrl: resolveRedisHref(commandIndex.sourceUrl, `./${command.slug}/`),
    group: command.group,
    groupLabel,
    intro: command.description,
    keySpecs: [],
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

const commandsByGroup = buildCommandsByGroup(commandIndex.commands)
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
  const detailIntro = commandDetail
    ? makeExcerpt(
        commandDetail.intro || commandDetail.description || selectedCommand?.description || '',
        4,
        340,
      )
    : 'Select a command to open its local Redis transcript.'
  const exampleCard = getExampleCard(commandDetail, selectedCommand)
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

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClock(formatClock(new Date()))
    }, 1000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    const pageTitle = selectedCommand
      ? `${selectedCommand.title} // Redis DOS Terminal`
      : currentCategory
        ? `${currentCategory.label} // Redis DOS Terminal`
        : 'Redis DOS Terminal'

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

    if (event.key === 'F1') {
      event.preventDefault()
      openCoreShelf()
      return
    }

    if (event.key === 'F2') {
      event.preventDefault()
      openMoreShelf()
      return
    }

    if (event.key === 'F3') {
      event.preventDefault()
      setPaneFocus('commands')
      return
    }

    if (event.key === 'F4') {
      event.preventDefault()
      if (selectedCommand) {
        setPaneFocus('details')
      }
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
      action: openMoreShelf,
      disabled: !secondaryCategories.length,
      hotkey: 'F2',
      label: 'More',
    },
    {
      action: () => setPaneFocus('commands'),
      disabled: !selectedCommand,
      hotkey: 'F3',
      label: 'Commands',
    },
    {
      action: () => selectedCommand && setPaneFocus('details'),
      disabled: !selectedCommand,
      hotkey: 'F4',
      label: 'Dossier',
    },
    {
      action: openOfficialDocs,
      disabled: !selectedCommand,
      hotkey: 'F5',
      label: 'Docs',
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
        <div className="dos-header__menu">
          <div className="dos-menu" aria-label="Terminal menu">
            <span className="dos-menu__item">
              <strong>R</strong>edis
            </span>
            <span className="dos-menu__item">
              <strong>C</strong>atalog
            </span>
            <span className="dos-menu__item">
              <strong>M</strong>odules
            </span>
            <span className="dos-menu__item">
              <strong>D</strong>ocs
            </span>
            <span className="dos-menu__item">
              <strong>W</strong>indow
            </span>
          </div>
          <time className="dos-header__clock">{clock}</time>
        </div>

        <div className="dos-header__status">
          <span className="dos-header__brand">Redis Command Terminal</span>
          <span>{commandIndex.commandCount} commands cached locally</span>
          <span>snapshot {docsSnapshotLabel}</span>
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
                  <p className="dossier__intro">{detailIntro}</p>
                </div>

                <div className="dossier__body dossier__body--simple">
                  <section className="dossier__card dossier__card--example">
                    <div className="dossier__card-bar">Redis CLI</div>
                    <div className="dossier__example">
                      <pre className="dossier__example-code">{exampleCard.content}</pre>
                    </div>
                  </section>

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
