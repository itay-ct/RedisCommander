// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'

import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.resetModules()
})

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
    writable: true,
  })
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
    writable: true,
  })
}

function stubMatchMedia(coarsePointer = false) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: query === '(pointer: coarse)' ? coarsePointer : false,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  )
}

function stubAppGlobals(openedUrlRef: { current: string }, coarsePointer = false, width = 1600, height = 900) {
  setViewport(width, height)
  stubMatchMedia(coarsePointer)

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('command-details.json')) {
        const body = await readFile(`${process.cwd()}/public/data/command-details.json`, 'utf8')
        return new Response(body, {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      }

      return new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }),
  )

  vi.stubGlobal('open', vi.fn((url?: string | URL) => {
    openedUrlRef.current = String(url ?? '')
    return null
  }))

  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)),
  )

  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => window.clearTimeout(id)))
}

async function renderAppForTest(
  options: {
    coarsePointer?: boolean
    height?: number
    width?: number
  } = {},
) {
  const openedUrlRef = { current: '' }
  stubAppGlobals(
    openedUrlRef,
    options.coarsePointer ?? false,
    options.width ?? 1600,
    options.height ?? 900,
  )

  const { default: App } = await import('../src/App')
  render(<App />)

  return {
    getOpenedUrl: () => openedUrlRef.current,
  }
}

test(
  'terminal shell stays fixed, keyboard-driven, and hides ASCII art on tighter widths',
  async () => {
    let openedUrl = ''

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: false,
      media: '',
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  )

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('command-details.json')) {
        const body = await readFile(`${process.cwd()}/public/data/command-details.json`, 'utf8')
        return new Response(body, {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      }

      return new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      })
    }),
  )

  vi.stubGlobal('open', vi.fn((url?: string | URL) => {
    openedUrl = String(url ?? '')
    return null
  }))

  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)),
  )

  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => window.clearTimeout(id)))

  const keyboard = (key: string) => {
    window.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
      }),
    )
  }

  const advanceClient = async (label: string) => {
    keyboard('ArrowDown')
    await waitFor(() => expect(document.body.textContent).toContain(`Client: ${label}`))
  }

  const { default: App } = await import('../src/App')
  render(<App />)

  const getFocusedBar = () =>
    document.querySelector('.dos-panel--focus .dos-panel__bar')?.textContent?.trim() ?? ''

  const getFooterText = () =>
    [...document.querySelectorAll('.dos-key')]
      .map((node) => node.textContent?.trim())
      .filter(Boolean)
      .join(' | ')

  await waitFor(() => expect(getFocusedBar()).toContain('Core'))

  const asciiPane = document.querySelector('.ascii-pane') as HTMLElement | null
  expect(asciiPane).not.toBeNull()
  fireEvent.doubleClick(asciiPane!)
  await waitFor(() =>
    expect(document.querySelector('.ascii-pane__art')?.textContent).toContain('YOU THOUGHT'),
  )
  await waitFor(
    () => expect(document.querySelector('.ascii-pane__art')?.textContent).not.toContain('YOU THOUGHT'),
    { timeout: 7000 },
  )

  keyboard('Enter')
  await waitFor(() => expect(getFocusedBar()).toContain('Strings'))

  keyboard('Enter')
  await waitFor(() =>
    expect(document.querySelector('.dossier__title')?.textContent?.trim()).not.toEqual(''),
  )

    expect(document.body.textContent).not.toContain('C:\\REDIS\\')
    expect(document.body.textContent).toContain('version 1.15')
  expect(document.body.textContent).toContain('commands')
  expect(document.body.textContent).toContain('Client: Redis CLI')
  expect(document.body.textContent).not.toContain('cached locally')
  expect(document.querySelector('.dos-header__menu')).toBeNull()
  expect(document.querySelector('.dossier__example-code')?.textContent?.trim()).not.toContain(
    'Overview',
  )
  expect(document.querySelector('.dossier__example-code')?.textContent?.trim()).not.toContain(
    'Difficulty',
  )
  expect(document.body.textContent).not.toContain('F4 or ENTER moves focus into the dossier')

  expect(document.body.textContent).not.toContain(
    'Unable to load the command transcript from the local cache.',
  )
  expect(document.body.textContent).not.toContain('Loading transcript')

  keyboard('F5')
  expect(openedUrl).toContain('redis.io/docs/latest/commands/')

  ;(document.querySelector('.dos-header__link') as HTMLButtonElement | null)?.click()
  expect(openedUrl).toContain('github.com/itay-ct/RedisCommander')

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const findInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  expect(findInput).not.toBeNull()

  fireEvent.change(findInput!, { target: { value: 'json.g' } })
  await waitFor(() =>
    expect(document.querySelector('.find-palette__result-title')?.textContent).toContain('JSON.GET'),
  )

  fireEvent.keyDown(findInput!, { bubbles: true, cancelable: true, key: 'Enter' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('JSON.GET'))

  keyboard('F2')
  await waitFor(() => expect(getFocusedBar()).toContain('JSON'))

  keyboard('F3')
  await waitFor(() => expect(getFocusedBar()).toContain('JSON.GET'))

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const secondFindInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  fireEvent.change(secondFindInput!, { target: { value: 'expire' } })
  fireEvent.keyDown(secondFindInput!, { bubbles: true, cancelable: true, key: 'Escape' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  expect(document.querySelector('.dossier__title')?.textContent).toContain('JSON.GET')

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const mgetFindInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  fireEvent.change(mgetFindInput!, { target: { value: 'mget' } })
  fireEvent.keyDown(mgetFindInput!, { bubbles: true, cancelable: true, key: 'Enter' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('MGET'))

  expect(document.querySelector('.dossier__intro')?.textContent).not.toContain(
    "This command's behavior varies in clustered Redis environments.",
  )
  expect(document.querySelector('.dossier__note-copy')?.textContent).toContain(
    'This command\'s behavior varies in clustered Redis environments.',
  )
  expect(document.querySelector('.dossier__note-copy')?.textContent).not.toContain('[')
  expect(document.querySelector('.dossier__example-code')?.textContent).toContain('(nil)')

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const zincrbyFindInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  fireEvent.change(zincrbyFindInput!, { target: { value: 'zincrby' } })
  fireEvent.keyDown(zincrbyFindInput!, { bubbles: true, cancelable: true, key: 'Enter' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('ZINCRBY'))

  const introParagraphs = [...document.querySelectorAll('.dossier__intro-copy')].map((node) =>
    node.textContent?.trim() ?? '',
  )

  expect(introParagraphs.length).toBeGreaterThanOrEqual(3)
  expect(introParagraphs[0]).toContain('If member does not exist in the sorted set')
  expect(introParagraphs[1]).toContain('does not hold a sorted set')
  expect(introParagraphs[2]).toContain('negative value to decrement the score')

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const lmpopFindInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  fireEvent.change(lmpopFindInput!, { target: { value: 'lmpop' } })
  fireEvent.keyDown(lmpopFindInput!, { bubbles: true, cancelable: true, key: 'Enter' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('LMPOP'))
  expect(document.querySelector('.dossier__intro')?.textContent).toContain(
    "Elements are popped from either the left or right of the first non-empty list",
  )
  expect(document.querySelector('.dossier__intro')?.textContent).not.toContain('- LPOP')

  const lmpopLink = [...document.querySelectorAll('.dossier__inline-link')].find((node) =>
    node.textContent?.includes('BLMPOP'),
  ) as HTMLButtonElement | undefined
  expect(lmpopLink).toBeDefined()
  fireEvent.click(lmpopLink!)
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('BLMPOP'))

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const xinfoGroupsFindInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  fireEvent.change(xinfoGroupsFindInput!, { target: { value: 'xinfo groups' } })
  fireEvent.keyDown(xinfoGroupsFindInput!, { bubbles: true, cancelable: true, key: 'Enter' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('XINFO GROUPS'))
  expect(document.querySelector('.dossier__intro')?.textContent).not.toContain('Consumer group lag')

  const xinfoGroupBullets = [...document.querySelectorAll('.dossier__intro-list-item')].map((node) =>
    node.textContent?.trim() ?? '',
  )
  expect(xinfoGroupBullets.length).toBeGreaterThanOrEqual(6)
  expect(xinfoGroupBullets[0]).toContain('name')
  expect(document.querySelector('.dossier__list-bullet')?.textContent).toContain('>')

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const xrangeFindInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  fireEvent.change(xrangeFindInput!, { target: { value: 'xrange' } })
  fireEvent.keyDown(xrangeFindInput!, { bubbles: true, cancelable: true, key: 'Enter' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('XRANGE'))

  const xrangeBullets = [...document.querySelectorAll('.dossier__intro-list-item')].map((node) =>
    node.textContent?.trim() ?? '',
  )
  expect(xrangeBullets.length).toBeGreaterThanOrEqual(3)
  expect(xrangeBullets[0]).toContain('Returning items in a specific time range.')

  const xrangeLink = [...document.querySelectorAll('.dossier__inline-link')].find((node) =>
    node.textContent?.includes('SCAN'),
  ) as HTMLButtonElement | undefined
  expect(xrangeLink).toBeDefined()

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const xackFindInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  fireEvent.change(xackFindInput!, { target: { value: 'xack' } })
  fireEvent.keyDown(xackFindInput!, { bubbles: true, cancelable: true, key: 'Enter' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('XACK'))
  expect(document.querySelector('.dossier')?.getAttribute('style')).toContain('--dossier-intro-max: 15.5rem')
  expect(document.querySelector('.dossier__intro')?.textContent).toContain('Once a consumer successfully processes a message')

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const expireFindInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  fireEvent.change(expireFindInput!, { target: { value: 'expire' } })
  fireEvent.keyDown(expireFindInput!, { bubbles: true, cancelable: true, key: 'Enter' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('EXPIRE'))

  expect(getFooterText()).toContain('UP/DNSelect client')
  keyboard('ArrowDown')
  await waitFor(() => expect(document.body.textContent).toContain('Client: Python'))
  expect(document.cookie).toContain('redis-commander-client=redis_py')
  await waitFor(() => expect(document.querySelector('.dossier__api-code')?.textContent).toContain('expire('))

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const zaddFindInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  fireEvent.change(zaddFindInput!, { target: { value: 'zadd' } })
  fireEvent.keyDown(zaddFindInput!, { bubbles: true, cancelable: true, key: 'Enter' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('ZADD'))

  const getApiCode = () => document.querySelector('.dossier__api-code')?.textContent?.trim() ?? ''

  await waitFor(() => expect(getApiCode()).toContain(') → ResponseT'))
  expect(getApiCode()).toContain('mapping: Mapping[AnyKeyT, EncodableT]')
  expect(getApiCode().split('→').length - 1).toBe(1)

  await advanceClient('Node.js')
  await advanceClient('Java-Sync')
  await waitFor(() => expect(getApiCode()).toContain(') → long'))
  expect(getApiCode()).toContain('// 1 if the new element was added')
  expect(document.querySelector('.dossier__api-token--comment')).not.toBeNull()

  await advanceClient('Lettuce-Sync')
  await advanceClient('Java-Async')
  await advanceClient('Java-Reactive')
  await advanceClient('Go')
  await advanceClient('C#-Sync')
  await waitFor(() => expect(getApiCode()).toContain(') → bool'))
  expect(getApiCode()).toContain('// The number of elements added')

  await advanceClient('C#-Async')
  await advanceClient('PHP')
  await waitFor(() => expect(getApiCode()).toContain(') → int'))
  expect(getApiCode()).toContain('$membersAndScoresDictionary: array')
  expect(getApiCode().split('→').length - 1).toBe(1)

  keyboard('F2')
  await waitFor(() => expect(getFocusedBar()).toContain('Sorted Sets'))
  expect(getFooterText()).not.toContain('UP/DNSelect client')

  keyboard('f')
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const smoveFindInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  fireEvent.change(smoveFindInput!, { target: { value: 'smove' } })
  fireEvent.keyDown(smoveFindInput!, { bubbles: true, cancelable: true, key: 'Enter' })
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('SMOVE'))
  expect(document.querySelector('.dossier__intro')?.textContent).toContain(
    'destination for other clients.',
  )

  keyboard('F10')
  expect(openedUrl).toContain('github.com/itay-ct/RedisCommander')

  keyboard('Escape')
  await waitFor(() => expect(getFocusedBar()).toContain('Sets'))

  keyboard('F4')
  await waitFor(() => expect(getFocusedBar()).toContain('More'))

  const css = await readFile(`${process.cwd()}/src/index.css`, 'utf8')
  expect(
    /@media\s*\(max-width:\s*1180px\)[\s\S]*?\.ascii-pane\s*\{\s*display:\s*none;/m.test(css),
  ).toBe(true)

  expect(getFooterText()).toContain('F2Commands')
  expect(getFooterText()).toContain('F3Dossier')
  expect(getFooterText()).toContain('F5Docs')
  expect(getFooterText()).toContain('FFind')
  expect(getFooterText()).not.toContain('UP/DNSelect client')
  expect(getFooterText().indexOf('F5Docs')).toBeLessThan(getFooterText().indexOf('FFind'))

  const favicon = await readFile(`${process.cwd()}/public/favicon.svg`, 'utf8')
  expect(favicon).toContain('shape-rendering="crispEdges"')
  expect(favicon).toContain('rgb(255, 68, 56)')

  const html = await readFile(`${process.cwd()}/index.html`, 'utf8')
  expect(html).toContain('apple-touch-icon')
  expect(html).toContain('site.webmanifest')
  expect(html).toContain('favicon.ico')

  const manifest = await readFile(`${process.cwd()}/public/site.webmanifest`, 'utf8')
  expect(manifest).toContain('"name": "Redis Commander"')
  expect(manifest).toContain('android-chrome-512x512.png')
  },
  15000,
)

test('mobile portrait uses a single-pane touch layout with banner, docs actions, and client switching', async () => {
  const { getOpenedUrl } = await renderAppForTest({
    coarsePointer: true,
    height: 844,
    width: 390,
  })

  await waitFor(() => expect(document.querySelector('.shell--mobile-portrait')).not.toBeNull())
  expect(document.body.textContent).toContain('Experienced best on desktop')
  expect(document.querySelector('.dos-footer')).toBeNull()
  expect(document.querySelectorAll('.mobile-workspace--portrait .dos-panel')).toHaveLength(1)
  expect(document.querySelector('.ascii-pane')).toBeNull()
  expect(document.querySelectorAll('.mobile-toolbar__tab')).toHaveLength(3)

  const categoryRows = document.querySelectorAll('.mobile-workspace--portrait .dos-row')
  expect(categoryRows.length).toBeGreaterThan(3)
  fireEvent.click(categoryRows[0] as HTMLElement)
  await waitFor(() =>
    expect(document.querySelector('.mobile-workspace--portrait .dos-panel__bar')?.textContent).toContain('Strings'),
  )

  const commandRows = document.querySelectorAll('.mobile-workspace--portrait .dos-row')
  expect(commandRows.length).toBeGreaterThan(0)
  fireEvent.click(commandRows[0] as HTMLElement)
  await waitFor(() =>
    expect(document.querySelector('.mobile-workspace--portrait .dossier__title')?.textContent?.trim()).not.toEqual(''),
  )
  expect(document.querySelector('.dos-panel__bar-action')?.textContent).toContain('Docs')

  fireEvent.click(document.querySelector('.mobile-toolbar__action') as HTMLButtonElement)
  await waitFor(() => expect(document.querySelector('.find-palette')).not.toBeNull())

  const findInput = document.querySelector('.find-palette__input') as HTMLInputElement | null
  expect(findInput).not.toBeNull()
  fireEvent.change(findInput!, { target: { value: 'expire' } })
  await waitFor(() =>
    expect(document.querySelector('.find-palette__result-title')?.textContent).toContain('EXPIRE'),
  )

  fireEvent.click(document.querySelector('.find-palette__result') as HTMLButtonElement)
  await waitFor(() => expect(document.querySelector('.find-palette')).toBeNull())
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('EXPIRE'))

  const clientBar = document.querySelector('.dossier__card-bar--button') as HTMLButtonElement | null
  expect(clientBar).not.toBeNull()
  fireEvent.click(clientBar!)
  await waitFor(() => expect(document.querySelector('.dossier__client-picker')).not.toBeNull())

  const pythonOption = [...document.querySelectorAll('.dossier__client-option')].find((node) =>
    node.textContent?.includes('Python'),
  ) as HTMLButtonElement | undefined
  expect(pythonOption).toBeDefined()
  fireEvent.click(pythonOption!)
  await waitFor(() => expect(document.body.textContent).toContain('Client: Python'))
  expect(document.cookie).toContain('redis-commander-client=redis_py')

  fireEvent.click(document.querySelector('.dos-panel__bar-action') as HTMLButtonElement)
  expect(getOpenedUrl()).toContain('redis.io/docs/latest/commands/expire/')

  const portraitWorkspace = document.querySelector('.mobile-workspace--portrait') as HTMLElement | null
  expect(portraitWorkspace).not.toBeNull()
  fireEvent.touchStart(portraitWorkspace!, {
    touches: [{ clientX: 120, clientY: 280 }],
  })
  fireEvent.touchMove(portraitWorkspace!, {
    touches: [{ clientX: 320, clientY: 286 }],
  })
  fireEvent.touchEnd(portraitWorkspace!)
  await waitFor(() =>
    expect(document.querySelector('.mobile-workspace--portrait .dos-panel__bar')?.textContent).toContain('Generic'),
  )

  fireEvent.touchStart(portraitWorkspace!, {
    touches: [{ clientX: 300, clientY: 280 }],
  })
  fireEvent.touchMove(portraitWorkspace!, {
    touches: [{ clientX: 120, clientY: 286 }],
  })
  fireEvent.touchEnd(portraitWorkspace!)
  await waitFor(() => expect(document.querySelector('.dossier__title')?.textContent).toContain('EXPIRE'))
}, 15000)

test('mobile landscape keeps nav and dossier visible together', async () => {
  await renderAppForTest({
    coarsePointer: true,
    height: 390,
    width: 844,
  })

  await waitFor(() => expect(document.querySelector('.shell--mobile-landscape')).not.toBeNull())
  expect(document.body.textContent).toContain('Experienced best on desktop')
  expect(document.querySelector('.dos-footer')).toBeNull()
  expect(document.querySelector('.ascii-pane')).toBeNull()
  expect(document.querySelectorAll('.mobile-workspace--landscape .dos-panel')).toHaveLength(2)
  expect(document.querySelector('.mobile-nav-toggle')).not.toBeNull()

  const categoryRows = document.querySelectorAll('.mobile-workspace--landscape .mobile-workspace__nav .dos-row')
  expect(categoryRows.length).toBeGreaterThan(0)
  fireEvent.click(categoryRows[0] as HTMLElement)
  await waitFor(() =>
    expect(
      [...document.querySelectorAll('.mobile-nav-toggle__button')].find((node) =>
        node.classList.contains('mobile-nav-toggle__button--active'),
      )?.textContent,
    ).toContain('Commands'),
  )

  const commandRows = document.querySelectorAll('.mobile-workspace--landscape .mobile-workspace__nav .dos-row')
  expect(commandRows.length).toBeGreaterThan(0)
  fireEvent.click(commandRows[0] as HTMLElement)
  await waitFor(() =>
    expect(document.querySelector('.mobile-workspace__detail .dossier__title')?.textContent?.trim()).not.toEqual(''),
  )

  const categoriesToggle = [...document.querySelectorAll('.mobile-nav-toggle__button')].find((node) =>
    node.textContent?.includes('Categories'),
  ) as HTMLButtonElement | undefined
  expect(categoriesToggle).toBeDefined()
  fireEvent.click(categoriesToggle!)
  await waitFor(() =>
    expect(
      [...document.querySelectorAll('.mobile-nav-toggle__button')].find((node) =>
        node.classList.contains('mobile-nav-toggle__button--active'),
      )?.textContent,
    ).toContain('Categories'),
  )
})
