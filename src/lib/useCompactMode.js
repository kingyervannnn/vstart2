import { useEffect, useState } from 'react'

export const COMPACT_ENTER_WIDTH = 1100
export const COMPACT_EXIT_WIDTH = 1160

export function resolveCompactMode(width, current) {
  return current ? width < COMPACT_EXIT_WIDTH : width < COMPACT_ENTER_WIDTH
}

export function useCompactMode() {
  const [compact, setCompact] = useState(() => resolveCompactMode(window.innerWidth, false))

  useEffect(() => {
    const update = () => {
      const width = window.visualViewport?.width || document.documentElement.clientWidth
      setCompact((current) => resolveCompactMode(width, current))
    }
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  return compact
}
