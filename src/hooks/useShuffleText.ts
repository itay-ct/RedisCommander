import { useEffect, useState } from 'react'

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*+-=/<>?'

function randomGlyph() {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
}

function seedText(target: string) {
  return [...target]
    .map((character) => (character === ' ' ? ' ' : randomGlyph()))
    .join('')
}

export function useShuffleText(text: string, animateKey: string | number) {
  const [displayText, setDisplayText] = useState(text)

  useEffect(() => {
    let frame = 0
    let rafId = 0
    const totalFrames = Math.max(16, text.length * 3)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reducedMotion) {
      rafId = window.requestAnimationFrame(() => {
        setDisplayText(text)
      })

      return () => window.cancelAnimationFrame(rafId)
    }

    const tick = () => {
      frame += 1
      const progress = frame / totalFrames
      const settledCharacters = Math.floor(progress * (text.length + 1))
      const next = [...text]
        .map((character, index) => {
          if (character === ' ') {
            return ' '
          }

          if (index < settledCharacters || progress > 0.92) {
            return character
          }

          return randomGlyph()
        })
        .join('')

      setDisplayText(next)

      if (frame < totalFrames) {
        rafId = window.requestAnimationFrame(tick)
      } else {
        setDisplayText(text)
      }
    }

    rafId = window.requestAnimationFrame(() => {
      setDisplayText(seedText(text))
      rafId = window.requestAnimationFrame(tick)
    })

    return () => window.cancelAnimationFrame(rafId)
  }, [animateKey, text])

  return displayText
}
