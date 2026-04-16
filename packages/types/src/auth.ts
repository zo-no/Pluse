export interface AuthMe {
  authenticated: boolean
  setupRequired: boolean
  username?: string | null
}
