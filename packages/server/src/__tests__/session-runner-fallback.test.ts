import { describe, expect, test } from 'bun:test'
import { shouldFallbackToClaudeForTask } from '../runtime/session-runner'

const base = {
  questKind: 'task' as const,
  tool: 'codex' as const,
  failureReason: 'codex exited with code 1',
  usedToolFallback: false,
  claudeAvailable: true,
}

describe('shouldFallbackToClaudeForTask', () => {
  test('triggers when codex task fails and claude is available', () => {
    expect(shouldFallbackToClaudeForTask(base)).toBe(true)
  })

  test('does not trigger for session quests (interactive — user picked the tool)', () => {
    expect(shouldFallbackToClaudeForTask({ ...base, questKind: 'session' })).toBe(false)
  })

  test('does not trigger when current tool is already claude', () => {
    expect(shouldFallbackToClaudeForTask({ ...base, tool: 'claude' })).toBe(false)
  })

  test('does not trigger when current tool is gemini', () => {
    expect(shouldFallbackToClaudeForTask({ ...base, tool: 'gemini' })).toBe(false)
  })

  test('does not trigger if fallback already used in this run', () => {
    expect(shouldFallbackToClaudeForTask({ ...base, usedToolFallback: true })).toBe(false)
  })

  test('does not trigger without a failure reason', () => {
    expect(shouldFallbackToClaudeForTask({ ...base, failureReason: undefined })).toBe(false)
  })

  test('does not trigger when claude command is not available on host', () => {
    expect(shouldFallbackToClaudeForTask({ ...base, claudeAvailable: false })).toBe(false)
  })

  test('triggers regardless of failure shape (timeout / spawn error / non-zero exit)', () => {
    for (const reason of ['codex run timed out', 'spawn ENOENT', 'exited with code 137', 'rate limited']) {
      expect(shouldFallbackToClaudeForTask({ ...base, failureReason: reason })).toBe(true)
    }
  })
})
