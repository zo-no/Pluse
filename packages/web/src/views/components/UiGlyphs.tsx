interface ToolGlyphProps {
  tool?: string | null
  className?: string
}

export function ToolGlyph({ tool, className = '' }: ToolGlyphProps) {
  if (tool === 'claude') {
    return (
      <svg className={`ms-tool-glyph ms-tool-glyph-claude ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3.5l1.8 5.1 5.2 1.9-5.2 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5Z"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.65"
        />
      </svg>
    )
  }

  return (
    <svg className={`ms-tool-glyph ms-tool-glyph-codex ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 7 4.5 12 9 17M15 7l4.5 5-4.5 5M13 5l-2 14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.65"
      />
    </svg>
  )
}

interface StatusGlyphProps {
  tone?: 'idle' | 'live' | 'muted' | 'warning'
  pulse?: boolean
  className?: string
}

export function StatusGlyph({ tone = 'idle', pulse = false, className = '' }: StatusGlyphProps) {
  return (
    <span
      aria-hidden="true"
      className={`ms-status-glyph is-${tone}${pulse ? ' is-pulse' : ''} ${className}`.trim()}
    />
  )
}

export function PathGlyph({ className = '' }: { className?: string }) {
  return (
    <svg className={`ms-path-glyph ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.5 8.5c0-1.1.9-2 2-2h4.1l1.6 1.8h7.3c1.1 0 2 .9 2 2v5.2c0 1.1-.9 2-2 2H5.5c-1.1 0-2-.9-2-2V8.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

export function StopGlyph({ className = '' }: { className?: string }) {
  return (
    <svg className={`ms-stop-glyph ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="7"
        y="7"
        width="10"
        height="10"
        rx="1.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}
