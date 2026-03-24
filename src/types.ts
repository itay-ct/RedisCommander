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

export type ApiMethodParam = {
  description: string
  name: string
  type: string
}

export type ApiMethodReturn = {
  description: string
  type: string
}

export type ApiMethod = {
  params: ApiMethodParam[]
  returns?: ApiMethodReturn
  signature: string
}

export type CommandSection = {
  content: string
  level: number
  title: string
}

export type CommandSummary = {
  arity: number | null
  complexity: string | null
  deprecated: boolean
  deprecatedSince: string | null
  description: string
  group: string
  moduleName: string | null
  replacedBy: string | null
  since: string | null
  slug: string
  syntax: string
  title: string
}

export type CommandDetail = {
  aclCategories: string[]
  apiMethods: Record<string, ApiMethod[]>
  arguments: CommandArgument[]
  arity: number | null
  codeExamples: CodeExample[]
  commandFlags: string[]
  complexity: string | null
  content: string
  deprecated: boolean
  deprecatedSince: string | null
  description: string
  docsUrl: string
  example: string | null
  group: string
  groupLabel: string
  intro: string
  keySpecs: unknown[]
  moduleName: string | null
  notes: string[]
  redisCategories: string[]
  replacedBy: string | null
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
