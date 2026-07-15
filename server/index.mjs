import crypto from 'node:crypto'
import http from 'node:http'
import { z } from 'zod'
import { migrate, pool, transaction } from './db.mjs'
import { handleError, HttpError, readJson, routeMatch, sendEmpty, sendJson } from './http.mjs'
import { insertUploadedIcon, resolveShortcutIcon } from './icons.mjs'
import { loadBootstrap } from './queries.mjs'
import { deepMerge, httpUrl, parse, placement, placements, slugify, uuid } from './validation.mjs'

const PORT = Number(process.env.PORT || 3110)
const CANVASES = {
  wide: { width: 1600, height: 1000 },
  compact: { width: 820, height: 1000 },
}

const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().optional(),
  icon: z.string().trim().max(80).optional(),
})

const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  slug: z.string().trim().optional(),
  icon: z.string().trim().max(80).nullable().optional(),
  fontFamily: z.string().trim().max(200).nullable().optional(),
  textColor: z.string().trim().max(40).nullable().optional(),
  accentColor: z.string().trim().max(40).nullable().optional(),
  backgroundAssetId: uuid.nullable().optional(),
  version: z.number().int().positive(),
})

const shortcutCreateSchema = z.object({
  workspaceId: uuid,
  parentFolderId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(120),
  url: httpUrl,
  iconOverrideUrl: z.union([httpUrl, z.literal(''), z.null()]).optional(),
  iconData: z.string().max(1_100_000).optional(),
  iconMimeType: z.string().max(80).optional(),
  placements,
  mutationId: z.string().max(200).optional(),
})

const shortcutUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  url: httpUrl.optional(),
  iconOverrideUrl: z.union([httpUrl, z.literal(''), z.null()]).optional(),
  iconData: z.string().max(1_100_000).optional(),
  iconMimeType: z.string().max(80).optional(),
  version: z.number().int().positive(),
  mutationId: z.string().max(200).optional(),
})

const placementUpdateSchema = placement.pick({ x: true, y: true }).extend({
  profile: z.enum(['wide', 'compact']),
  version: z.number().int().positive(),
  mutationId: z.string().max(200).optional(),
})

const itemWorkspaceSchema = z.object({
  destinationWorkspaceId: uuid,
  placements,
  version: z.number().int().positive(),
  mutationId: z.string().max(200).optional(),
})

const pinItemSchema = z.object({
  destinations: z.array(z.object({
    workspaceId: uuid,
    placements,
  })).min(1).max(80),
  version: z.number().int().positive(),
  mutationId: z.string().max(200).optional(),
})

const workspaceAgentPreferencesSchema = z.object({
  cwd: z.string().trim().min(1).max(4096).nullable().optional(),
  provider: z.string().trim().min(1).max(100).nullable().optional(),
  model: z.string().trim().min(1).max(240).nullable().optional(),
  version: z.number().int().nonnegative(),
  mutationId: z.string().max(200).optional(),
})

const agentSessionLinkSchema = z.object({
  workspaceId: uuid,
  hermesSessionId: z.string().trim().min(1).max(200),
  titleOverride: z.string().trim().min(1).max(200).nullable().optional(),
  mutationId: z.string().max(200).optional(),
})

const agentSessionUpdateSchema = z.object({
  titleOverride: z.string().trim().min(1).max(200).nullable().optional(),
  pinned: z.boolean().optional(),
  version: z.number().int().positive(),
  mutationId: z.string().max(200).optional(),
})

function assertPlacementBounds(profileName, value) {
  const canvas = CANVASES[profileName]
  if (value.x + value.width > canvas.width || value.y + value.height > canvas.height) {
    throw new HttpError(400, `Placement must remain inside the ${profileName} canvas`)
  }
}

function requestMutationId(request, body) {
  const header = request.headers['idempotency-key']
  const value = Array.isArray(header) ? header[0] : header
  return value || body?.mutationId || null
}

async function mutate(request, response, operation, body, handler) {
  const mutationId = requestMutationId(request, body)
  const result = await transaction(async (client) => {
    if (mutationId) {
      const cached = await client.query(
        'SELECT operation, response_status, response_body FROM mutation_log WHERE mutation_id = $1',
        [mutationId],
      )
      if (cached.rowCount) {
        if (cached.rows[0].operation !== operation) {
          throw new HttpError(409, 'That mutation ID was already used for another operation')
        }
        return { status: cached.rows[0].response_status, body: cached.rows[0].response_body }
      }
    }

    const mutationResult = await handler(client)
    const normalized = mutationResult?.status
      ? mutationResult
      : { status: 200, body: mutationResult }

    if (mutationId) {
      await client.query(`
        INSERT INTO mutation_log(mutation_id, operation, response_status, response_body)
        VALUES ($1, $2, $3, $4::jsonb)
      `, [mutationId, operation, normalized.status, JSON.stringify(normalized.body)])
    }
    return normalized
  })
  sendJson(response, result.status, result.body)
}

async function bootstrapResponse(client, extra = {}) {
  return { ...extra, bootstrap: await loadBootstrap(client) }
}

async function moveFolderChildrenToRoot(client, folderId, workspaceId) {
  const children = await client.query(`
    SELECT i.id, p.profile, p.width, p.height
    FROM shortcut_items i
    JOIN item_placements p ON p.item_id = i.id
    WHERE i.parent_folder_id = $1
    ORDER BY i.created_at, p.profile
  `, [folderId])
  const occupiedRows = await client.query(`
    SELECT profile, x, y, width, height
    FROM item_placements
    WHERE workspace_id = $1 AND container_key = 'root' AND item_id <> $2
  `, [workspaceId, folderId])
  const occupied = { wide: [], compact: [] }
  for (const row of occupiedRows.rows) {
    occupied[row.profile].push({ x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height) })
  }

  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  const findOpen = (profileName, width, height) => {
    const canvas = CANVASES[profileName]
    for (let y = 64; y + height <= canvas.height; y += 24) {
      for (let x = 64; x + width <= canvas.width; x += 24) {
        const candidate = { x, y, width, height }
        if (!occupied[profileName].some((rect) => intersects(candidate, rect))) {
          occupied[profileName].push(candidate)
          return candidate
        }
      }
    }
    throw new HttpError(409, `No collision-free space remains in the ${profileName} canvas`)
  }

  for (const row of children.rows) {
    const position = findOpen(row.profile, Number(row.width), Number(row.height))
    await client.query(`
      UPDATE item_placements
      SET container_key = 'root', x = $3, y = $4, version = version + 1, updated_at = now()
      WHERE item_id = $1 AND profile = $2
    `, [row.id, row.profile, position.x, position.y])
  }
  await client.query(`
    UPDATE shortcut_items
    SET parent_folder_id = NULL, version = version + 1, updated_at = now()
    WHERE parent_folder_id = $1
  `, [folderId])
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
  const { pathname } = url

  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-headers', 'content-type, idempotency-key')
  response.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  if (request.method === 'OPTIONS') return sendEmpty(response)

  if (request.method === 'GET' && pathname === '/api/health') {
    const result = await pool.query('SELECT now() AS now')
    return sendJson(response, 200, { ok: true, database: true, now: result.rows[0].now })
  }

  if (request.method === 'GET' && pathname === '/api/bootstrap') {
    return sendJson(response, 200, await loadBootstrap(pool))
  }

  if (request.method === 'POST' && pathname === '/api/assets') {
    const body = await readJson(request, 28 * 1024 * 1024)
    const data = parse(z.object({
      kind: z.enum(['background', 'shortcut_icon']),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
      data: z.string().max(27 * 1024 * 1024),
      originalName: z.string().trim().min(1).max(255).optional(),
      mutationId: z.string().max(200).optional(),
    }), body)
    return mutate(request, response, `asset.create:${data.kind}`, data, async (client) => {
      const content = Buffer.from(data.data, 'base64')
      const maxBytes = data.kind === 'background' ? 20 * 1024 * 1024 : 768 * 1024
      if (!content.length || content.length > maxBytes) throw new HttpError(400, `Asset must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB`)
      const sha256 = crypto.createHash('sha256').update(content).digest('hex')
      const id = crypto.randomUUID()
      const asset = await client.query(`
        INSERT INTO assets(id, kind, mime_type, sha256, byte_length, content, original_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (kind, sha256) DO UPDATE
          SET original_name = COALESCE(assets.original_name, EXCLUDED.original_name)
        RETURNING id
      `, [id, data.kind, data.mimeType, sha256, content.length, content, data.originalName || null])
      return { status: 201, body: { assetId: asset.rows[0].id } }
    })
  }

  let match = routeMatch(pathname, /^\/api\/assets\/([0-9a-f-]+)$/)
  if (request.method === 'GET' && match) {
    const result = await pool.query('SELECT mime_type, content, sha256 FROM assets WHERE id = $1', [match[0]])
    if (!result.rowCount) throw new HttpError(404, 'Asset not found')
    const asset = result.rows[0]
    response.writeHead(200, {
      'content-type': asset.mime_type,
      'content-length': asset.content.length,
      etag: `"${asset.sha256}"`,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    })
    return response.end(asset.content)
  }

  if (request.method === 'DELETE' && match) {
    const body = await readJson(request)
    const data = parse(z.object({ mutationId: z.string().max(200).optional() }), body)
    return mutate(request, response, 'asset.delete', data, async (client) => {
      const asset = await client.query('SELECT kind FROM assets WHERE id = $1 FOR UPDATE', [match[0]])
      if (!asset.rowCount) throw new HttpError(404, 'Asset not found')
      if (asset.rows[0].kind !== 'background') throw new HttpError(400, 'Only background assets can be removed from the library')
      const referenced = await client.query(`
        SELECT EXISTS(SELECT 1 FROM workspaces WHERE background_asset_id = $1::uuid)
          OR EXISTS(
            SELECT 1 FROM app_settings
            WHERE document #>> '{backgrounds,globalAssetId}' = $1::text
          ) AS value
      `, [match[0]])
      if (referenced.rows[0].value) throw new HttpError(409, 'Select another background before removing this one')
      await client.query('DELETE FROM assets WHERE id = $1', [match[0]])
      return { status: 200, body: { bootstrap: await loadBootstrap(client) } }
    })
  }

  if (request.method === 'PATCH' && pathname === '/api/settings') {
    const body = await readJson(request)
    const data = parse(z.object({
      version: z.number().int().positive(),
      patch: z.record(z.unknown()),
      mutationId: z.string().max(200).optional(),
    }), body)
    return mutate(request, response, 'settings.patch', data, async (client) => {
      const current = await client.query("SELECT document, version FROM app_settings WHERE id = 'default' FOR UPDATE")
      if (!current.rowCount || Number(current.rows[0].version) !== data.version) {
        throw new HttpError(409, 'Settings changed elsewhere. Reload and try again.', { code: 'VERSION_CONFLICT' })
      }
      const document = deepMerge(current.rows[0].document, data.patch)
      await client.query(`
        UPDATE app_settings SET document = $1::jsonb, version = version + 1, updated_at = now()
        WHERE id = 'default'
      `, [JSON.stringify(document)])
      return bootstrapResponse(client)
    })
  }

  if (request.method === 'POST' && pathname === '/api/workspaces') {
    const body = await readJson(request)
    const data = parse(workspaceCreateSchema.extend({ mutationId: z.string().max(200).optional() }), body)
    return mutate(request, response, 'workspace.create', data, async (client) => {
      const id = crypto.randomUUID()
      const slug = slugify(data.slug || data.name)
      const order = await client.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM workspaces')
      await client.query(`
        INSERT INTO workspaces(id, name, slug, sort_order, icon)
        VALUES ($1, $2, $3, $4, $5)
      `, [id, data.name, slug, order.rows[0].next, data.icon || 'Layers'])
      return { status: 201, body: await bootstrapResponse(client, { workspaceId: id }) }
    })
  }

  if (request.method === 'PUT' && pathname === '/api/workspaces/reorder') {
    const body = await readJson(request)
    const data = parse(z.object({ ids: z.array(uuid).min(1).max(80), mutationId: z.string().max(200).optional() }), body)
    if (new Set(data.ids).size !== data.ids.length) throw new HttpError(400, 'Workspace order contains duplicate IDs')
    return mutate(request, response, 'workspace.reorder', data, async (client) => {
      const current = await client.query('SELECT id FROM workspaces ORDER BY sort_order FOR UPDATE')
      if (current.rowCount !== data.ids.length || current.rows.some((row) => !data.ids.includes(row.id))) {
        throw new HttpError(409, 'Workspace list changed; reload before reordering')
      }
      await client.query('UPDATE workspaces SET sort_order = sort_order + 10000')
      for (const [index, id] of data.ids.entries()) {
        await client.query('UPDATE workspaces SET sort_order = $2, version = version + 1, updated_at = now() WHERE id = $1', [id, index])
      }
      return bootstrapResponse(client)
    })
  }

  match = routeMatch(pathname, /^\/api\/workspaces\/([0-9a-f-]+)$/)
  if (request.method === 'PATCH' && match) {
    const body = await readJson(request)
    const data = parse(workspaceUpdateSchema.extend({ mutationId: z.string().max(200).optional() }), body)
    return mutate(request, response, `workspace.update:${match[0]}`, data, async (client) => {
      const current = await client.query('SELECT * FROM workspaces WHERE id = $1 FOR UPDATE', [match[0]])
      if (!current.rowCount) throw new HttpError(404, 'Workspace not found')
      if (Number(current.rows[0].version) !== data.version) throw new HttpError(409, 'Workspace changed elsewhere')
      const row = current.rows[0]
      await client.query(`
        UPDATE workspaces SET
          name = $2, slug = $3, icon = $4, font_family = $5,
          text_color = $6, accent_color = $7, background_asset_id = $8,
          version = version + 1, updated_at = now()
        WHERE id = $1
      `, [
        match[0], data.name ?? row.name, data.slug === undefined ? row.slug : slugify(data.slug),
        data.icon === undefined ? row.icon : data.icon,
        data.fontFamily === undefined ? row.font_family : data.fontFamily,
        data.textColor === undefined ? row.text_color : data.textColor,
        data.accentColor === undefined ? row.accent_color : data.accentColor,
        data.backgroundAssetId === undefined ? row.background_asset_id : data.backgroundAssetId,
      ])
      return bootstrapResponse(client)
    })
  }

  if (request.method === 'DELETE' && match) {
    const body = await readJson(request)
    return mutate(request, response, `workspace.delete:${match[0]}`, body, async (client) => {
      const count = await client.query('SELECT count(*)::int AS count FROM workspaces')
      if (count.rows[0].count <= 1) throw new HttpError(409, 'V Start 2 must keep at least one workspace')
      const deleted = await client.query('DELETE FROM workspaces WHERE id = $1 RETURNING id', [match[0]])
      if (!deleted.rowCount) throw new HttpError(404, 'Workspace not found')
      const first = await client.query('SELECT id FROM workspaces ORDER BY sort_order LIMIT 1')
      await client.query(`
        UPDATE app_state SET value = to_jsonb($1::text), version = version + 1, updated_at = now()
        WHERE key = 'last_active_workspace_id' AND value = to_jsonb($2::text)
      `, [first.rows[0].id, match[0]])
      return bootstrapResponse(client)
    })
  }

  if (request.method === 'PUT' && pathname === '/api/state/active-workspace') {
    const body = await readJson(request)
    const data = parse(z.object({ workspaceId: uuid, mutationId: z.string().max(200).optional() }), body)
    return mutate(request, response, 'state.active-workspace', data, async (client) => {
      const workspace = await client.query('SELECT 1 FROM workspaces WHERE id = $1', [data.workspaceId])
      if (!workspace.rowCount) throw new HttpError(404, 'Workspace not found')
      await client.query(`
        INSERT INTO app_state(key, value) VALUES ('last_active_workspace_id', to_jsonb($1::text))
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, version = app_state.version + 1, updated_at = now()
      `, [data.workspaceId])
      return { ok: true }
    })
  }

  match = routeMatch(pathname, /^\/api\/workspaces\/([0-9a-f-]+)\/agent-preferences$/)
  if (request.method === 'PUT' && match) {
    const body = await readJson(request)
    const data = parse(workspaceAgentPreferencesSchema, body)
    return mutate(request, response, `agent.preferences:${match[0]}`, data, async (client) => {
      const workspace = await client.query('SELECT 1 FROM workspaces WHERE id = $1', [match[0]])
      if (!workspace.rowCount) throw new HttpError(404, 'Workspace not found')
      const current = await client.query('SELECT * FROM workspace_agent_preferences WHERE workspace_id = $1 FOR UPDATE', [match[0]])
      if (!current.rowCount) {
        if (data.version !== 0) throw new HttpError(409, 'Agent preferences changed elsewhere')
        await client.query(`
          INSERT INTO workspace_agent_preferences(workspace_id, cwd, provider, model)
          VALUES ($1, $2, $3, $4)
        `, [match[0], data.cwd || null, data.provider || null, data.model || null])
      } else {
        const row = current.rows[0]
        if (Number(row.version) !== data.version) throw new HttpError(409, 'Agent preferences changed elsewhere')
        await client.query(`
          UPDATE workspace_agent_preferences
          SET cwd = $2, provider = $3, model = $4,
              version = version + 1, updated_at = now()
          WHERE workspace_id = $1
        `, [
          match[0],
          data.cwd === undefined ? row.cwd : data.cwd,
          data.provider === undefined ? row.provider : data.provider,
          data.model === undefined ? row.model : data.model,
        ])
      }
      return bootstrapResponse(client)
    })
  }

  if (request.method === 'POST' && pathname === '/api/agent/sessions') {
    const body = await readJson(request)
    const data = parse(agentSessionLinkSchema, body)
    return mutate(request, response, `agent.session.link:${data.workspaceId}:${data.hermesSessionId}`, data, async (client) => {
      const workspace = await client.query('SELECT 1 FROM workspaces WHERE id = $1', [data.workspaceId])
      if (!workspace.rowCount) throw new HttpError(404, 'Workspace not found')
      const id = crypto.randomUUID()
      const linked = await client.query(`
        INSERT INTO agent_session_links(id, workspace_id, hermes_session_id, title_override)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (workspace_id, hermes_session_id) DO UPDATE
        SET title_override = COALESCE(EXCLUDED.title_override, agent_session_links.title_override),
            last_opened_at = now(), version = agent_session_links.version + 1, updated_at = now()
        RETURNING id
      `, [id, data.workspaceId, data.hermesSessionId, data.titleOverride || null])
      return bootstrapResponse(client, { agentSessionLinkId: linked.rows[0].id })
    })
  }

  match = routeMatch(pathname, /^\/api\/agent\/sessions\/([0-9a-f-]+)$/)
  if (request.method === 'PATCH' && match) {
    const body = await readJson(request)
    const data = parse(agentSessionUpdateSchema, body)
    return mutate(request, response, `agent.session.update:${match[0]}`, data, async (client) => {
      const current = await client.query('SELECT * FROM agent_session_links WHERE id = $1 FOR UPDATE', [match[0]])
      if (!current.rowCount) throw new HttpError(404, 'Agent session link not found')
      const row = current.rows[0]
      if (Number(row.version) !== data.version) throw new HttpError(409, 'Agent session link changed elsewhere')
      await client.query(`
        UPDATE agent_session_links
        SET title_override = $2, pinned = $3, version = version + 1, updated_at = now()
        WHERE id = $1
      `, [
        match[0],
        data.titleOverride === undefined ? row.title_override : data.titleOverride,
        data.pinned === undefined ? row.pinned : data.pinned,
      ])
      return bootstrapResponse(client)
    })
  }

  if (request.method === 'DELETE' && match) {
    const body = await readJson(request)
    const data = parse(z.object({ version: z.number().int().positive(), mutationId: z.string().max(200).optional() }), body)
    return mutate(request, response, `agent.session.unlink:${match[0]}`, data, async (client) => {
      const deleted = await client.query('DELETE FROM agent_session_links WHERE id = $1 AND version = $2 RETURNING id', [match[0], data.version])
      if (!deleted.rowCount) throw new HttpError(409, 'Agent session link changed or no longer exists')
      return bootstrapResponse(client)
    })
  }

  if (request.method === 'POST' && pathname === '/api/shortcuts') {
    const body = await readJson(request, 2 * 1024 * 1024)
    const data = parse(shortcutCreateSchema, body)
    for (const profileName of Object.keys(CANVASES)) assertPlacementBounds(profileName, data.placements[profileName])
    return mutate(request, response, 'shortcut.create', data, async (client) => {
      const workspace = await client.query('SELECT 1 FROM workspaces WHERE id = $1', [data.workspaceId])
      if (!workspace.rowCount) throw new HttpError(404, 'Workspace not found')
      if (data.parentFolderId) {
        const folder = await client.query('SELECT kind, workspace_id FROM shortcut_items WHERE id = $1 FOR SHARE', [data.parentFolderId])
        if (!folder.rowCount || folder.rows[0].kind !== 'folder') throw new HttpError(404, 'Folder not found')
        if (folder.rows[0].workspace_id !== data.workspaceId) throw new HttpError(409, 'Folder belongs to a different workspace')
      }
      const icon = data.iconData
        ? {
            iconAssetId: await insertUploadedIcon(client, data.iconMimeType || 'application/octet-stream', Buffer.from(data.iconData, 'base64')),
            faviconUrl: null,
            warning: null,
          }
        : await resolveShortcutIcon(client, data.url, data.iconOverrideUrl || null)
      const id = crypto.randomUUID()
      await client.query(`
        INSERT INTO shortcut_items(
          id, workspace_id, parent_folder_id, kind, title, url, icon_asset_id, icon_override_url, favicon_url
        ) VALUES ($1, $2, $3, 'shortcut', $4, $5, $6, $7, $8)
      `, [id, data.workspaceId, data.parentFolderId || null, data.title, data.url, icon.iconAssetId, data.iconOverrideUrl || null, icon.faviconUrl])
      for (const profileName of Object.keys(CANVASES)) {
        const value = data.placements[profileName]
        await client.query(`
          INSERT INTO item_placements(item_id, workspace_id, container_key, profile, x, y, width, height)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [id, data.workspaceId, data.parentFolderId || 'root', profileName, value.x, value.y, value.width, value.height])
      }
      return { status: 201, body: await bootstrapResponse(client, { itemId: id, iconWarning: icon.warning }) }
    })
  }

  if (request.method === 'POST' && pathname === '/api/folders') {
    const body = await readJson(request)
    const data = parse(z.object({
      workspaceId: uuid,
      title: z.string().trim().min(1).max(120),
      placements,
      mutationId: z.string().max(200).optional(),
    }), body)
    for (const profileName of Object.keys(CANVASES)) assertPlacementBounds(profileName, data.placements[profileName])
    return mutate(request, response, 'folder.create', data, async (client) => {
      const workspace = await client.query('SELECT 1 FROM workspaces WHERE id = $1', [data.workspaceId])
      if (!workspace.rowCount) throw new HttpError(404, 'Workspace not found')
      const folderId = crypto.randomUUID()
      await client.query(`
        INSERT INTO shortcut_items(id, workspace_id, kind, title)
        VALUES ($1, $2, 'folder', $3)
      `, [folderId, data.workspaceId, data.title])
      for (const profileName of Object.keys(CANVASES)) {
        const value = data.placements[profileName]
        await client.query(`
          INSERT INTO item_placements(item_id, workspace_id, container_key, profile, x, y, width, height)
          VALUES ($1, $2, 'root', $3, $4, $5, $6, $7)
        `, [folderId, data.workspaceId, profileName, value.x, value.y, value.width, value.height])
      }
      return { status: 201, body: await bootstrapResponse(client, { folderId }) }
    })
  }

  match = routeMatch(pathname, /^\/api\/items\/([0-9a-f-]+)$/)
  if (request.method === 'PATCH' && match) {
    const body = await readJson(request, 2 * 1024 * 1024)
    const data = parse(shortcutUpdateSchema, body)
    return mutate(request, response, `item.update:${match[0]}`, data, async (client) => {
      const current = await client.query('SELECT * FROM shortcut_items WHERE id = $1 FOR UPDATE', [match[0]])
      if (!current.rowCount) throw new HttpError(404, 'Shortcut not found')
      const row = current.rows[0]
      if (Number(row.version) !== data.version) throw new HttpError(409, 'Shortcut changed elsewhere')
      if (row.kind === 'folder' && (data.url !== undefined || data.iconOverrideUrl !== undefined || data.iconData !== undefined)) {
        throw new HttpError(400, 'Folders do not have destination or image URLs')
      }
      const destination = data.url ?? row.url
      const override = data.iconOverrideUrl === undefined ? row.icon_override_url : (data.iconOverrideUrl || null)
      let icon = { iconAssetId: row.icon_asset_id, faviconUrl: row.favicon_url, warning: null }
      if (row.kind === 'shortcut' && data.iconData) {
        icon = {
          iconAssetId: await insertUploadedIcon(client, data.iconMimeType || 'application/octet-stream', Buffer.from(data.iconData, 'base64')),
          faviconUrl: null,
          warning: null,
        }
      } else if (row.kind === 'shortcut' && (data.url !== undefined || data.iconOverrideUrl !== undefined)) {
        icon = await resolveShortcutIcon(client, destination, override)
      }
      const itemSelector = row.pin_group_id ? 'pin_group_id = $1' : 'id = $1'
      await client.query(`
        UPDATE shortcut_items SET title = $2, url = $3, icon_override_url = $4,
          icon_asset_id = $5, favicon_url = $6, version = version + 1, updated_at = now()
        WHERE ${itemSelector}
      `, [row.pin_group_id || match[0], data.title ?? row.title, destination, override, icon.iconAssetId, icon.faviconUrl])
      return bootstrapResponse(client, { iconWarning: icon.warning })
    })
  }

  if (request.method === 'DELETE' && match) {
    const body = await readJson(request)
    return mutate(request, response, `item.delete:${match[0]}`, body, async (client) => {
      await client.query('SET CONSTRAINTS item_placements_no_overlap DEFERRED')
      const item = await client.query('SELECT * FROM shortcut_items WHERE id = $1 FOR UPDATE', [match[0]])
      if (!item.rowCount) throw new HttpError(404, 'Item not found')
      if (item.rows[0].kind === 'folder' && body.action === 'returnChildren') {
        await moveFolderChildrenToRoot(client, match[0], item.rows[0].workspace_id)
      }
      const pinGroupId = item.rows[0].pin_group_id
      await client.query('DELETE FROM shortcut_items WHERE id = $1', [match[0]])
      if (pinGroupId) {
        const remaining = await client.query('SELECT id FROM shortcut_items WHERE pin_group_id = $1 FOR UPDATE', [pinGroupId])
        if (remaining.rowCount === 1) {
          await client.query(`
            UPDATE shortcut_items SET pin_group_id = NULL, version = version + 1, updated_at = now()
            WHERE id = $1
          `, [remaining.rows[0].id])
        }
      }
      return bootstrapResponse(client)
    })
  }

  match = routeMatch(pathname, /^\/api\/items\/([0-9a-f-]+)\/placement$/)
  if (request.method === 'PUT' && match) {
    const body = await readJson(request)
    const data = parse(placementUpdateSchema, body)
    return mutate(request, response, `placement.update:${match[0]}:${data.profile}`, data, async (client) => {
      const current = await client.query(`
        SELECT width, height, version FROM item_placements
        WHERE item_id = $1 AND profile = $2 FOR UPDATE
      `, [match[0], data.profile])
      if (!current.rowCount) throw new HttpError(404, 'Placement not found')
      if (Number(current.rows[0].version) !== data.version) throw new HttpError(409, 'Placement changed elsewhere')
      const next = { ...data, width: Number(current.rows[0].width), height: Number(current.rows[0].height) }
      assertPlacementBounds(data.profile, next)
      await client.query(`
        UPDATE item_placements SET x = $3, y = $4, version = version + 1, updated_at = now()
        WHERE item_id = $1 AND profile = $2
      `, [match[0], data.profile, data.x, data.y])
      return bootstrapResponse(client)
    })
  }

  match = routeMatch(pathname, /^\/api\/items\/([0-9a-f-]+)\/workspace$/)
  if (request.method === 'PUT' && match) {
    const body = await readJson(request)
    const data = parse(itemWorkspaceSchema, body)
    for (const profileName of Object.keys(CANVASES)) assertPlacementBounds(profileName, data.placements[profileName])
    return mutate(request, response, `item.workspace:${match[0]}`, data, async (client) => {
      await client.query('SET CONSTRAINTS item_placements_no_overlap DEFERRED')
      const item = await client.query('SELECT * FROM shortcut_items WHERE id = $1 FOR UPDATE', [match[0]])
      if (!item.rowCount) throw new HttpError(404, 'Item not found')
      const row = item.rows[0]
      if (Number(row.version) !== data.version) throw new HttpError(409, 'Item changed elsewhere')
      if (row.parent_folder_id) throw new HttpError(409, 'Move this shortcut out of its folder first')
      if (row.pin_group_id) throw new HttpError(409, 'Unpin this shortcut before moving it to one workspace')
      if (row.workspace_id === data.destinationWorkspaceId) throw new HttpError(400, 'Choose a different workspace')
      const destination = await client.query('SELECT 1 FROM workspaces WHERE id = $1', [data.destinationWorkspaceId])
      if (!destination.rowCount) throw new HttpError(404, 'Destination workspace not found')

      const members = await client.query(`
        SELECT id FROM shortcut_items WHERE id = $1 OR parent_folder_id = $1 FOR UPDATE
      `, [match[0]])
      const itemIds = members.rows.map((value) => value.id)
      await client.query(`
        UPDATE shortcut_items SET workspace_id = $2, version = version + 1, updated_at = now()
        WHERE id = ANY($1::uuid[])
      `, [itemIds, data.destinationWorkspaceId])
      await client.query(`
        UPDATE item_placements SET workspace_id = $2, version = version + 1, updated_at = now()
        WHERE item_id = ANY($1::uuid[])
      `, [itemIds, data.destinationWorkspaceId])
      for (const profileName of Object.keys(CANVASES)) {
        const value = data.placements[profileName]
        await client.query(`
          UPDATE item_placements SET container_key = 'root', x = $3, y = $4,
            width = $5, height = $6, version = version + 1, updated_at = now()
          WHERE item_id = $1 AND profile = $2
        `, [match[0], profileName, value.x, value.y, value.width, value.height])
      }
      return bootstrapResponse(client)
    })
  }

  match = routeMatch(pathname, /^\/api\/items\/([0-9a-f-]+)\/pin$/)
  if (request.method === 'POST' && match) {
    const body = await readJson(request)
    const data = parse(pinItemSchema, body)
    const destinationIds = data.destinations.map((value) => value.workspaceId)
    if (new Set(destinationIds).size !== destinationIds.length) throw new HttpError(400, 'A workspace can only appear once')
    for (const destination of data.destinations) {
      for (const profileName of Object.keys(CANVASES)) assertPlacementBounds(profileName, destination.placements[profileName])
    }
    return mutate(request, response, `item.pin:${match[0]}`, data, async (client) => {
      await client.query('SET CONSTRAINTS item_placements_no_overlap DEFERRED')
      const item = await client.query('SELECT * FROM shortcut_items WHERE id = $1 FOR UPDATE', [match[0]])
      if (!item.rowCount) throw new HttpError(404, 'Shortcut not found')
      const row = item.rows[0]
      if (Number(row.version) !== data.version) throw new HttpError(409, 'Shortcut changed elsewhere')
      if (row.kind !== 'shortcut' || row.parent_folder_id) throw new HttpError(409, 'Only root shortcuts can be pinned across workspaces')
      if (row.pin_group_id) throw new HttpError(409, 'This shortcut is already pinned across workspaces')

      const workspaceRows = await client.query('SELECT id FROM workspaces ORDER BY sort_order FOR SHARE')
      const expectedIds = workspaceRows.rows.map((value) => value.id).filter((id) => id !== row.workspace_id)
      if (expectedIds.length !== destinationIds.length || expectedIds.some((id) => !destinationIds.includes(id))) {
        throw new HttpError(409, 'Workspace list changed; reopen the menu and try pinning again')
      }

      const pinGroupId = crypto.randomUUID()
      await client.query(`
        UPDATE shortcut_items SET pin_group_id = $2, version = version + 1, updated_at = now()
        WHERE id = $1
      `, [match[0], pinGroupId])
      for (const destination of data.destinations) {
        const cloneId = crypto.randomUUID()
        await client.query(`
          INSERT INTO shortcut_items(
            id, workspace_id, pin_group_id, kind, title, url, icon_asset_id,
            icon_override_url, favicon_url
          ) VALUES ($1, $2, $3, 'shortcut', $4, $5, $6, $7, $8)
        `, [
          cloneId, destination.workspaceId, pinGroupId, row.title, row.url,
          row.icon_asset_id, row.icon_override_url, row.favicon_url,
        ])
        for (const profileName of Object.keys(CANVASES)) {
          const value = destination.placements[profileName]
          await client.query(`
            INSERT INTO item_placements(item_id, workspace_id, container_key, profile, x, y, width, height)
            VALUES ($1, $2, 'root', $3, $4, $5, $6, $7)
          `, [cloneId, destination.workspaceId, profileName, value.x, value.y, value.width, value.height])
        }
      }
      return bootstrapResponse(client)
    })
  }

  if (request.method === 'DELETE' && match) {
    const body = await readJson(request)
    const data = parse(z.object({
      version: z.number().int().positive(),
      mutationId: z.string().max(200).optional(),
    }), body)
    return mutate(request, response, `item.unpin:${match[0]}`, data, async (client) => {
      const item = await client.query('SELECT * FROM shortcut_items WHERE id = $1 FOR UPDATE', [match[0]])
      if (!item.rowCount) throw new HttpError(404, 'Shortcut not found')
      const row = item.rows[0]
      if (Number(row.version) !== data.version) throw new HttpError(409, 'Shortcut changed elsewhere')
      if (!row.pin_group_id) throw new HttpError(409, 'This shortcut is not pinned across workspaces')
      await client.query('DELETE FROM shortcut_items WHERE pin_group_id = $1 AND id <> $2', [row.pin_group_id, match[0]])
      await client.query(`
        UPDATE shortcut_items SET pin_group_id = NULL, version = version + 1, updated_at = now()
        WHERE id = $1
      `, [match[0]])
      return bootstrapResponse(client)
    })
  }

  if (request.method === 'POST' && pathname === '/api/folders/merge') {
    const body = await readJson(request)
    const data = parse(z.object({
      sourceId: uuid,
      targetId: uuid,
      title: z.string().trim().min(1).max(120).default('New Folder'),
      mutationId: z.string().max(200).optional(),
    }), body)
    if (data.sourceId === data.targetId) throw new HttpError(400, 'Choose two different shortcuts')
    return mutate(request, response, 'folder.merge', data, async (client) => {
      await client.query('SET CONSTRAINTS item_placements_no_overlap DEFERRED')
      const items = await client.query(`
        SELECT * FROM shortcut_items WHERE id = ANY($1::uuid[]) FOR UPDATE
      `, [[data.sourceId, data.targetId]])
      if (items.rowCount !== 2) throw new HttpError(404, 'One of the shortcuts no longer exists')
      if (items.rows.some((row) => row.kind !== 'shortcut' || row.parent_folder_id || row.pin_group_id)) {
        throw new HttpError(409, 'Only unpinned root shortcuts can be merged into a new folder')
      }
      if (items.rows[0].workspace_id !== items.rows[1].workspace_id) throw new HttpError(409, 'Shortcuts must share a workspace')
      const workspaceId = items.rows[0].workspace_id
      const positions = await client.query(`
        SELECT * FROM item_placements WHERE item_id = ANY($1::uuid[]) FOR UPDATE
      `, [[data.sourceId, data.targetId]])
      const byItem = new Map()
      for (const row of positions.rows) {
        if (!byItem.has(row.item_id)) byItem.set(row.item_id, [])
        byItem.get(row.item_id).push(row)
      }
      const folderId = crypto.randomUUID()
      await client.query(`
        INSERT INTO shortcut_items(id, workspace_id, kind, title)
        VALUES ($1, $2, 'folder', $3)
      `, [folderId, workspaceId, data.title])
      await client.query(`
        UPDATE shortcut_items SET parent_folder_id = $3, version = version + 1, updated_at = now()
        WHERE id = ANY($1::uuid[]) AND workspace_id = $2
      `, [[data.sourceId, data.targetId], workspaceId, folderId])

      for (const profileName of Object.keys(CANVASES)) {
        const target = byItem.get(data.targetId).find((row) => row.profile === profileName)
        const childWidth = Number(target.width)
        await client.query(`
          UPDATE item_placements SET container_key = $2,
            x = CASE WHEN item_id = $3 THEN 24 ELSE $4 END,
            y = 24, version = version + 1, updated_at = now()
          WHERE item_id = ANY($1::uuid[]) AND profile = $5
        `, [[data.sourceId, data.targetId], folderId, data.sourceId, childWidth + 56, profileName])
        await client.query(`
          INSERT INTO item_placements(item_id, workspace_id, container_key, profile, x, y, width, height)
          VALUES ($1, $2, 'root', $3, $4, $5, $6, $7)
        `, [folderId, workspaceId, profileName, target.x, target.y, target.width, target.height])
      }
      return { status: 201, body: await bootstrapResponse(client, { folderId }) }
    })
  }

  match = routeMatch(pathname, /^\/api\/items\/([0-9a-f-]+)\/container$/)
  if (request.method === 'PUT' && match) {
    const body = await readJson(request)
    const data = parse(z.object({
      parentFolderId: uuid.nullable(),
      placements,
      mutationId: z.string().max(200).optional(),
    }), body)
    for (const profileName of Object.keys(CANVASES)) assertPlacementBounds(profileName, data.placements[profileName])
    return mutate(request, response, `item.container:${match[0]}`, data, async (client) => {
      await client.query('SET CONSTRAINTS item_placements_no_overlap DEFERRED')
      const item = await client.query('SELECT * FROM shortcut_items WHERE id = $1 FOR UPDATE', [match[0]])
      if (!item.rowCount) throw new HttpError(404, 'Item not found')
      if (item.rows[0].pin_group_id) throw new HttpError(409, 'Unpin this shortcut before moving it into or out of a folder')
      if (item.rows[0].kind === 'folder' && data.parentFolderId) throw new HttpError(409, 'Folders cannot be nested')
      if (data.parentFolderId) {
        const folder = await client.query(`
          SELECT 1 FROM shortcut_items
          WHERE id = $1 AND workspace_id = $2 AND kind = 'folder' AND parent_folder_id IS NULL
        `, [data.parentFolderId, item.rows[0].workspace_id])
        if (!folder.rowCount) throw new HttpError(404, 'Destination folder not found')
      }
      const containerKey = data.parentFolderId || 'root'
      await client.query(`
        UPDATE shortcut_items SET parent_folder_id = $2, version = version + 1, updated_at = now()
        WHERE id = $1
      `, [match[0], data.parentFolderId])
      for (const profileName of Object.keys(CANVASES)) {
        const value = data.placements[profileName]
        await client.query(`
          UPDATE item_placements SET container_key = $3, x = $4, y = $5,
            width = $6, height = $7, version = version + 1, updated_at = now()
          WHERE item_id = $1 AND profile = $2
        `, [match[0], profileName, containerKey, value.x, value.y, value.width, value.height])
      }
      return bootstrapResponse(client)
    })
  }

  if (request.method === 'GET' && pathname === '/api/search') {
    const query = url.searchParams.get('q')?.trim()
    if (!query) throw new HttpError(400, 'Search query is required')
    const endpoint = new URL('/search', process.env.SEARXNG_URL || 'http://127.0.0.1:8181')
    endpoint.searchParams.set('q', query)
    endpoint.searchParams.set('format', 'json')
    try {
      const upstream = await fetch(endpoint, {
        signal: AbortSignal.timeout(8000),
        headers: {
          'user-agent': 'VStart2/0.1 inline search',
          'x-forwarded-for': '127.0.0.1',
          'x-real-ip': '127.0.0.1',
        },
      })
      if (!upstream.ok) throw new Error(`SearXNG returned ${upstream.status}`)
      const payload = await upstream.json()
      const results = (payload.results || []).slice(0, 18).map((item) => ({
        title: item.title,
        url: item.url,
        content: item.content || '',
        engine: item.engine || item.engines?.[0] || '',
      }))
      const failedEngines = (payload.unresponsive_engines || []).map((value) => String(value?.[0] || '')).filter(Boolean)
      if (!results.length && failedEngines.length) {
        return sendJson(response, 503, {
          error: 'Inline search providers did not respond',
          details: `SearXNG providers unavailable: ${failedEngines.join(', ')}`,
        })
      }
      return sendJson(response, 200, { query, results })
    } catch (error) {
      return sendJson(response, 503, { error: 'Inline search is temporarily unavailable', details: error.message })
    }
  }

  if (request.method === 'GET' && pathname === '/api/suggestions') {
    const query = url.searchParams.get('q')?.trim()
    if (!query) return sendJson(response, 200, { suggestions: [] })
    try {
      const endpoint = new URL('https://duckduckgo.com/ac/')
      endpoint.searchParams.set('q', query)
      endpoint.searchParams.set('type', 'list')
      const upstream = await fetch(endpoint, {
        signal: AbortSignal.timeout(3500),
        headers: { 'user-agent': 'VStart2/0.1 suggestions' },
      })
      if (!upstream.ok) throw new Error(`Suggestion provider returned ${upstream.status}`)
      const payload = await upstream.json()
      const values = Array.isArray(payload?.[1]) ? payload[1] : (Array.isArray(payload) ? payload : [])
      const suggestions = values.map((value) => String(value?.phrase || value || '').trim()).filter(Boolean).slice(0, 7)
      return sendJson(response, 200, { suggestions })
    } catch {
      return sendJson(response, 200, { suggestions: [] })
    }
  }

  throw new HttpError(404, 'Route not found')
}

async function start() {
  await migrate()
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => handleError(response, error))
  })
  server.listen(PORT, '0.0.0.0', () => console.log(`[api] listening on ${PORT}`))

  const shutdown = async () => {
    server.close()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

start().catch((error) => {
  console.error('[api] failed to start', error)
  process.exit(1)
})
