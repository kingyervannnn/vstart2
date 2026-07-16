const HEX_COLOR = /^#?([\da-f]{3}|[\da-f]{6})$/i

function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function toHex(value) {
  return clampChannel(value).toString(16).padStart(2, '0')
}

export function normalizeHexColor(value, fallback = '#8ba6ff') {
  const match = String(value || '').trim().match(HEX_COLOR)
  if (!match) return fallback
  const hex = match[1].toLowerCase()
  if (hex.length === 3) return `#${[...hex].map((character) => character.repeat(2)).join('')}`
  return `#${hex}`
}

export function selectAdaptiveGlowColor(pixelData, fallback = '#8ba6ff') {
  if (!pixelData?.length) return normalizeHexColor(fallback)

  let red = 0
  let green = 0
  let blue = 0
  let totalWeight = 0
  let vivid = null

  for (let index = 0; index < pixelData.length; index += 4) {
    const alpha = pixelData[index + 3] / 255
    if (alpha < 0.35) continue
    const r = pixelData[index]
    const g = pixelData[index + 1]
    const b = pixelData[index + 2]
    const maximum = Math.max(r, g, b)
    const minimum = Math.min(r, g, b)
    const lightness = (maximum + minimum) / 2
    if (lightness < 18 || lightness > 242) continue
    const saturation = maximum === minimum
      ? 0
      : (maximum - minimum) / (255 - Math.abs(2 * lightness - 255))
    const weight = alpha * (0.4 + saturation * 1.9)
    red += r * weight
    green += g * weight
    blue += b * weight
    totalWeight += weight

    const vividScore = saturation * 0.75 + (1 - Math.abs(lightness - 138) / 138) * 0.25
    if (!vivid || vividScore > vivid.score) vivid = { r, g, b, score: vividScore }
  }

  if (!totalWeight || !vivid) return normalizeHexColor(fallback)
  let r = red / totalWeight * 0.68 + vivid.r * 0.32
  let g = green / totalWeight * 0.68 + vivid.g * 0.32
  let b = blue / totalWeight * 0.68 + vivid.b * 0.32
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b

  if (luminance < 72) {
    const amount = Math.min(0.42, (72 - luminance) / 120)
    r += (255 - r) * amount
    g += (255 - g) * amount
    b += (255 - b) * amount
  } else if (luminance > 205) {
    const amount = Math.min(0.28, (luminance - 205) / 120)
    r *= 1 - amount
    g *= 1 - amount
    b *= 1 - amount
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function sampleImage(url, fallback) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 48
        canvas.height = 48
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(selectAdaptiveGlowColor(context.getImageData(0, 0, canvas.width, canvas.height).data, fallback))
      } catch (error) {
        reject(error)
      }
    }
    image.onerror = () => reject(new Error('Could not sample background color.'))
    image.src = url
  })
}

export async function extractAdaptiveGlowColor(urls, fallback = '#8ba6ff') {
  for (const url of urls.filter(Boolean)) {
    try {
      return await sampleImage(url, fallback)
    } catch {
      // Try the original asset when a preview is unavailable.
    }
  }
  return normalizeHexColor(fallback)
}
