import { useEffect, useState, type CSSProperties } from 'react'

import { getAsciiArt } from '../lib/asciiArt'

const GLYPHS = '#@%&/\\|=+*~<>[]{}'

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
  const [displayArt, setDisplayArt] = useState(art)

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      const reducedMotionFrame = window.requestAnimationFrame(() => {
        setDisplayArt(art)
      })

      return () => window.cancelAnimationFrame(reducedMotionFrame)
    }

    let disposed = false
    let frameId = 0
    let timeoutId = 0

    const runCycle = () => {
      if (disposed) {
        return
      }

      let frame = 0
      const totalFrames = Math.max(18, art.length / 6)

      const tick = () => {
        if (disposed) {
          return
        }

        frame += 1
        const progress = frame / totalFrames
        const settledCharacters = Math.floor(progress * art.length)
        setDisplayArt(scrambleAscii(art, settledCharacters))

        if (frame < totalFrames) {
          frameId = window.requestAnimationFrame(tick)
          return
        }

        setDisplayArt(art)
        timeoutId = window.setTimeout(runCycle, 3200)
      }

      frameId = window.requestAnimationFrame(() => {
        setDisplayArt(scrambleAscii(art, -1))
        frameId = window.requestAnimationFrame(tick)
      })
    }

    runCycle()

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [art])

  return (
    <aside
      aria-label={`${label} ASCII art`}
      className="ascii-pane"
      style={{ '--panel-accent': accent } as CSSProperties}
    >
      <pre className="ascii-pane__art">{displayArt}</pre>
    </aside>
  )
}
