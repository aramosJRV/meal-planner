// Instagram posts need a login, but each post's public embed view (what other sites show in an
// iframe) carries the full caption and photo. Text from it is untrusted, like any page text.
// shortcut: depends on Instagram's embed markup; if it changes, paste/screenshots still work.
import { clean, imageUrl } from './recipe.ts'

const POST = /^https?:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]+)/i

export function instagramEmbed(url: string): string | null {
  const code = url.match(POST)?.[1]
  return code ? `https://www.instagram.com/p/${code}/embed/captioned/` : null
}

export function readEmbed(
  html: string,
): { text: string; author: string | null; image_url: string | null } | null {
  const caption = html.match(
    /<div class="Caption">([\s\S]*?)(?:<div class="CaptionComments"|<\/div>)/,
  )?.[1]
  if (!caption) return null
  const author = caption.match(/<a class="CaptionUsername"[^>]*>([^<]*)<\/a>/)?.[1]
  const text = caption
    .replace(/<a class="CaptionUsername"[^>]*>[^<]*<\/a>/, '')
    .split(/<br\s*\/?>/i)
    .map((line) => clean(line, 2000))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20000)
  if (!text) return null
  const src = html.match(/<img\b[^>]*class="EmbeddedMediaImage"[^>]*\bsrc="([^"]+)"/)?.[1]
  return {
    text,
    author: author ? clean(author, 100) : null,
    image_url: src ? imageUrl(clean(src, 2000), 'https://www.instagram.com/') : null,
  }
}
