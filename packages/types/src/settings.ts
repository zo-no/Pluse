export interface AppSettings {
  globalSystemPrompt: string
  cliCatalogCommand: string
}

export interface UpdateAppSettingsInput {
  globalSystemPrompt?: string | null
  cliCatalogCommand?: string | null
}
