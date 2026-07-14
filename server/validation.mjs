import { z } from 'zod'
import { HttpError } from './http.mjs'

export const uuid = z.string().uuid()
export const profile = z.enum(['wide', 'compact'])
export const httpUrl = z.string().trim().url().refine((value) => {
  const protocol = new URL(value).protocol
  return protocol === 'http:' || protocol === 'https:'
}, 'Only HTTP and HTTPS URLs are supported')

export const placement = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive().max(400),
  height: z.number().finite().positive().max(400),
})

export const placements = z.object({ wide: placement, compact: placement })

export function parse(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new HttpError(400, 'Validation failed', result.error.flatten())
  }
  return result.data
}

export function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'workspace'
}

export function deepMerge(target, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const result = { ...(target && typeof target === 'object' && !Array.isArray(target) ? target : {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(result[key], value)
      : value
  }
  return result
}
