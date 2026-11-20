import { supabase } from '@/lib/supabase'

// shortcut: the image is decoded at full size before scaling, so a huge photo (e.g. from a hostile
// recipe site) could exhaust memory; check pixel size in import-url if that ever shows up.
// Images go up as JPEG no larger than Claude reads them (1568 px): the bucket takes JPEG only,
// and this saves upload, storage and (for import screenshots) AI tokens.
export async function toJpeg(file: Blob): Promise<Blob> {
  const image = await createImageBitmap(file).catch(() => {
    throw new Error("We couldn't read that image. Try a different one.")
  })
  const scale = Math.min(1, 1568 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("We couldn't read that image."))),
      'image/jpeg',
      0.85,
    ),
  )
}

// Stores an image under the household's folder (storage rules check that prefix); returns its path.
export async function uploadJpeg(householdId: string, folder: 'imports' | 'recipes', file: Blob) {
  const path = `${householdId}/${folder}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage
    .from('recipe-media')
    .upload(path, await toJpeg(file), { contentType: 'image/jpeg' })
  if (error) {
    console.error('upload image', error)
    throw new Error("Couldn't upload the image. Check your connection and try again.")
  }
  return path
}

// import-url sends the recipe's photo as a data URL. A bad one means no photo, not a failed import.
export function dataUrlToBlob(url: string): Blob | undefined {
  const comma = url.indexOf(',')
  const type = url.slice(0, comma).match(/^data:(image\/[a-z]+);base64$/)?.[1]
  try {
    if (comma > 0 && type)
      return new Blob([Uint8Array.from(atob(url.slice(comma + 1)), (c) => c.charCodeAt(0))], {
        type,
      })
  } catch {
    // fall through
  }
  console.error('import photo unreadable')
  return undefined
}
