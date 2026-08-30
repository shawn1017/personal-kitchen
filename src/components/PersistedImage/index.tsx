import { type ComponentProps, useEffect, useState } from 'react'
import { Image } from '@tarojs/components'
import { isPersistedImageReference, resolvePersistedImage } from '@/utils/images'

type PersistedImageProps = ComponentProps<typeof Image>

export default function PersistedImage({ src, ...props }: PersistedImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState(() => isPersistedImageReference(src) ? '' : src)

  useEffect(() => {
    if (!isPersistedImageReference(src)) {
      setResolvedSrc(src)
      return undefined
    }

    let active = true
    let revoke: (() => void) | undefined
    setResolvedSrc('')
    resolvePersistedImage(src).then((resolved) => {
      if (!active) {
        resolved.revoke?.()
        return
      }
      revoke = resolved.revoke
      setResolvedSrc(resolved.src)
    }).catch((error) => {
      console.warn('[image] resolve failed', error)
      if (active) setResolvedSrc('')
    })

    return () => {
      active = false
      revoke?.()
    }
  }, [src])

  return <Image {...props} src={resolvedSrc} />
}
