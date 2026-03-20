export function formatCount(count: number) {
  return `${count} command${count === 1 ? '' : 's'}`
}

export function formatArity(value: number | null) {
  if (value === null) {
    return 'n/a'
  }

  return value.toString()
}

export function formatList(values: string[]) {
  return values.length ? values.join(' ') : 'n/a'
}

export function resolveRedisHref(baseUrl: string, href?: string) {
  if (!href) {
    return baseUrl
  }

  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}
