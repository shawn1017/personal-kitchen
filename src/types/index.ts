export type RecipeSourcePlatform = 'xiaohongshu' | 'xiachufang' | 'manual'

export interface Category {
  id: string
  name: string
  sort: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface RecipeIngredient {
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

export interface RecipeSourceMeta {
  platform: RecipeSourcePlatform
  sourceUrl?: string
  sourceId?: string
  authorName?: string
  importedAt?: number
  rawTitle?: string
  rawContent?: string
}

export interface Recipe {
  id: string
  name: string
  categoryId: string
  coverImage?: string
  galleryImages: string[]
  description?: string
  tips?: string
  enabled: boolean
  sort: number
  ingredients: RecipeIngredient[]
  steps: RecipeStep[]
  source?: RecipeSourceMeta
  createdAt: number
  updatedAt: number
}

export interface CartItem {
  recipeId: string
  quantity: number
}

export interface CartItemView extends CartItem {
  recipe?: Recipe
}

export interface OrderItemSnapshot {
  recipeId: string
  recipeName: string
  recipeImage?: string
  quantity: number
}

export type OrderStatus = 'pending' | 'completed'

export interface Order {
  id: string
  items: OrderItemSnapshot[]
  note?: string
  status: OrderStatus
  createdAt: number
  completedAt?: number
}

export interface ImportedRecipeDraft {
  title: string
  coverImage?: string
  galleryImages: string[]
  rawContent?: string
  ingredients: RecipeIngredient[]
  steps: RecipeStep[]
  tips?: string
  categorySuggestion?: string
  source: RecipeSourceMeta
  warnings?: string[]
}

export type ImportErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_SOURCE'
  | 'SOURCE_BLOCKED'
  | 'SOURCE_TIMEOUT'
  | 'PARSE_FAILED'
  | 'SERVICE_UNAVAILABLE'
  | 'ACCESS_DENIED'
  | 'CANCELLED'

export interface ImportRecipeSuccess {
  success: true
  data: ImportedRecipeDraft
  warnings: string[]
}

export interface ImportRecipeFailure {
  success: false
  errorCode: ImportErrorCode
  message: string
  partialData?: Partial<ImportedRecipeDraft>
}

export type ImportRecipeResponse = ImportRecipeSuccess | ImportRecipeFailure
