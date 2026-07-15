import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, Pencil, RotateCcw, Settings } from 'lucide-react'
import { api } from './lib/api.js'
import { CANVASES, collides, findOpenPlacement, projectPlacement } from './lib/canvas.js'
import { useCompactMode } from './lib/useCompactMode.js'
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

const LOADING_SHELL_DELAY_MS = 350

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
  const [folderId, setFolderId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [savingCount, setSavingCount] = useState(0)
  const [toast, setToast] = useState(null)
  const [headerDirection, setHeaderDirection] = useState('left')
  const [inlineResults, setInlineResults] = useState(null)
  const [widgetView, setWidgetView] = useState(null)
  const [agentUi, setAgentUi] = useState({ running: false, ready: false, state: 'idle' })
  const activeRef = useRef(null)
  const agentRef = useRef(null)
  const settingsQueueRef = useRef(Promise.resolve())
  const wheelRef = useRef({ total: 0, cooldown: false, timer: null })

  const applyBootstrap = useCallback((next) => {
    bootstrapRef.current = next
    setBootstrap(next)
  }, [])

  const load = useCallback(async () => {
    setLoadError('')
    try {
      applyBootstrap(await api.bootstrap())
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

  useEffect(() => {
    if (!bootstrap || !workspaces.length) return
    if (routedWorkspace) return
    navigate(`/w/${fallbackWorkspace.slug}`, { replace: true })
  }, [bootstrap, fallbackWorkspace, navigate, routedWorkspace, workspaces.length])

  useEffect(() => {
    if (!activeWorkspace || activeRef.current === activeWorkspace.id) return
    if (activeRef.current) setHeaderDirection((value) => value === 'left' ? 'right' : 'left')
    activeRef.current = activeWorkspace.id
    api.setActiveWorkspace(activeWorkspace.id).catch(() => {})
  }, [activeWorkspace])

  const selectWorkspace = useCallback((workspace) => {
    if (workspace) navigate(agentMode ? `/w/${workspace.slug}/agent/new` : `/w/${workspace.slug}`)
  }, [agentMode, navigate])

  const cycleWorkspace = useCallback((delta) => {
    if (!activeWorkspace || workspaces.length < 2) return
    const index = workspaces.findIndex((workspace) => workspace.id === activeWorkspace.id)
    selectWorkspace(workspaces[(index + delta + workspaces.length) % workspaces.length])
  }, [activeWorkspace, selectWorkspace, workspaces])

  const onDialWheel = (event) => {
    if (inlineResults || widgetView || folderId || settingsOpen) return
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
    setWidgetView(null)
    setFolderId(null)
    navigate(agentMode ? `/w/${activeWorkspace.slug}` : `/w/${activeWorkspace.slug}/agent/new`)
  }, [activeWorkspace, agentMode, navigate])

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

  const deleteItem = async (item, action) => {
    const message = item.kind === 'folder'
      ? action === 'returnChildren'
        ? `Delete ${item.title} and return its shortcuts to the speed dial?`
        : `Delete ${item.title} and every shortcut inside it?`
      : `Delete ${item.title}?`
    if (!window.confirm(message)) return
    setBusy(true)
    try {
      const result = await api.deleteItem(item.id, action)
      applyBootstrap(result.bootstrap)
      setDialog(null)
      setFolderId(null)
    } catch (error) {
      setToast({ type: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
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

  const runInlineSearch = async (query) => {
    setWidgetView(null)
    setInlineResults({ query, results: [], loading: true, error: '' })
    try {
      const result = await api.search(query)
      setInlineResults({ query, results: result.results, loading: false, error: '' })
    } catch (error) {
      setInlineResults({ query, results: [], loading: false, error: error.message })
    }
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

  const deleteWorkspaceFromMenu = async (workspace) => {
    if (workspaces.length <= 1) return
    if (!window.confirm(`Delete ${workspace.name}? Its shortcuts will also be removed.`)) return
    setBusy(true)
    try {
      await deleteWorkspace(workspace.id)
      setWorkspaceMenu(null)
    } catch (error) {
      setToast({ type: 'error', message: error.message })
      await load()
    } finally {
      setBusy(false)
    }
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

  const uploadBackground = async (file) => {
    if (!file) return
    if (file.size > 20 * 1024 * 1024) throw new Error('Backgrounds must be smaller than 20 MB.')
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const value = String(reader.result || '')
        resolve(value.slice(value.indexOf(',') + 1))
      }
      reader.onerror = () => reject(new Error('The background could not be read.'))
      reader.readAsDataURL(file)
    })
    setSavingCount((value) => value + 1)
    try {
      const asset = await api.uploadAsset('background', file.type, data, file.name)
      if (settings.backgrounds?.workspaceSpecific) {
        const result = await api.updateWorkspace(activeWorkspace.id, { backgroundAssetId: asset.assetId, version: activeWorkspace.version })
        applyBootstrap(result.bootstrap)
      } else {
        await patchSettings({ backgrounds: { globalAssetId: asset.assetId } })
      }
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
      } else {
        await patchSettings({ backgrounds: { globalAssetId: assetId } })
      }
    } finally {
      setSavingCount((value) => Math.max(0, value - 1))
    }
  }

  if (!bootstrap) {
    if (loadError || showLoadingShell) return <LoadingShell error={loadError} onRetry={load} />
    return <main className="startup-shell" aria-label="Starting V Start 2" aria-busy="true" />
  }

  const currentFolder = bootstrap.items.find((item) => item.id === folderId && item.kind === 'folder')
  const folderChildren = currentFolder ? bootstrap.items.filter((item) => item.parentFolderId === currentFolder.id) : []
  const backgroundId = settings.backgrounds?.workspaceSpecific && activeWorkspace.backgroundAssetId
    ? activeWorkspace.backgroundAssetId
    : settings.backgrounds?.globalAssetId
  const appStyle = {
    '--app-text': activeWorkspace.textColor && settings.workspaces?.individualTypography ? activeWorkspace.textColor : settings.appearance?.textColor || '#f4f6ff',
    '--app-accent': activeWorkspace.accentColor && settings.workspaces?.individualTypography ? activeWorkspace.accentColor : settings.appearance?.accentColor || '#8ba6ff',
    '--app-font': activeWorkspace.fontFamily && settings.workspaces?.individualTypography ? activeWorkspace.fontFamily : settings.appearance?.fontFamily || 'Inter, system-ui, sans-serif',
    '--shortcut-icon-size': `${Math.max(56, Math.min(92, Number(settings.speedDial?.shortcutSize) || 78))}%`,
    ...(backgroundId ? { '--app-background-image': `url(/api/assets/${backgroundId})` } : {}),
  }

  return (
    <main
      className={`vstart-app ${compact ? 'compact-mode' : 'wide-mode'} ${settings.general?.mirrorLayout ? 'mirrored' : ''} ${settings.general?.innerOutline ? 'inner-outline' : ''} ${settings.appearance?.edgeEffect ? 'edge-effect' : ''} ${settings.appearance?.edgeGlow ? 'edge-glow' : ''} ${settings.appearance?.animatedOverlay ? 'animated-overlay' : ''}`}
      style={appStyle}
    >
      <ScrollingHeader workspace={activeWorkspace} direction={headerDirection} onNext={() => cycleWorkspace(1)} onPrevious={() => cycleWorkspace(-1)} />
      <WidgetRail compact={compact} settings={settings} onOpenWidget={(kind) => { setInlineResults(null); setWidgetView(kind) }} />
      <section className="dial-rail" onWheel={onDialWheel}>
        {inlineResults ? (
          <InlineResults {...inlineResults} onClose={() => setInlineResults(null)} />
        ) : widgetView ? (
          <ServiceRailView kind={widgetView} onClose={() => setWidgetView(null)} />
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
            openInNewTab={settings.general?.openLinksInNewTab !== false}
            onCreateAt={(point) => setDialog({ item: null, point })}
            onMove={moveItem}
            onDropOnItem={dropOnItem}
            onOpenFolder={(item) => setFolderId(item.id)}
            onEdit={(item) => setDialog({ item, point: null })}
            onBlankContextMenu={({ x, y, point }) => { setWorkspaceMenu(null); setContextMenu({ x, y, point, item: null }) }}
            onItemContextMenu={({ x, y, item }) => { setWorkspaceMenu(null); setContextMenu({ x, y, point: null, item }) }}
          />
        )}
        <SearchDock
          settings={settings}
          profile={profile}
          compact={compact}
          editMode={editMode}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspace.id}
          onWorkspaceSelect={selectWorkspace}
          onWorkspaceContextMenu={(payload) => { setContextMenu(null); setWorkspaceMenu(payload) }}
          onWorkspaceOffsetCommit={(profileName, offset) => patchSettings({ search: { workspaceOffset: { [profileName]: offset } } })}
          onGeometryCommit={(profileName, geometry) => patchSettings({ search: { dock: { [profileName]: geometry } } })}
          onInlineResults={runInlineSearch}
          agentMode={agentMode}
          agentReady={agentUi.ready}
          agentRunning={agentUi.running}
          onAgentToggle={toggleAgentMode}
          onAgentSubmit={(value) => agentRef.current?.submit(value)}
          onAgentStop={() => agentRef.current?.stop()}
        />
        <div className="page-controls">
          {!agentMode && <button type="button" className={editMode ? 'active' : ''} onClick={() => setEditMode((value) => !value)} aria-label={editMode ? 'Finish editing' : 'Edit page'}>{editMode ? <Check /> : <Pencil />}</button>}
          <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><Settings /></button>
        </div>
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
        editMode={editMode}
        openInNewTab={settings.general?.openLinksInNewTab !== false}
        onClose={() => setFolderId(null)}
        onCreate={(point) => { setFolderId(null); setDialog({ item: null, point, parentFolderId: currentFolder.id }) }}
        onBlankContextMenu={({ x, y, point, folder }) => { setWorkspaceMenu(null); setContextMenu({ x, y, point, item: null, folder }) }}
        onItemContextMenu={({ x, y, item, folder }) => { setWorkspaceMenu(null); setContextMenu({ x, y, point: null, item, folder }) }}
        onEdit={(item) => { setFolderId(null); setDialog({ item, point: null }) }}
        onMove={moveItem}
        onMoveOut={moveOutOfFolder}
      />
      {workspaceMenu && <WorkspaceContextMenu
        menu={workspaceMenu}
        workspaceCount={workspaces.length}
        onClose={() => setWorkspaceMenu(null)}
        onCreate={() => { setWorkspaceMenu(null); setWorkspaceDialog({ workspace: null }) }}
        onRename={(workspace) => { setWorkspaceMenu(null); setWorkspaceDialog({ workspace }) }}
        onChangeIcon={(workspace, icon) => updateWorkspace(workspace, { icon })}
        onDelete={deleteWorkspaceFromMenu}
      />}
      {workspaceDialog && <WorkspaceDialog workspace={workspaceDialog.workspace} busy={busy} onClose={() => setWorkspaceDialog(null)} onSubmit={saveWorkspaceDialog} />}
      {settingsOpen && <SettingsPanel settings={settings} workspaces={workspaces} backgroundAssets={bootstrap.backgroundAssets || []} activeBackgroundId={backgroundId || null} saving={savingCount > 0} onClose={() => setSettingsOpen(false)} onPatch={patchSettings} onCreateWorkspace={createWorkspace} onDeleteWorkspace={deleteWorkspace} onUpdateWorkspace={updateWorkspace} onReorderWorkspace={reorderWorkspace} onUploadBackground={uploadBackground} onSelectBackground={selectBackground} />}
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
      {busy && <div className="busy-indicator" aria-live="polite">Saving…</div>}
    </main>
  )
}
