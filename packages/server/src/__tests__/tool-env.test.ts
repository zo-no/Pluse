import { describe, expect, it } from 'bun:test'
import { expandToolPath } from '../support/tool-env'

describe('expandToolPath', () => {
  it('prepends user bin paths needed by installed tools', () => {
    const path = expandToolPath('/usr/bin:/bin', '/Users/example')
    expect(path.split(':').slice(0, 7)).toEqual([
      '/Users/example/.bun/bin',
      '/Users/example/.local/bin',
      '/Users/example/.openclaw/tools/node/bin',
      '/Users/example/.claude/local/bin',
      '/Users/example/.npm-global/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ])
  })

  it('deduplicates path entries while preserving first occurrence', () => {
    const path = expandToolPath('/usr/local/bin:/usr/bin:/Users/example/.bun/bin', '/Users/example')
    expect(path.split(':')).toEqual([
      '/Users/example/.bun/bin',
      '/Users/example/.local/bin',
      '/Users/example/.openclaw/tools/node/bin',
      '/Users/example/.claude/local/bin',
      '/Users/example/.npm-global/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
    ])
  })
})
