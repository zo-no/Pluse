export type RuntimeReasoningKind = 'none' | 'toggle' | 'enum'

export interface RuntimeReasoningSpec {
  kind: RuntimeReasoningKind
  label: string
  levels?: string[]
  default?: string | null
}

export interface RuntimeModel {
  id: string
  label: string
  defaultEffort?: string | null
  effortLevels?: string[]
}

export interface RuntimeModelCatalog {
  models: RuntimeModel[]
  effortLevels: string[] | null
  defaultModel: string | null
  reasoning: RuntimeReasoningSpec
}

export interface RuntimeTool {
  id: string
  name: string
  command: string
  runtimeFamily: string
  builtin: boolean
  available: boolean
}
