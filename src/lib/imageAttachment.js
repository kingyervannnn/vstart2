export const MAX_SEARCH_IMAGE_BYTES = 8 * 1024 * 1024

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function validateImageFile(file) {
  if (!file || typeof file !== 'object') throw new Error('Drop or paste an image file.')
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error('Use a PNG, JPEG, WebP, or GIF image.')
  if (!file.size) throw new Error('The image is empty.')
  if (file.size > MAX_SEARCH_IMAGE_BYTES) throw new Error('Images must be smaller than 8 MB.')
  return file
}

export function readImageAsDataUrl(file) {
  validateImageFile(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('The image could not be read.'))
    reader.readAsDataURL(file)
  })
}

export async function prepareImageAttachment(file) {
  const dataUrl = await readImageAsDataUrl(file)
  return {
    file,
    name: file.name || 'pasted-image.png',
    mimeType: file.type,
    size: file.size,
    dataUrl,
    data: dataUrl.slice(dataUrl.indexOf(',') + 1),
  }
}

export async function uploadImageForLens(attachment, fetchImpl = fetch) {
  validateImageFile(attachment?.file)
  const form = new FormData()
  form.append('image', attachment.file, attachment.name)
  const response = await fetchImpl('/image-search/upload-for-lens', { method: 'POST', body: form })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || result?.message || 'The image search service could not upload this image.')
  }
  if (result.needsPublicUrl || result.public !== true || !/^https?:\/\//i.test(result.url || '')) {
    throw new Error('Visual search needs public image hosting. Check the image-search service and try again.')
  }
  return result.url
}

export function visualSearchUrl(imageUrl, query = '') {
  const target = new URL('https://yandex.com/images/search')
  target.searchParams.set('rpt', 'imageview')
  target.searchParams.set('url', imageUrl)
  if (query.trim()) target.searchParams.set('text', query.trim())
  return target.toString()
}
