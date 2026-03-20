export type CommandArgument = {
  display_text?: string
  key_spec_index?: number
  name: string
  optional?: boolean
  token?: string
  type: string
}

export type TocItem = {
  children?: TocItem[]
  id: string
  title: string
}

export type CodeExampleLanguage = {
  clientId?: string
  clientName?: string
  id: string
  langId?: string
  panelId: string
}

export type CodeExample = {
  codetabsId?: string
  description: string
  difficulty?: string
  id: string
  languages: CodeExampleLanguage[]
}

export type CommandSection = {
  content: string
  level: number
  title: string
}

export type CommandSummary = {
  arity: number | null
  complexity: string | null
  description: string
  group: string
  since: string | null
  slug: string
  syntax: string
  title: string
}

export type CommandDetail = {
  aclCategories: string[]
  arguments: CommandArgument[]
  arity: number | null
  codeExamples: CodeExample[]
  commandFlags: string[]
  complexity: string | null
  content: string
  description: string
  docsUrl: string
  group: string
  groupLabel: string
  intro: string
  keySpecs: unknown[]
  redisCategories: string[]
  sections: CommandSection[]
  since: string | null
  slug: string
  syntax: string
  tableOfContents: {
    sections: TocItem[]
  }
  title: string
}

export type CategorySummary = {
  count: number
  group: string
  label: string
}

export type CommandIndex = {
  categories: CategorySummary[]
  commandCount: number
  commands: CommandSummary[]
  generatedAt: string
  sourceDate: string | null
  sourceUrl: string
}

export type CategoryMeta = {
  accent: string
  artLabel: string
  label: string
  tagline: string
}

export type CategoryRecord = CategorySummary & CategoryMeta

export type CategoryMenuItem =
  | (CategoryRecord & { kind: 'category' })
  | {
      accent: string
      artLabel: string
      kind: 'more'
      label: string
      tagline: string
    }

export type ViewMode = 'categories' | 'commands' | 'command'
export type CategoryShelf = 'primary' | 'secondary'
