import type { enMessages } from './en'

export type WidenMessageLeaves<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : WidenMessageLeaves<T[K]>
}

export type TranslationMessages = WidenMessageLeaves<typeof enMessages>

export type DotPath<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPath<T[K]>}`
}[keyof T & string]

export type TranslationKey = DotPath<typeof enMessages>
