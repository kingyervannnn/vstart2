import { useEffect, useState } from 'react'

const ENTER_WIDTH = 920
const EXIT_WIDTH = 980

export function useCompactMode() {
  const [compact, setCompact] = useState(() => window.innerWidth < ENTER_WIDTH)

  useEffect(() => {
    const update = () => {
      const width = window.visualViewport?.width || document.documentElement.clientWidth
      setCompact((current) => current ? width < EXIT_WIDTH : width < ENTER_WIDTH)
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
