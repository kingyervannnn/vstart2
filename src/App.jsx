import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { RotateCcw, Settings } from 'lucide-react'
import { api } from './lib/api.js'
import { getSharedAgentBridgeClient } from './lib/agentBridge.js'
import { mailBridge } from './lib/mailBridge.js'
import { CANVASES, collides, findOpenPlacement, projectPlacement } from './lib/canvas.js'
import { useCompactMode } from './lib/useCompactMode.js'
import { buildViewSearch, parseViewSearch, resolveInlinePresentation, toggledServiceView } from './lib/viewRoute.js'
import { backgroundRotationCandidates, backgroundRotationInterval, nextBackgroundId } from './lib/backgroundRotation.js'
import { backgroundImageLayers, preloadBackgroundAsset, preloadBootstrapBackground, startupBackgroundUrl } from './lib/backgroundStartup.js'
import { backgroundZoomScale } from './lib/backgroundZoom.js'
import { headerScrollDuration } from './lib/headerScroll.js'
import { extractAdaptiveGlowColor, normalizeHexColor } from './lib/glowColor.js'
import { DialCanvas } from './components/DialCanvas.jsx'
import { FolderPopover } from './components/FolderPopover.jsx'
import { InlineResults } from './components/InlineResults.jsx'
import { ScrollingHeader } from './components/ScrollingHeader.jsx'
import { SearchDock } from './components/SearchDock.jsx'
import { ServiceRailView } from './components/ServiceRailView.jsx'
import { SettingsPanel } from './components/SettingsPanel.jsx'
import { ShortcutDialog } from './components/ShortcutDialog.jsx'
import { WidgetRail } from './components/WidgetRail.jsx'
import { AppContextMenu } from './components/AppContextMenu.jsx'
import { AgentMode } from './components/AgentMode.jsx'
import { WorkspaceContextMenu } from './components/WorkspaceContextMenu.jsx'
import { WorkspaceDialog } from './components/WorkspaceDialog.jsx'
import { ConfirmDialog } from './components/ConfirmDialog.jsx'

const LOADING_SHELL_DELAY_MS = 350
const BACKGROUND_FADE_MS = 900
const BACKGROUND_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_BACKGROUND_BYTES = 300 * 1024 * 1024

function backgroundMimeType(file) {
  if (BACKGROUND_MIME_TYPES.has(file.type)) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[extension] || ''
}

function LoadingShell({ error, onRetry }) {
  return (
    <main className="loading-shell">
      <div className="loading-mark">V2</div>
      <h1>{error ? 'Database unavailable' : 'Loading V Start 2'}</h1>
      <p>{error || 'Loading canonical state from PostgreSQL…'}</p>
      {error && <button type="button" onClick={onRetry}><RotateCcw size={17} /> Retry</button>}
    </main>
  )
}

export function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const compact = useCompactMode()
  const profile = compact ? 'compact' : 'wide'
  const [bootstrap, setBootstrap] = useState(null)
  const bootstrapRef = useRef(null)
  const [loadError, setLoadError] = useState('')
  const [showLoadingShell, setShowLoadingShell] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [workspaceMenu, setWorkspaceMenu] = useState(null)
  const [workspaceDialog, setWorkspaceDialog] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const [folderId, setFolderId] = useState(null)
  const [folderAnchor, setFolderAnchor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [savingCount, setSavingCount] = useState(0)
  const [toast, setToast] = useState(null)
  const [headerDirection, setHeaderDirection] = useState('left')
  const [inlineResults, setInlineResults] = useState(null)
  const [agentUi, setAgentUi] = useState({ running: false, ready: false, state: 'idle' })
  const [agentDraft, setAgentDraft] = useState(null)
  const [shortcutFilter, setShortcutFilter] = useState(null)
  const [shortcutSpotlightId, setShortcutSpotlightId] = useState('')
  const [adaptiveGlow, setAdaptiveGlow] = useState({ backgroundId: null, color: '' })
  const [backgroundLayers, setBackgroundLayers] = useState({ currentId: undefined, previousId: undefined })
  const activeRef = useRef(null)
  const displayedBackgroundRef = useRef(undefined)
  const backgroundFadeTimerRef = useRef(null)
  const agentRef = useRef(null)
  const shortcutSpotlightTimerRef = useRef(null)
  const settingsQueueRef = useRef(Promise.resolve())
  const wheelRef = useRef({ total: 0, cooldown: false, timer: null })

  const applyBootstrap = useCallback((next) => {
    bootstrapRef.current = next
    setBootstrap(next)
  }, [])

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const next = await api.bootstrap()
      await preloadBootstrapBackground(next, window.location.pathname)
      applyBootstrap(next)
    } catch (error) {
      setLoadError(error.message)
    }
  }, [applyBootstrap])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (bootstrap || loadError) return undefined
    const timer = window.setTimeout(() => setShowLoadingShell(true), LOADING_SHELL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [bootstrap, loadError])
  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => () => window.clearTimeout(shortcutSpotlightTimerRef.current), [])
  useEffect(() => { if (!folderId) setFolderAnchor(null) }, [folderId])

  const routedView = useMemo(() => parseViewSearch(location.search), [location.search])

  useEffect(() => {
    let live = true
    if (routedView.type === 'service') {
      setInlineResults(null)
      setEditMode(false)
      return () => { live = false }
    }
    if (routedView.type === 'search' || routedView.type === 'frame') {
      const initialFrame = routedView.type === 'frame' ? routedView.result : null
      setInlineResults({ query: routedView.query, category: routedView.category, results: [], loading: Boolean(routedView.query), error: '', initialFrame, initialFullScreen: routedView.fullScreen })
      if (routedView.query) {
        void api.search(routedView.query, routedView.category).then((result) => {
          if (live) setInlineResults((current) => current ? { ...current, results: result.results, loading: false, error: '' } : current)
        }).catch((error) => {
          if (live) setInlineResults((current) => current ? { ...current, results: [], loading: false, error: error.message } : current)
        })
      }
      return () => { live = false }
    }
    setInlineResults(null)
    return () => { live = false }
  }, [routedView])

  const workspaces = useMemo(() => bootstrap?.workspaces || [], [bootstrap?.workspaces])
  const workspaceRoute = location.pathname.match(/^\/w\/([^/]+)(?:\/agent(?:\/([^/]+))?)?$/)
  const slug = decodeURIComponent(workspaceRoute?.[1] || '')
  const routedWorkspace = workspaces.find((workspace) => workspace.slug === slug) || null
  const lastWorkspaceId = bootstrap?.state?.last_active_workspace_id?.value
  const fallbackWorkspace = workspaces.find((workspace) => workspace.id === lastWorkspaceId) || workspaces[0] || null
  const activeWorkspace = routedWorkspace || fallbackWorkspace
  const agentMode = Boolean(routedWorkspace && location.pathname.includes('/agent'))
  const agentTarget = agentMode ? decodeURIComponent(workspaceRoute?.[2] || 'new') : 'new'
  const settings = bootstrap?.settings?.document || {}
  const appReady = Boolean(bootstrap)
  const backgroundId = settings.backgrounds?.workspaceSpecific && activeWorkspace?.backgroundAssetId
    ? activeWorkspace.backgroundAssetId
    : settings.backgrounds?.globalAssetId
  const effectiveAccent = activeWorkspace?.accentColor && settings.workspaces?.individualTypography
    ? activeWorkspace.accentColor
    : settings.appearance?.accentColor || '#8ba6ff'
  const glowSettings = settings.appearance?.glow || {}
  const workspaceGlowColor = glowSettings.workspaceSpecific
    ? glowSettings.workspaceColors?.[activeWorkspace?.id]
    : null
  const manualGlowColor = normalizeHexColor(workspaceGlowColor || glowSettings.color || effectiveAccent, effectiveAccent)
  const adaptiveGlowColor = glowSettings.adaptToBackground && adaptiveGlow.backgroundId === backgroundId
    ? adaptiveGlow.color
    : ''
  const workspaceMailAccount = settings.mail?.workspaceAccounts?.[activeWorkspace?.id]
    || settings.mail?.defaultAccount
    || 'all'
  const routedInline = resolveInlinePresentation(routedView, inlineResults)
  const viewVeil = routedInline && !routedView.fullScreen ? 'inline' : routedView.type === 'service' ? 'service' : agentMode ? 'agent' : ''

  useEffect(() => {
    const nextId = backgroundId || null
    if (displayedBackgroundRef.current === nextId) return undefined
    let live = true
    const commit = () => {
      if (!live) return
      const previousId = displayedBackgroundRef.current
      displayedBackgroundRef.current = nextId
      window.clearTimeout(backgroundFadeTimerRef.current)
      setBackgroundLayers({ currentId: nextId, previousId })
      if (previousId !== undefined) {
        backgroundFadeTimerRef.current = window.setTimeout(() => {
          setBackgroundLayers((current) => current.currentId === nextId ? { ...current, previousId: undefined } : current)
        }, BACKGROUND_FADE_MS + 80)
      }
    }
    if (displayedBackgroundRef.current === undefined || !nextId) commit()
    else void preloadBackgroundAsset(nextId).then(commit)
    return () => { live = false }
  }, [backgroundId])

  useEffect(() => () => window.clearTimeout(backgroundFadeTimerRef.current), [])

  useEffect(() => {
    if (!glowSettings.adaptToBackground || !backgroundId) return undefined
    let live = true
    const asset = bootstrap?.backgroundAssets?.find((candidate) => candidate.id === backgroundId)
    const urls = [
      `/api/assets/${backgroundId}/preview`,
      asset?.byteLength <= 12 * 1024 * 1024 ? `/api/assets/${backgroundId}` : null,
    ]
    void extractAdaptiveGlowColor(urls, manualGlowColor).then((color) => {
      if (live) setAdaptiveGlow({ backgroundId, color })
    })
    return () => { live = false }
  }, [backgroundId, bootstrap?.backgroundAssets, glowSettings.adaptToBackground, manualGlowColor])

  useEffect(() => {
    if (!appReady || agentMode || settings.agent?.enabled === false) return undefined
    let active = true
    const client = getSharedAgentBridgeClient({ baseUrl: settings.agent?.bridgeUrl })
    const warm = (force = false) => {
      if (!active) return
      void client.prewarm({ createSession: true, force }).catch(() => {})
    }
    warm()
    const timer = window.setInterval(() => warm(true), 4 * 60 * 1_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [agentMode, appReady, settings.agent?.bridgeUrl, settings.agent?.enabled])

  useEffect(() => {
    let live = true
    const warmMail = async ({ forceInbox = false } = {}) => {
      const snapshot = await mailBridge.preload({ force: forceInbox })
      if (!live) return
      const unavailableAccounts = new Set(snapshot.unavailableAccounts || [])
      await Promise.all((snapshot.accounts || []).filter((account) => !unavailableAccounts.has(account.alias)).map((account) => mailBridge.contacts({ account: account.alias, max: 80 }).catch(() => null)))
    }
    void warmMail().catch(() => {})
    const refreshSeconds = Number(settings.mail?.refreshSeconds ?? 60)
    if (refreshSeconds <= 0) return () => { live = false }
    const timer = window.setInterval(() => {
      void warmMail({ forceInbox: true }).catch(() => {})
    }, Math.max(30, refreshSeconds) * 1000)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [settings.mail?.refreshSeconds])

  useEffect(() => {
    if (!bootstrap || !workspaces.length) return
    if (routedWorkspace) return
    navigate({ pathname: `/w/${fallbackWorkspace.slug}`, search: location.search }, { replace: true })
  }, [bootstrap, fallbackWorkspace, location.search, navigate, routedWorkspace, workspaces.length])

  useEffect(() => {
    if (!activeWorkspace || activeRef.current === activeWorkspace.id) return
    if (activeRef.current) setHeaderDirection((value) => value === 'left' ? 'right' : 'left')
    activeRef.current = activeWorkspace.id
    api.setActiveWorkspace(activeWorkspace.id).catch(() => {})
  }, [activeWorkspace])

  const selectWorkspace = useCallback((workspace) => {
    if (workspace) navigate({ pathname: agentMode ? `/w/${workspace.slug}/agent/new` : `/w/${workspace.slug}`, search: agentMode ? '' : location.search })
  }, [agentMode, location.search, navigate])

  const openShortcutFromSearch = useCallback((item) => {
    if (!item?.url) return
    window.open(item.url, settings.general?.openLinksInNewTab === false ? '_self' : '_blank')
  }, [settings.general?.openLinksInNewTab])

  const locateShortcutFromSearch = useCallback((item) => {
    const workspace = workspaces.find((candidate) => candidate.id === item?.workspaceId)
    if (!workspace || !item) return
    setInlineResults(null)
    setFolderAnchor(null)
    setFolderId(item.parentFolderId || null)
    setShortcutFilter(null)
    setShortcutSpotlightId(item.id)
    window.clearTimeout(shortcutSpotlightTimerRef.current)
    shortcutSpotlightTimerRef.current = window.setTimeout(() => setShortcutSpotlightId(''), 2600)
    navigate(`/w/${workspace.slug}`)
  }, [navigate, workspaces])

  const cycleWorkspace = useCallback((delta) => {
    if (!activeWorkspace || workspaces.length < 2) return
    const index = workspaces.findIndex((workspace) => workspace.id === activeWorkspace.id)
    selectWorkspace(workspaces[(index + delta + workspaces.length) % workspaces.length])
  }, [activeWorkspace, selectWorkspace, workspaces])

  const onDialWheel = (event) => {
    if (agentMode || routedView.type !== 'dial' || folderId || settingsOpen) return
    const wheel = wheelRef.current
    if (wheel.cooldown) return
    wheel.total += Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    clearTimeout(wheel.timer)
    const resistance = Math.max(0, Math.min(100, Number(settings.speedDial?.wheelResistance) || 0))
    wheel.timer = setTimeout(() => { wheel.total = 0 }, 80 + resistance * 0.6)
    if (Math.abs(wheel.total) < 10 + resistance * 0.55) return
    wheel.cooldown = true
    cycleWorkspace(wheel.total > 0 ? 1 : -1)
    wheel.total = 0
    setTimeout(() => { wheel.cooldown = false }, 100 + resistance * 1.5)
  }

  const patchSettings = useCallback((patch) => {
    setSavingCount((value) => value + 1)
    settingsQueueRef.current = settingsQueueRef.current.then(async () => {
      const current = bootstrapRef.current
      const result = await api.patchSettings(current.settings.version, patch)
      applyBootstrap(result.bootstrap)
    }).catch((error) => {
      setToast({ type: 'error', message: error.message })
      return load()
    }).finally(() => setSavingCount((value) => Math.max(0, value - 1)))
    return settingsQueueRef.current
  }, [applyBootstrap, load])

  const rotateBackground = useCallback(async () => {
    const current = bootstrapRef.current
    const currentSettings = current?.settings?.document || {}
    const workspace = current?.workspaces?.find((item) => item.id === activeWorkspace?.id)
    if (!workspace) return { rotated: false, count: 0 }
    const candidates = backgroundRotationCandidates({
      settings: currentSettings,
      assets: current.backgroundAssets || [],
      collections: current.backgroundCollections || [],
      workspaceId: workspace.id,
    })
    const currentId = currentSettings.backgrounds?.workspaceSpecific && workspace.backgroundAssetId
      ? workspace.backgroundAssetId
      : currentSettings.backgrounds?.globalAssetId
    const nextId = nextBackgroundId(candidates, currentId)
    if (!nextId || nextId === currentId) return { rotated: false, count: candidates.length }

    if (currentSettings.backgrounds?.workspaceSpecific) {
      const result = await api.updateWorkspace(workspace.id, { backgroundAssetId: nextId, version: workspace.version })
      applyBootstrap(result.bootstrap)
    } else {
      await patchSettings({ backgrounds: { globalAssetId: nextId } })
    }
    return { rotated: true, count: candidates.length }
  }, [activeWorkspace?.id, applyBootstrap, patchSettings])

  useEffect(() => {
    const rotation = settings.backgrounds?.rotation
    if (!rotation?.enabled) return undefined
    if (rotation.scope === 'workspace' && !settings.backgrounds?.workspaceSpecific) return undefined
    const timer = window.setInterval(() => {
      void rotateBackground().catch((error) => setToast({ type: 'error', message: error.message }))
    }, backgroundRotationInterval(rotation.intervalMinutes) * 60_000)
    return () => window.clearInterval(timer)
  }, [rotateBackground, settings.backgrounds?.rotation, settings.backgrounds?.workspaceSpecific])

  const linkAgentSession = useCallback(async (workspaceId, hermesSessionId, titleOverride = null) => {
    const result = await api.linkAgentSession({ workspaceId, hermesSessionId, titleOverride })
    applyBootstrap(result.bootstrap)
    return result
  }, [applyBootstrap])

  const saveAgentPreferences = useCallback(async (workspaceId, changes) => {
    const current = (bootstrapRef.current?.agentPreferences || []).find((preference) => preference.workspaceId === workspaceId)
    const result = await api.saveAgentPreferences(workspaceId, { ...changes, version: current?.version || 0 })
    applyBootstrap(result.bootstrap)
    return result
  }, [applyBootstrap])

  const activeWorkspaceSlug = activeWorkspace?.slug || ''
  const navigateAgent = useCallback((sessionId, options = {}) => {
    if (!activeWorkspaceSlug) return
    navigate(`/w/${activeWorkspaceSlug}/agent/${encodeURIComponent(sessionId || 'new')}`, options)
  }, [activeWorkspaceSlug, navigate])

  const toggleAgentMode = useCallback(() => {
    if (!activeWorkspace) return
    setInlineResults(null)
    setFolderId(null)
    navigate(agentMode ? `/w/${activeWorkspace.slug}` : `/w/${activeWorkspace.slug}/agent/new`)
  }, [activeWorkspace, agentMode, navigate])

  const navigateView = useCallback((view, options = {}) => {
    navigate({ pathname: location.pathname, search: buildViewSearch(view) }, options)
  }, [location.pathname, navigate])

  const toggleWidgetView = useCallback((kind) => {
    navigateView(toggledServiceView(routedView, kind))
  }, [navigateView, routedView])

  const openTextLinkInline = useCallback(({ url, title }) => {
    navigateView({ type: 'frame', query: '', result: { title: title || new URL(url).hostname, url }, fullScreen: false })
  }, [navigateView])

  const openShortcutInline = useCallback((item) => {
    if (!item?.url) return
    setFolderId(null)
    navigateView({ type: 'frame', query: '', result: { title: item.title, url: item.url }, fullScreen: false })
  }, [navigateView])

  const placementsFor = useCallback((workspaceId, profileName, containerKey = 'root') =>
    (bootstrapRef.current?.placements || []).filter((value) => value.workspaceId === workspaceId && value.profile === profileName && value.containerKey === containerKey), [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const placementsInWorkspace = useCallback((item, workspaceId) => {
    const result = {}
    for (const profileName of Object.keys(CANVASES)) {
      const source = bootstrapRef.current?.placements.find((value) => value.itemId === item.id && value.profile === profileName)
      const occupied = placementsFor(workspaceId, profileName)
      const position = findOpenPlacement(occupied, profileName, source || undefined)
      if (!position) throw new Error(`No free space remains in ${profileName} view for that workspace`)
      result[profileName] = position
    }
    return result
  }, [placementsFor])

  const quickShortcutFromResult = async (link, workspaceId) => {
    const workspace = workspaces.find((value) => value.id === workspaceId)
    if (!workspace) throw new Error('That workspace no longer exists.')
    const url = new URL(link.url).href
    const existing = bootstrapRef.current.items.find((item) => {
      if (item.kind !== 'shortcut' || item.workspaceId !== workspaceId || !item.url) return false
      try { return new URL(item.url).href === url } catch { return item.url === url }
    })
    if (existing) {
      setToast({ type: 'warning', message: `${existing.title} is already in ${workspace.name}.` })
      return { alreadyExists: true, itemId: existing.id }
    }
    const title = String(link.title || new URL(url).hostname).trim().slice(0, 120)
    const resultPlacements = {}
    for (const [profileName, canvas] of Object.entries(CANVASES)) {
      const occupied = placementsFor(workspaceId, profileName)
      const position = findOpenPlacement(occupied, profileName, { x: canvas.width * 0.46, y: canvas.height * 0.34 })
      if (!position) throw new Error(`No free space remains in ${workspace.name}'s ${profileName} view.`)
      resultPlacements[profileName] = position
    }
    setBusy(true)
    try {
      const result = await api.createShortcut({ workspaceId, title, url, placements: resultPlacements })
      applyBootstrap(result.bootstrap)
      setToast({ type: 'success', message: `${title} added to ${workspace.name}.` })
      return { alreadyExists: false, itemId: result.itemId }
    } catch (error) {
      setToast({ type: 'error', message: error.message })
      await load()
      throw error
    } finally {
      setBusy(false)
    }
  }

  const saveDialog = async (values) => {
    if (!activeWorkspace) return
    setBusy(true)
    try {
      if (dialog.item) {
        const item = dialog.item
        const changes = item.kind === 'folder'
          ? { title: values.title, version: item.version }
          : {
              title: values.title,
              url: values.url,
              iconOverrideUrl: values.iconOverrideUrl,
              iconData: values.iconData || undefined,
              iconMimeType: values.iconMimeType || undefined,
              version: item.version,
            }
        const result = await api.updateItem(item.id, changes)
        applyBootstrap(result.bootstrap)
        if (result.iconWarning) setToast({ type: 'warning', message: result.iconWarning })
      } else if (dialog.kind === 'folder') {
        const activeCanvas = CANVASES[profile]
        const activeOccupied = placementsFor(activeWorkspace.id, profile)
        const preferred = values.point ? {
          x: values.point.x - activeCanvas.tileWidth / 2,
          y: values.point.y - activeCanvas.tileHeight / 2,
        } : { x: activeCanvas.width * 0.45, y: activeCanvas.height * 0.38 }
        const activePlacement = findOpenPlacement(activeOccupied, profile, preferred)
        if (!activePlacement) throw new Error(`No free space remains in the ${profile} layout`)
        const otherProfile = profile === 'wide' ? 'compact' : 'wide'
        const projection = projectPlacement(activePlacement, profile, otherProfile)
        const otherOccupied = placementsFor(activeWorkspace.id, otherProfile)
        const otherPlacement = collides(projection, otherOccupied)
          ? findOpenPlacement(otherOccupied, otherProfile, projection)
          : projection
        if (!otherPlacement) throw new Error(`No free space remains in the ${otherProfile} layout`)
        const result = await api.createFolder({
          workspaceId: activeWorkspace.id,
          title: values.title,
          placements: profile === 'wide'
            ? { wide: activePlacement, compact: otherPlacement }
            : { compact: activePlacement, wide: otherPlacement },
        })
        applyBootstrap(result.bootstrap)
      } else {
        const parentFolderId = dialog.parentFolderId || null
        const containerKey = parentFolderId || 'root'
        const activeCanvas = CANVASES[profile]
        const activeOccupied = placementsFor(activeWorkspace.id, profile, containerKey)
        const preferred = values.point ? {
          x: values.point.x - activeCanvas.tileWidth / 2,
          y: values.point.y - activeCanvas.tileHeight / 2,
        } : { x: activeCanvas.width * 0.45, y: activeCanvas.height * 0.38 }
        const activePlacement = findOpenPlacement(activeOccupied, profile, preferred)
        if (!activePlacement) throw new Error(`No free space remains in the ${profile} layout`)
        const otherProfile = profile === 'wide' ? 'compact' : 'wide'
        const projection = projectPlacement(activePlacement, profile, otherProfile)
        const otherOccupied = placementsFor(activeWorkspace.id, otherProfile, containerKey)
        const otherPlacement = collides(projection, otherOccupied)
          ? findOpenPlacement(otherOccupied, otherProfile, projection)
          : projection
        if (!otherPlacement) throw new Error(`No free space remains in the ${otherProfile} layout`)
        const result = await api.createShortcut({
          workspaceId: activeWorkspace.id,
          title: values.title,
          url: values.url,
          iconOverrideUrl: values.iconOverrideUrl,
          iconData: values.iconData || undefined,
          iconMimeType: values.iconMimeType || undefined,
          parentFolderId,
          placements: profile === 'wide'
            ? { wide: activePlacement, compact: otherPlacement }
            : { compact: activePlacement, wide: otherPlacement },
        })
        applyBootstrap(result.bootstrap)
        if (parentFolderId) setFolderId(parentFolderId)
        if (result.iconWarning) setToast({ type: 'warning', message: result.iconWarning })
      }
      setDialog(null)
    } finally {
      setBusy(false)
    }
  }

  const performDeleteItem = async (item, action) => {
    setBusy(true)
    try {
      const result = await api.deleteItem(item.id, action)
      applyBootstrap(result.bootstrap)
      setDialog(null)
      setFolderId(null)
      setToast({ type: 'success', message: `${item.title} deleted.` })
    } catch (error) {
      setToast({ type: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  const deleteItem = (item, action) => {
    if (item.kind !== 'folder') return performDeleteItem(item, action)
    const keepChildren = action === 'returnChildren'
    setConfirmation({
      title: `Delete ${item.title}?`,
      message: keepChildren ? 'The folder will be removed and its shortcuts will return to the speed dial.' : 'The folder and every shortcut inside it will be permanently deleted.',
      confirmLabel: keepChildren ? 'Delete folder' : 'Delete folder and shortcuts',
      action: () => performDeleteItem(item, action),
    })
    return undefined
  }

  const duplicateItem = async (item) => {
    if (item.kind !== 'shortcut' || !activeWorkspace) return
    setBusy(true)
    try {
      const duplicatePlacements = {}
      for (const profileName of Object.keys(CANVASES)) {
        const source = bootstrapRef.current.placements.find((value) => value.itemId === item.id && value.profile === profileName)
        const occupied = placementsFor(activeWorkspace.id, profileName)
        const placement = findOpenPlacement(occupied, profileName, { x: (source?.x || 80) + 48, y: (source?.y || 80) + 48 })
        if (!placement) throw new Error(`No free space remains in the ${profileName} layout`)
        duplicatePlacements[profileName] = placement
      }
      const result = await api.createShortcut({
        workspaceId: activeWorkspace.id,
        title: `${item.title} copy`,
        url: item.url,
        iconOverrideUrl: item.iconOverrideUrl,
        placements: duplicatePlacements,
      })
      applyBootstrap(result.bootstrap)
      setDialog(null)
    } catch (error) {
      setToast({ type: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  const moveItem = async (item, next) => {
    const old = bootstrapRef.current.placements.find((value) => value.itemId === item.id && value.profile === profile)
    if (!old) return
    const optimistic = {
      ...bootstrapRef.current,
      placements: bootstrapRef.current.placements.map((value) => value.itemId === item.id && value.profile === profile ? { ...value, ...next } : value),
    }
    applyBootstrap(optimistic)
    try {
      const result = await api.movePlacement(item.id, { profile, x: next.x, y: next.y, version: old.version })
      applyBootstrap(result.bootstrap)
    } catch (error) {
      await load()
      setToast({ type: 'error', message: error.message })
    }
  }

  const dropOnItem = async (source, target) => {
    setBusy(true)
    try {
      if (target.kind === 'folder') {
        const nextPlacements = {}
        for (const profileName of Object.keys(CANVASES)) {
          const occupied = placementsFor(activeWorkspace.id, profileName, target.id)
          const position = findOpenPlacement(occupied, profileName, { x: 42, y: 42 })
          if (!position) throw new Error(`The ${target.title} folder is full in ${profileName} view`)
          nextPlacements[profileName] = position
        }
        const result = await api.moveContainer(source.id, { parentFolderId: target.id, placements: nextPlacements })
        applyBootstrap(result.bootstrap)
      } else {
        const result = await api.mergeFolder(source.id, target.id)
        applyBootstrap(result.bootstrap)
        setFolderId(result.folderId)
      }
    } catch (error) {
      setToast({ type: 'error', message: error.message })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const moveOutOfFolder = async (item) => {
    if (!activeWorkspace) return
    setBusy(true)
    try {
      const nextPlacements = {}
      for (const profileName of Object.keys(CANVASES)) {
        const occupied = placementsFor(activeWorkspace.id, profileName, 'root')
        const folderPlacement = bootstrapRef.current.placements.find((value) => value.itemId === item.parentFolderId && value.profile === profileName)
        const position = findOpenPlacement(occupied, profileName, {
          x: (folderPlacement?.x || 70) + 48,
          y: (folderPlacement?.y || 70) + 48,
        })
        if (!position) throw new Error(`No free space remains in the ${profileName} layout`)
        nextPlacements[profileName] = position
      }
      const result = await api.moveContainer(item.id, { parentFolderId: null, placements: nextPlacements })
      applyBootstrap(result.bootstrap)
    } catch (error) {
      setToast({ type: 'error', message: error.message })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const moveItemToWorkspace = async (item, workspace) => {
    setBusy(true)
    try {
      const nextPlacements = placementsInWorkspace(item, workspace.id)
      const result = await api.moveItemToWorkspace(item.id, {
        destinationWorkspaceId: workspace.id,
        placements: nextPlacements,
        version: item.version,
      })
      applyBootstrap(result.bootstrap)
      setFolderId(null)
      setToast({ type: 'success', message: `${item.title} moved to ${workspace.name}.` })
    } catch (error) {
      setToast({ type: 'error', message: error.message })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const pinItemAcrossWorkspaces = async (item) => {
    const destinations = workspaces.filter((workspace) => workspace.id !== item.workspaceId)
    if (!destinations.length) {
      setToast({ type: 'warning', message: 'Create another workspace before pinning across workspaces.' })
      return
    }
    setBusy(true)
    try {
      const result = await api.pinItem(item.id, {
        version: item.version,
        destinations: destinations.map((workspace) => ({
          workspaceId: workspace.id,
          placements: placementsInWorkspace(item, workspace.id),
        })),
      })
      applyBootstrap(result.bootstrap)
      setToast({ type: 'success', message: `${item.title} is pinned across all workspaces.` })
    } catch (error) {
      setToast({ type: 'error', message: error.message })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const unpinItemAcrossWorkspaces = async (item) => {
    setBusy(true)
    try {
      const result = await api.unpinItem(item.id, item.version)
      applyBootstrap(result.bootstrap)
      setToast({ type: 'success', message: `${item.title} now belongs only to this workspace.` })
    } catch (error) {
      setToast({ type: 'error', message: error.message })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const runInlineSearch = (query) => navigateView({ type: 'search', query, category: 'general' })
  const runInlineImageSearch = ({ query, visualUrl }) => {
    if (visualUrl) {
      navigateView({
        type: 'frame',
        query,
        category: 'images',
        result: { title: 'Visual search results', url: visualUrl },
        fullScreen: settings.search?.inlineLinkBehavior === 'inline-fullscreen',
      })
      return
    }
    navigateView({ type: 'search', query, category: 'images' })
  }

  const createWorkspace = async (nameOrValues) => {
    const values = typeof nameOrValues === 'string' ? { name: nameOrValues } : nameOrValues
    const result = await api.createWorkspace(values.name, values.slug || undefined, values.icon || undefined)
    applyBootstrap(result.bootstrap)
    const workspace = result.bootstrap.workspaces.find((value) => value.id === result.workspaceId)
    selectWorkspace(workspace)
  }

  const deleteWorkspace = async (id) => {
    const result = await api.deleteWorkspace(id)
    applyBootstrap(result.bootstrap)
  }

  const updateWorkspace = async (workspace, changes) => {
    try {
      const result = await api.updateWorkspace(workspace.id, { ...changes, version: workspace.version })
      applyBootstrap(result.bootstrap)
      return result.bootstrap.workspaces.find((value) => value.id === workspace.id)
    } catch (error) {
      setToast({ type: 'error', message: error.message })
      await load()
      throw error
    }
  }

  const saveWorkspaceDialog = async (values) => {
    setBusy(true)
    try {
      if (workspaceDialog?.workspace) {
        await updateWorkspace(workspaceDialog.workspace, values)
      } else {
        await createWorkspace(values)
      }
      setWorkspaceDialog(null)
      setWorkspaceMenu(null)
    } finally {
      setBusy(false)
    }
  }

  const performDeleteWorkspace = async (workspace) => {
    if (workspaces.length <= 1) return
    setBusy(true)
    try {
      await deleteWorkspace(workspace.id)
      setWorkspaceMenu(null)
      setSettingsOpen(false)
      setToast({ type: 'success', message: `${workspace.name} deleted.` })
    } catch (error) {
      setToast({ type: 'error', message: error.message })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const requestDeleteWorkspace = (workspace) => {
    if (!workspace || workspaces.length <= 1) return
    setConfirmation({
      title: `Delete ${workspace.name}?`,
      message: 'The workspace and all shortcuts that belong to it will be permanently deleted.',
      confirmLabel: 'Delete workspace',
      action: () => performDeleteWorkspace(workspace),
    })
  }

  const runConfirmation = async () => {
    const action = confirmation?.action
    if (!action) return
    setConfirmation(null)
    await action()
  }

  const reorderWorkspace = async (workspaceId, direction) => {
    const index = workspaces.findIndex((workspace) => workspace.id === workspaceId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= workspaces.length) return
    const ids = workspaces.map((workspace) => workspace.id)
    const movedId = ids[index]
    ids[index] = ids[target]
    ids[target] = movedId
    const result = await api.reorderWorkspaces(ids)
    applyBootstrap(result.bootstrap)
  }

  const uploadBackgrounds = async (files, collectionName = null) => {
    const images = Array.from(files || []).filter((file) => backgroundMimeType(file))
    if (!images.length) throw new Error('That selection does not contain a supported image.')
    const oversized = images.find((file) => file.size > MAX_BACKGROUND_BYTES)
    if (oversized) throw new Error(`${oversized.name} is larger than 300 MB. Folder imports have no combined size limit, but individual images must remain below 300 MB.`)
    setSavingCount((value) => value + 1)
    try {
      const assetIds = []
      for (const file of images) {
        const asset = await api.uploadBackground(file, backgroundMimeType(file), collectionName || undefined)
        assetIds.push(asset.assetId)
      }
      const uniqueAssetIds = [...new Set(assetIds)]
      const current = bootstrapRef.current
      const currentSettings = current.settings.document
      const workspace = current.workspaces.find((item) => item.id === activeWorkspace.id)
      if (currentSettings.backgrounds?.workspaceSpecific) {
        const result = await api.updateWorkspace(workspace.id, { backgroundAssetId: uniqueAssetIds[0], version: workspace.version })
        applyBootstrap(result.bootstrap)
        const pools = currentSettings.backgrounds?.rotation?.workspacePools || {}
        const workspacePool = [...new Set([...(pools[workspace.id] || []), ...uniqueAssetIds])]
        await patchSettings({ backgrounds: { rotation: { workspacePools: { ...pools, [workspace.id]: workspacePool } } } })
      } else {
        await patchSettings({ backgrounds: { globalAssetId: uniqueAssetIds[0] } })
      }
      setToast({ type: 'success', message: collectionName ? `${uniqueAssetIds.length} background${uniqueAssetIds.length === 1 ? '' : 's'} imported from ${collectionName}.` : `${images[0].name} uploaded.` })
      return uniqueAssetIds
    } finally {
      setSavingCount((value) => Math.max(0, value - 1))
    }
  }

  const selectBackground = async (assetId) => {
    setSavingCount((value) => value + 1)
    try {
      if (settings.backgrounds?.workspaceSpecific) {
        const result = await api.updateWorkspace(activeWorkspace.id, { backgroundAssetId: assetId, version: activeWorkspace.version })
        applyBootstrap(result.bootstrap)
        if (assetId) {
          const pools = bootstrapRef.current.settings.document.backgrounds?.rotation?.workspacePools || {}
          const workspacePool = pools[activeWorkspace.id] || []
          if (!workspacePool.includes(assetId)) {
            await patchSettings({ backgrounds: { rotation: { workspacePools: { ...pools, [activeWorkspace.id]: [...workspacePool, assetId] } } } })
          }
        }
      } else {
        await patchSettings({ backgrounds: { globalAssetId: assetId } })
      }
    } finally {
      setSavingCount((value) => Math.max(0, value - 1))
    }
  }

  const toggleWorkspaceBackground = async (assetId) => {
    const currentSettings = bootstrapRef.current.settings.document
    const pools = currentSettings.backgrounds?.rotation?.workspacePools || {}
    const currentPool = pools[activeWorkspace.id] || []
    const nextPool = currentPool.includes(assetId)
      ? currentPool.filter((id) => id !== assetId)
      : [...currentPool, assetId]
    await patchSettings({ backgrounds: { rotation: { workspacePools: { ...pools, [activeWorkspace.id]: nextPool } } } })
  }

  const deleteBackground = async (assetId) => {
    setSavingCount((value) => value + 1)
    try {
      const result = await api.deleteBackground(assetId)
      applyBootstrap(result.bootstrap)
      setToast({ type: 'success', message: 'Background deleted.' })
    } finally {
      setSavingCount((value) => Math.max(0, value - 1))
    }
  }

  if (!bootstrap) {
    if (loadError || showLoadingShell) return <LoadingShell error={loadError} onRetry={load} />
    return <main className="startup-shell" style={{ backgroundImage: `url(${startupBackgroundUrl(location.pathname)})` }} aria-label="Starting V Start 2" aria-busy="true" />
  }

  const currentFolder = bootstrap.items.find((item) => item.id === folderId && item.kind === 'folder')
  const folderChildren = currentFolder ? bootstrap.items.filter((item) => item.parentFolderId === currentFolder.id) : []
  const appStyle = {
    '--app-text': activeWorkspace.textColor && settings.workspaces?.individualTypography ? activeWorkspace.textColor : settings.appearance?.textColor || '#f4f6ff',
    '--app-accent': effectiveAccent,
    '--app-glow': adaptiveGlowColor || manualGlowColor,
    '--app-font': activeWorkspace.fontFamily && settings.workspaces?.individualTypography ? activeWorkspace.fontFamily : settings.appearance?.fontFamily || 'Inter, system-ui, sans-serif',
    '--header-scroll-duration': `${headerScrollDuration(settings.appearance?.headerScrollSpeed)}s`,
    '--shortcut-icon-size': `${Math.max(56, Math.min(92, Number(settings.speedDial?.shortcutSize) || 78))}%`,
  }
  const displayedBackgroundId = backgroundLayers.currentId === undefined ? backgroundId || null : backgroundLayers.currentId
  const backgroundBaseStyle = {
    '--app-background-scale': backgroundZoomScale(settings.backgrounds?.zoomPercent),
  }
  const currentBackgroundStyle = {
    ...backgroundBaseStyle,
    ...(displayedBackgroundId ? { '--app-background-image': backgroundImageLayers(displayedBackgroundId) } : {}),
  }
  const previousBackgroundStyle = backgroundLayers.previousId === undefined ? null : {
    ...backgroundBaseStyle,
    ...(backgroundLayers.previousId ? { '--app-background-image': backgroundImageLayers(backgroundLayers.previousId) } : {}),
  }
  const showCompactInnerRing = compact
    && settings.general?.innerOutline
    && !routedInline
    && routedView.type !== 'service'
    && !agentMode

  return (<>
    {previousBackgroundStyle && <div className="app-background-layer background-previous" style={previousBackgroundStyle} aria-hidden="true" />}
    <div key={displayedBackgroundId || 'default'} className={`app-background-layer background-current ${previousBackgroundStyle ? 'background-fading-in' : ''}`} style={currentBackgroundStyle} aria-hidden="true" />
    <main
      className={`vstart-app ${compact ? 'compact-mode' : 'wide-mode'} ${agentMode ? 'agent-active' : ''} ${showCompactInnerRing ? 'compact-ring-active' : ''} ${settings.general?.mirrorLayout ? 'mirrored' : ''} ${settings.general?.innerOutline ? 'inner-outline' : ''} ${settings.appearance?.edgeEffect ? 'edge-effect' : ''} ${settings.appearance?.edgeGlow ? 'edge-glow' : ''} ${settings.appearance?.animatedOverlay ? 'animated-overlay' : ''}`}
      style={appStyle}
    >
      {viewVeil && <div className={`view-veil ${viewVeil}-veil`} aria-hidden="true" />}
      <ScrollingHeader workspace={activeWorkspace} direction={headerDirection} onNext={() => cycleWorkspace(1)} onPrevious={() => cycleWorkspace(-1)} />
      <WidgetRail compact={compact} settings={settings} onPatch={patchSettings} onOpenWidget={toggleWidgetView} />
      <section className="dial-rail" onWheel={onDialWheel}>
        {showCompactInnerRing && <div className="compact-inner-ring" aria-hidden="true" />}
        {routedInline ? (
          <InlineResults
            key={location.search}
            {...routedInline}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspace.id}
            linkBehavior={settings.search?.inlineLinkBehavior || 'inline'}
            onNavigate={navigateView}
            onCreateShortcut={quickShortcutFromResult}
            onClose={() => navigateView({ type: 'dial' })}
          />
        ) : routedView.type === 'service' ? (
          <ServiceRailView
            key={`${routedView.kind}:${activeWorkspace.id}`}
            kind={routedView.kind}
            musicSettings={settings.music}
            onMusicSettingsPatch={(patch) => patchSettings({ music: patch })}
            notesSettings={settings.notes}
            onNotesSettingsPatch={(patch) => patchSettings({ notes: patch })}
            weatherSettings={settings.widgets}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspace.id}
            initialMailAccount={workspaceMailAccount}
            openLinksInNewTab={settings.general?.openLinksInNewTab}
            onOpenInline={openTextLinkInline}
            onClose={() => navigateView({ type: 'dial' })}
          />
        ) : agentMode ? (
          <AgentMode
            ref={agentRef}
            workspace={activeWorkspace}
            settings={settings}
            targetSessionId={agentTarget}
            sessionLinks={(bootstrap.agentSessions || []).filter((session) => session.workspaceId === activeWorkspace.id)}
            preferences={(bootstrap.agentPreferences || []).find((preference) => preference.workspaceId === activeWorkspace.id)}
            onNavigate={navigateAgent}
            onSessionLinked={linkAgentSession}
            onPreferencesChange={saveAgentPreferences}
            onStateChange={setAgentUi}
            onEditMessage={(text) => setAgentDraft({ id: crypto.randomUUID(), text })}
            onOpenInline={openTextLinkInline}
            onOpenSettings={() => setSettingsOpen(true)}
            onClose={toggleAgentMode}
          />
        ) : (
          <DialCanvas
            workspace={activeWorkspace}
            items={bootstrap.items}
            placements={bootstrap.placements}
            profile={profile}
            editMode={editMode}
            alwaysShowNames={settings.speedDial?.alwaysShowNames !== false}
            showFolderLabels={settings.speedDial?.showFolderLabels !== false}
            labelOpensInline={settings.speedDial?.labelOpensInline === true}
            openInNewTab={settings.general?.openLinksInNewTab !== false}
            shortcutFilter={shortcutFilter}
            spotlightItemId={shortcutSpotlightId}
            onCreateAt={(point) => setDialog({ item: null, point })}
            onMove={moveItem}
            onDropOnItem={dropOnItem}
            onOpenFolder={(item, element) => {
              const rect = element?.getBoundingClientRect()
              setFolderAnchor(rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null)
              setFolderId(item.id)
            }}
            onOpenInline={openShortcutInline}
            onEdit={(item) => setDialog({ item, point: null })}
            onBlankContextMenu={({ x, y, point }) => { setWorkspaceMenu(null); setContextMenu({ x, y, point, item: null }) }}
            onItemContextMenu={({ x, y, item }) => { setWorkspaceMenu(null); setContextMenu({ x, y, point: null, item }) }}
          />
        )}
        {!(routedView.type === 'service' && ['mail', 'music', 'notes', 'environment'].includes(routedView.kind)) && <SearchDock
          settings={settings}
          profile={profile}
          compact={compact}
          editMode={editMode}
          workspaces={workspaces}
          items={bootstrap.items}
          activeWorkspaceId={activeWorkspace.id}
          onWorkspaceSelect={selectWorkspace}
          onWorkspaceContextMenu={(payload) => { setContextMenu(null); setWorkspaceMenu(payload) }}
          onWorkspaceLayoutCommit={(profileName, layout) => patchSettings({ search: { workspaceOffset: { [profileName]: layout.offset }, workspaceSide: { [profileName]: layout.side } } })}
          onGeometryCommit={(profileName, geometry) => patchSettings({ search: { dock: { [profileName]: geometry } } })}
          onInlineResults={runInlineSearch}
          onInlineImageSearch={runInlineImageSearch}
          onOpenShortcut={openShortcutFromSearch}
          onLocateShortcut={locateShortcutFromSearch}
          onShortcutFilterChange={setShortcutFilter}
          restoredQuery={routedInline?.query || ''}
          draftRequest={agentDraft}
          onDraftConsumed={() => setAgentDraft(null)}
          agentMode={agentMode}
          agentReady={agentUi.ready}
          agentRunning={agentUi.running}
          onAgentToggle={toggleAgentMode}
          onAgentSubmit={(value, attachment) => agentRef.current?.submit(value, attachment)}
          onAgentStop={() => agentRef.current?.stop()}
        />}
        {!agentMode && <div className="page-controls">
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><Settings /></button>
        </div>}
      </section>

      {dialog && <ShortcutDialog item={dialog.item} kind={dialog.kind} point={dialog.point} onClose={() => setDialog(null)} onSubmit={saveDialog} onDelete={deleteItem} onDuplicate={duplicateItem} busy={busy} />}
      {contextMenu && <AppContextMenu
        menu={contextMenu}
        workspaces={workspaces}
        editMode={editMode}
        onClose={closeContextMenu}
        onCreate={(point, parentFolderId = null) => { if (parentFolderId) setFolderId(null); setDialog({ item: null, point, parentFolderId }) }}
        onCreateFolder={(point) => setDialog({ item: null, kind: 'folder', point })}
        onToggleEdit={() => setEditMode((value) => !value)}
        onEditItem={(item) => { setFolderId(null); setDialog({ item, point: null }) }}
        onMoveItem={moveItemToWorkspace}
        onPinItem={pinItemAcrossWorkspaces}
        onUnpinItem={unpinItemAcrossWorkspaces}
        onMoveOut={moveOutOfFolder}
        onDeleteItem={(item) => deleteItem(item, 'deleteChildren')}
      />}
      <FolderPopover
        folder={currentFolder}
        children={folderChildren}
        placements={bootstrap.placements}
        profile={profile}
        anchorRect={folderAnchor}
        editMode={editMode}
        openInNewTab={settings.general?.openLinksInNewTab !== false}
        labelOpensInline={settings.speedDial?.labelOpensInline === true}
        spotlightItemId={shortcutSpotlightId}
        onClose={() => setFolderId(null)}
        onCreate={(point) => { setFolderId(null); setDialog({ item: null, point, parentFolderId: currentFolder.id }) }}
        onBlankContextMenu={({ x, y, point, folder }) => { setWorkspaceMenu(null); setContextMenu({ x, y, point, item: null, folder }) }}
        onItemContextMenu={({ x, y, item, folder }) => { setWorkspaceMenu(null); setContextMenu({ x, y, point: null, item, folder }) }}
        onEdit={(item) => { setFolderId(null); setDialog({ item, point: null }) }}
        onMove={moveItem}
        onMoveOut={moveOutOfFolder}
        onOpenInline={openShortcutInline}
      />
      {workspaceMenu && <WorkspaceContextMenu
        menu={workspaceMenu}
        workspaceCount={workspaces.length}
        onClose={() => setWorkspaceMenu(null)}
        onCreate={() => { setWorkspaceMenu(null); setWorkspaceDialog({ workspace: null }) }}
        onRename={(workspace) => { setWorkspaceMenu(null); setWorkspaceDialog({ workspace }) }}
        onChangeIcon={(workspace, icon) => updateWorkspace(workspace, { icon })}
        onDelete={requestDeleteWorkspace}
      />}
      {workspaceDialog && <WorkspaceDialog workspace={workspaceDialog.workspace} busy={busy} onClose={() => setWorkspaceDialog(null)} onSubmit={saveWorkspaceDialog} />}
      {settingsOpen && <SettingsPanel settings={settings} workspaces={workspaces} backgroundAssets={bootstrap.backgroundAssets || []} backgroundCollections={bootstrap.backgroundCollections || []} activeBackgroundId={backgroundId || null} activeWorkspaceId={activeWorkspace.id} saving={savingCount > 0} onClose={() => setSettingsOpen(false)} onPatch={patchSettings} onCreateWorkspace={createWorkspace} onDeleteWorkspace={(id) => requestDeleteWorkspace(workspaces.find((workspace) => workspace.id === id))} onUpdateWorkspace={updateWorkspace} onReorderWorkspace={reorderWorkspace} onUploadBackgrounds={uploadBackgrounds} onSelectBackground={selectBackground} onDeleteBackground={deleteBackground} onToggleWorkspaceBackground={toggleWorkspaceBackground} onRotateBackground={rotateBackground} />}
      {confirmation && <ConfirmDialog {...confirmation} busy={busy} onCancel={() => setConfirmation(null)} onConfirm={() => void runConfirmation()} />}
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
      {busy && <div className="busy-indicator" aria-live="polite">Saving…</div>}
    </main>
  </>)
}
