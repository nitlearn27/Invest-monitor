// Track whether the viewport is at/below a breakpoint, via matchMedia. Used to
// branch between the desktop (all sections stacked) and mobile (one section at a
// time with a side rail) Consolidated layouts. Keep the default query aligned
// with the `@media (max-width: 640px)` block in App.css.
import { useEffect, useState } from 'react'

export function useIsMobile(query = '(max-width: 640px)') {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    onChange()
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
