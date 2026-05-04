import { randomBytes } from 'node:crypto'

/**
 * Generate a prefixed random ID.
 * Usage: genId('qst') → 'qst_a3f8b2c1d4e5f6a7'
 */
export function genId(prefix: string): string {
  return prefix + '_' + randomBytes(8).toString('hex')
}

/**
 * Current timestamp as ISO 8601 string.
 */
export function now(): string {
  return new Date().toISOString()
}
