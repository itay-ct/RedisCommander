import { createElement, type ElementType, type ReactNode } from 'react'

import { useShuffleText } from '../hooks/useShuffleText'

type ShuffleTextProps = {
  as?: ElementType
  animateKey: string | number
  className?: string
  children?: ReactNode
  text: string
}

export function ShuffleText({
  as = 'span',
  animateKey,
  className,
  text,
}: ShuffleTextProps) {
  const displayText = useShuffleText(text, animateKey)

  return createElement(as, { className }, displayText)
}
