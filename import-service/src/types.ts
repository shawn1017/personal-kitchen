export type Platform = 'xiaohongshu' | 'xiachufang'

export interface Ingredient {
  id: string
  name: string
  amount?: string
  unit?: string
  remark?: string
  sort: number
}

export interface RecipeStep {
  id: string
  sort: number
  text: string
  image?: string
  timerSeconds?: number
}

export interface ImportedRecipeDraft {
  title: string
  coverImage?: string
  galleryImages: string[]
  rawContent?: string
  ingredients: Ingredient[]
  steps: RecipeStep[]
  tips?: string
  categorySuggestion?: string
  source: {
    platform: Platform
    sourceUrl: string
    authorName?: string
    importedAt: number
    rawTitle?: string
    rawContent?: string
  }
  warnings: string[]
}

export interface ProviderResult {
  draft: ImportedRecipeDraft
  warnings: string[]
}

export class ImportError extends Error {
  constructor(
    public readonly code: 'INVALID_URL' | 'UNSUPPORTED_SOURCE' | 'SOURCE_BLOCKED' | 'SOURCE_TIMEOUT' | 'PARSE_FAILED',
    message: string,
    public readonly partialData?: Partial<ImportedRecipeDraft>
  ) {
    super(message)
  }
}
