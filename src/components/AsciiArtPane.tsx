import { useEffect, useState, type CSSProperties } from 'react'

import { getAsciiArt } from '../lib/asciiArt'

const GLYPHS = '#@%&/\\|=+*~<>[]{}'
const SECRET_MESSAGE_HOLD_MS = 4600
const SECRET_MESSAGE = [
  'YOU THOUGHT',
  'IT IS JUST',
  'A CACHE...',
].join('\n')

type AsciiArtPaneProps = {
  accent: string
  group: string
  label: string
}

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

function scrambleAscii(target: string, settledCharacters: number) {
  return [...target]
    .map((character, index) => {
      if (/\s/.test(character)) {
        return character
      }

      if (index <= settledCharacters) {
        return character
      }

      return randomGlyph()
    })
    .join('')
}

export function AsciiArtPane({
  accent,
  group,
  label,
}: AsciiArtPaneProps) {
  const art = getAsciiArt(group)
  const [showSecretMessage, setShowSecretMessage] = useState(false)
  const [secretCycle, setSecretCycle] = useState(0)
  const [displayArt, setDisplayArt] = useState(art)
  const activeArt = showSecretMessage ? SECRET_MESSAGE : art

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      const reducedMotionFrame = window.requestAnimationFrame(() => {
        setDisplayArt(activeArt)
      })

      let reducedMotionTimeout = 0
      if (showSecretMessage) {
        reducedMotionTimeout = window.setTimeout(() => {
          setShowSecretMessage(false)
        }, SECRET_MESSAGE_HOLD_MS)
      }

      return () => {
        window.cancelAnimationFrame(reducedMotionFrame)
        window.clearTimeout(reducedMotionTimeout)
      }
    }

    let disposed = false
    let frameId = 0
    let timeoutId = 0
    let holdTimeoutId = 0

    const runCycle = () => {
      if (disposed) {
        return
      }

      let frame = 0
      const totalFrames = Math.max(18, activeArt.length / 6)

      const tick = () => {
        if (disposed) {
          return
        }

        frame += 1
        const progress = frame / totalFrames
        const settledCharacters = Math.floor(progress * activeArt.length)
        setDisplayArt(scrambleAscii(activeArt, settledCharacters))

        if (frame < totalFrames) {
          frameId = window.requestAnimationFrame(tick)
          return
        }

        setDisplayArt(activeArt)

        if (showSecretMessage) {
          holdTimeoutId = window.setTimeout(() => {
            setShowSecretMessage(false)
          }, SECRET_MESSAGE_HOLD_MS)
          return
        }

        timeoutId = window.setTimeout(runCycle, 3200)
      }

      frameId = window.requestAnimationFrame(() => {
        setDisplayArt(scrambleAscii(activeArt, -1))
        frameId = window.requestAnimationFrame(tick)
      })
    }

    runCycle()

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
      window.clearTimeout(holdTimeoutId)
    }
  }, [activeArt, secretCycle, showSecretMessage])

  function triggerSecretMessage() {
    setSecretCycle((previous) => previous + 1)
    setShowSecretMessage(true)
  }

  return (
    <aside
      aria-label={`${label} ASCII art`}
      className="ascii-pane"
      onDoubleClick={triggerSecretMessage}
      style={{ '--panel-accent': accent } as CSSProperties}
    >
      <pre className="ascii-pane__art">{displayArt}</pre>
    </aside>
  )
}
