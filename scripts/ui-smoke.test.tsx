// @vitest-environment jsdom

import { readFile } from 'node:fs/promises'

import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.resetModules()
})

test('terminal shell stays fixed, keyboard-driven, and hides ASCII art on tighter widths', async () => {
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

  keyboard('Enter')
  await waitFor(() => expect(getFocusedBar()).toContain('Strings'))

  keyboard('Enter')
  await waitFor(() =>
    expect(document.querySelector('.dossier__title')?.textContent?.trim()).not.toEqual(''),
  )

  expect(document.body.textContent).not.toContain('C:\\REDIS\\')
  expect(document.body.textContent).toContain('version 1.05')
  expect(document.body.textContent).toContain('commands')
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

  keyboard('F10')
  expect(openedUrl).toContain('github.com/itay-ct/RedisCommander')

  keyboard('Escape')
  await waitFor(() => expect(getFocusedBar()).toContain('JSON'))

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
  expect(getFooterText().indexOf('F5Docs')).toBeLessThan(getFooterText().indexOf('FFind'))

  const favicon = await readFile(`${process.cwd()}/public/favicon.svg`, 'utf8')
  expect(favicon).toContain('shape-rendering="crispEdges"')
  expect(favicon).toContain('#ff4438')
})
