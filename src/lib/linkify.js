const LINK_PATTERN = /\[([^\]]+)]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/g
const TRAILING_PUNCTUATION = /[.,!?;:'"]$/

function trimTrailingPunctuation(value) {
  let url = value
  let trailing = ''
  while (TRAILING_PUNCTUATION.test(url)) {
    trailing = url.at(-1) + trailing
    url = url.slice(0, -1)
  }
  return { url, trailing }
}

export function linkifiedParts(text = '') {
  const value = String(text)
  const parts = []
  let cursor = 0
  const pushText = (next) => {
    if (!next) return
    const previous = parts.at(-1)
    if (previous?.type === 'text') previous.value += next
    else parts.push({ type: 'text', value: next })
  }
  for (const match of value.matchAll(LINK_PATTERN)) {
    if (match.index > cursor) pushText(value.slice(cursor, match.index))
    const markdownLabel = match[1]
    const rawUrl = match[2] || match[3]
    const { url, trailing } = markdownLabel ? { url: rawUrl, trailing: '' } : trimTrailingPunctuation(rawUrl)
    parts.push({ type: 'link', value: markdownLabel || url, url })
    pushText(trailing)
    cursor = match.index + match[0].length
  }
  if (cursor < value.length) pushText(value.slice(cursor))
  return parts
}
