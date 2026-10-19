// Content shared to the app from another app's share sheet (DESIGN.md §9). Native only; the
// plugin holds a share until this listener is registered, so cold starts don't lose it.
import { Capacitor } from '@capacitor/core'
import { CapacitorShareTarget, type ShareReceivedEvent } from '@capgo/capacitor-share-target'
import { useSyncExternalStore } from 'react'

export type Shared = { id: number; url: string | null; text: string; files: File[] }

let current: Shared | null = null
const listeners = new Set<() => void>()
const set = (s: Shared | null) => {
  current = s
  listeners.forEach((l) => l())
}

// "Check this out https://…" → the first link, plus the text unless it was only the link.
export function readTexts(texts: string[]): Pick<Shared, 'url' | 'text'> {
  const all = texts.join('\n').trim()
  const url = all.match(/https?:\/\/\S+/)?.[0] ?? null
  return { url, text: all === url ? '' : all }
}

async function receive(event: ShareReceivedEvent) {
  const images = (event.files ?? []).filter((f) => f.mimeType?.startsWith('image/')).slice(0, 5)
  const files = await Promise.all(
    images.map(async (f) => {
      const res = await fetch(Capacitor.convertFileSrc(f.uri))
      return new File([await res.blob()], f.name, { type: f.mimeType })
    }),
  ).catch((e) => {
    console.error('share: read files', e)
    return [] // still open the import screen with the text; the user can add screenshots
  })
  set({ id: Date.now(), ...readTexts(event.texts ?? []), files })
  window.location.hash = '#/recipes/import'
}

if (Capacitor.isNativePlatform()) {
  CapacitorShareTarget.addListener('shareReceived', receive).catch((e) =>
    console.error('share: listen', e),
  )
}

export const clearShare = () => set(null)

export function useShared() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
