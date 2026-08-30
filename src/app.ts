import { PropsWithChildren, useEffect } from 'react'
import { schedulePersistedImageGarbageCollection } from '@/utils/images'
import './app.scss'

function App({ children }: PropsWithChildren) {
  useEffect(() => schedulePersistedImageGarbageCollection(), [])
  return children
}

export default App
