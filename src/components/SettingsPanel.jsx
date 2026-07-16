import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Bot, Check, Database, FolderUp, Image, LayoutGrid, Mail, Music2, Palette, PanelsTopLeft, Play, Plus, RefreshCw, Search, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react'
import { backgroundRotationInterval } from '../lib/backgroundRotation.js'
import { DEFAULT_FONT_FAMILY, FONT_OPTIONS } from '../lib/fonts.js'
import { configuredWeatherLocations, LOCATION_OPTIONS } from '../lib/locations.js'
import { mailBridge } from '../lib/mailBridge.js'
import { musicApi } from '../lib/music.js'

const PAGES = [
  ['general', 'General', SlidersHorizontal],
  ['workspaces', 'Workspaces', PanelsTopLeft],
  ['speedDial', 'Speed Dial', LayoutGrid],
  ['search', 'Search', Search],
  ['agent', 'Agent', Bot],
  ['appearance', 'Appearance', Palette],
  ['backgrounds', 'Backgrounds', Image],
  ['widgets', 'Widgets', PanelsTopLeft],
  ['music', 'Music', Music2],
  ['mail', 'Mail', Mail],
  ['system', 'Data & System', Database],
]

const GLOW_OPTIONS = [
  ['off', 'Off'],
  ['bottom', 'Bottom glow'],
  ['full', 'Full glow'],
]

const SEARCH_GLOW_TRIGGERS = [
  ['always', 'Always'],
  ['focus', 'While focused'],
  ['typing', 'While typing'],
]

const MUSIC_GLOW_TRIGGERS = [
  ['always', 'Always'],
  ['connected', 'When connected'],
  ['playing', 'While playing'],
]

function Toggle({ label, detail, checked, onChange }) {
  return (
    <label className="setting-row">
      <span><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
      <input type="checkbox" checked={!!checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export function SettingsPanel({ settings, workspaces, backgroundAssets, backgroundCollections, activeBackgroundId, activeWorkspaceId, saving, onClose, onPatch, onCreateWorkspace, onDeleteWorkspace, onUpdateWorkspace, onReorderWorkspace, onUploadBackgrounds, onSelectBackground, onDeleteBackground, onToggleWorkspaceBackground, onRotateBackground }) {
  const [page, setPage] = useState('general')
  const [workspaceName, setWorkspaceName] = useState('')
  const [backgroundError, setBackgroundError] = useState('')
  const [pendingBackgroundDeleteId, setPendingBackgroundDeleteId] = useState('')
  const [mailAccounts, setMailAccounts] = useState(() => mailBridge.peekAccounts())
  const [mailConnection, setMailConnection] = useState('checking')
  const [newMusicSource, setNewMusicSource] = useState({ name: 'YouTube Music', baseUrl: 'http://127.0.0.1:26538' })
  const [musicChecks, setMusicChecks] = useState({})
  const globalFontFamily = settings.appearance?.fontFamily || DEFAULT_FONT_FAMILY
  const shortcutSize = Math.max(56, Math.min(92, Number(settings.speedDial?.shortcutSize) || 78))
  const wheelResistance = Math.max(0, Math.min(100, Number(settings.speedDial?.wheelResistance) || 0))
  const searchAppearance = settings.search?.appearance || {}
  const searchBlur = Math.max(0, Math.min(40, Number(searchAppearance.blur) || 0))
  const searchGlowStyle = GLOW_OPTIONS.some(([value]) => value === searchAppearance.glowStyle)
    ? searchAppearance.glowStyle
    : searchAppearance.outerGlow ? 'full' : 'bottom'
  const searchGlowTrigger = SEARCH_GLOW_TRIGGERS.some(([value]) => value === searchAppearance.glowTrigger)
    ? searchAppearance.glowTrigger
    : searchAppearance.glowOnFocus === false ? 'always' : 'typing'
  const musicGlowStyle = GLOW_OPTIONS.some(([value]) => value === settings.widgets?.musicGlowStyle)
    ? settings.widgets.musicGlowStyle
    : 'bottom'
  const musicGlowTrigger = MUSIC_GLOW_TRIGGERS.some(([value]) => value === settings.widgets?.musicGlowTrigger)
    ? settings.widgets.musicGlowTrigger
    : 'connected'
  const musicSources = settings.music?.sources || []
  const weatherLocations = configuredWeatherLocations(settings.widgets)
  const secondaryLocationIds = weatherLocations.secondary.map((location) => location.id)
  const backgroundRotation = settings.backgrounds?.rotation || {}
  const rotationScope = ['all', 'folder', 'workspace'].includes(backgroundRotation.scope) ? backgroundRotation.scope : 'all'
  const workspaceBackgroundPool = backgroundRotation.workspacePools?.[activeWorkspaceId] || []

  useEffect(() => {
    let live = true
    void Promise.all([mailBridge.health(), mailBridge.accounts()]).then(([, accountData]) => {
      if (!live) return
      setMailAccounts(accountData.accounts || [])
      setMailConnection('connected')
    }).catch(() => {
      if (live) setMailConnection('unavailable')
    })
    return () => { live = false }
  }, [])

  const addWorkspace = async (event) => {
    event.preventDefault()
    if (!workspaceName.trim()) return
    await onCreateWorkspace(workspaceName.trim())
    setWorkspaceName('')
  }

  const updateMusicSources = (sources, activeSourceId = settings.music?.activeSourceId) => {
    const nextActiveId = sources.some((source) => source.id === activeSourceId && source.enabled !== false)
      ? activeSourceId
      : sources.find((source) => source.enabled !== false)?.id || sources[0]?.id || null
    return onPatch({ music: { sources, activeSourceId: nextActiveId } })
  }

  const updateMusicSource = (sourceId, changes) => updateMusicSources(musicSources.map((source) => source.id === sourceId ? { ...source, ...changes } : source))

  const addMusicSource = (event) => {
    event.preventDefault()
    const name = newMusicSource.name.trim()
    const baseUrl = newMusicSource.baseUrl.trim()
    if (!name || !baseUrl) return
    const source = { id: `music-${crypto.randomUUID()}`, name, adapter: 'youtube-music-desktop', baseUrl, enabled: true }
    void updateMusicSources([...musicSources, source], settings.music?.activeSourceId || source.id)
    setNewMusicSource({ name: 'YouTube Music', baseUrl: 'http://127.0.0.1:26538' })
  }

  const selectPrimaryLocation = (locationId) => {
    void onPatch({
      widgets: {
        primaryLocationId: locationId,
        activeWeatherLocationId: locationId,
        secondaryLocationIds: secondaryLocationIds.filter((id) => id !== locationId),
      },
    })
  }

  const selectSecondaryLocation = (index, locationId) => {
    const next = [...secondaryLocationIds]
    if (locationId) next[index] = locationId
    else next.splice(index, 1)
    const normalized = [...new Set(next.filter((id) => id && id !== weatherLocations.primary.id))].slice(0, 2)
    const activeWeatherLocationId = normalized.includes(settings.widgets?.activeWeatherLocationId)
      ? settings.widgets.activeWeatherLocationId
      : weatherLocations.primary.id
    void onPatch({ widgets: { secondaryLocationIds: normalized, activeWeatherLocationId } })
  }

  const testMusicSource = async (source) => {
    setMusicChecks((current) => ({ ...current, [source.id]: { state: 'checking', detail: 'Connecting…' } }))
    try {
      const result = await musicApi.state(source.id)
      setMusicChecks((current) => ({ ...current, [source.id]: { state: 'connected', detail: result.song?.title || 'Connected' } }))
    } catch (error) {
      setMusicChecks((current) => ({ ...current, [source.id]: { state: 'error', detail: error.message } }))
    }
  }

  return (
    <div className="settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
        <header><div><small>V START 2</small><h2>Settings</h2></div><span className={saving ? 'saving active' : 'saving'}>{saving ? 'Saving…' : 'Saved in PostgreSQL'}</span><button type="button" onClick={onClose} aria-label="Close settings"><X /></button></header>
        <div className="settings-body">
          <nav aria-label="Settings pages">
            {PAGES.map(([id, label, Icon]) => <button key={id} type="button" className={page === id ? 'active' : ''} onClick={() => setPage(id)}><Icon size={16} />{label}</button>)}
          </nav>
          <main>
            {page === 'general' && <>
              <h3>General</h3>
              <Toggle label="Mirror two-column layout" detail="Moves the widget rail to the right without changing shortcut positions." checked={settings.general?.mirrorLayout} onChange={(value) => onPatch({ general: { mirrorLayout: value } })} />
              <Toggle label="Open links in a new tab" checked={settings.general?.openLinksInNewTab} onChange={(value) => onPatch({ general: { openLinksInNewTab: value } })} />
              <Toggle label="Autofocus search bar" checked={settings.general?.autofocusSearch} onChange={(value) => onPatch({ general: { autofocusSearch: value } })} />
              <Toggle label="Inner outline" detail="Frames the compact marquee, shortcuts, search bar, and widget controls as one composition." checked={settings.general?.innerOutline} onChange={(value) => onPatch({ general: { innerOutline: value } })} />
            </>}
            {page === 'workspaces' && <>
              <h3>Workspaces</h3>
              <p className="settings-intro">Each workspace has a stable URL. Renaming never silently changes its slug.</p>
              <div className="workspace-settings-list">
                {workspaces.map((workspace, index) => <div className="workspace-editor" key={`${workspace.id}:${workspace.version}`}>
                  <div className="workspace-editor-title">
                    <span><strong>{workspace.name}</strong><small>/w/{workspace.slug}</small></span>
                    <div className="workspace-order-actions"><button type="button" disabled={index === 0} onClick={() => onReorderWorkspace(workspace.id, -1)} aria-label={`Move ${workspace.name} up`}><ArrowUp /></button><button type="button" disabled={index === workspaces.length - 1} onClick={() => onReorderWorkspace(workspace.id, 1)} aria-label={`Move ${workspace.name} down`}><ArrowDown /></button><button type="button" disabled={workspaces.length === 1} onClick={() => onDeleteWorkspace(workspace.id)}>Delete</button></div>
                  </div>
                  <div className="workspace-editor-fields">
                    <label>Name<input defaultValue={workspace.name} onBlur={(event) => event.target.value.trim() && event.target.value.trim() !== workspace.name && onUpdateWorkspace(workspace, { name: event.target.value.trim() })} /></label>
                    <label>URL slug<input defaultValue={workspace.slug} onBlur={(event) => event.target.value.trim() && event.target.value.trim() !== workspace.slug && onUpdateWorkspace(workspace, { slug: event.target.value.trim() })} /></label>
                  </div>
                  {settings.workspaces?.individualTypography && <div className="workspace-theme-fields">
                    <label>Font<select value={workspace.fontFamily || ''} onChange={(event) => onUpdateWorkspace(workspace, { fontFamily: event.target.value || null })}>
                      <option value="">Use global font</option>
                      {workspace.fontFamily && !FONT_OPTIONS.some((font) => font.value === workspace.fontFamily) && <option value={workspace.fontFamily}>Current custom font</option>}
                      {FONT_OPTIONS.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}
                    </select></label>
                    <label>Text<input type="color" value={workspace.textColor || '#f4f6ff'} onChange={(event) => onUpdateWorkspace(workspace, { textColor: event.target.value })} /></label>
                    <label>Accent<input type="color" value={workspace.accentColor || '#8ba6ff'} onChange={(event) => onUpdateWorkspace(workspace, { accentColor: event.target.value })} /></label>
                  </div>}
                </div>)}
              </div>
              <form className="add-workspace-form" onSubmit={addWorkspace}><input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="New workspace name" /><button>Add workspace</button></form>
              <Toggle label="Individual workspace typography and colors" checked={settings.workspaces?.individualTypography} onChange={(value) => onPatch({ workspaces: { individualTypography: value } })} />
            </>}
            {page === 'speedDial' && <>
              <h3>Speed Dial</h3>
              <Toggle label="Always show shortcut names" detail="Turn off to reveal names only on hover or keyboard focus." checked={settings.speedDial?.alwaysShowNames} onChange={(value) => onPatch({ speedDial: { alwaysShowNames: value } })} />
              <Toggle label="Show folder labels" checked={settings.speedDial?.showFolderLabels} onChange={(value) => onPatch({ speedDial: { showFolderLabels: value } })} />
              <Toggle label="Open shortcut names inline" detail="Keeps icon clicks unchanged; clicking a shortcut name opens that page inside V Start." checked={settings.speedDial?.labelOpensInline === true} onChange={(value) => onPatch({ speedDial: { labelOpensInline: value } })} />
              <label className="setting-field range-setting"><span>Shortcut and folder size <output aria-hidden="true">{shortcutSize}%</output></span><input type="range" min="56" max="92" step="2" value={shortcutSize} aria-label="Shortcut and folder size" onChange={(event) => onPatch({ speedDial: { shortcutSize: Number(event.target.value) } })} /></label>
              <p className="field-help">Changes icon and folder-preview size without moving saved positions.</p>
              <label className="setting-field range-setting"><span>Workspace scroll resistance <output aria-hidden="true">{wheelResistance <= 20 ? 'Snappy' : wheelResistance >= 70 ? 'Resistant' : 'Balanced'} · {wheelResistance}</output></span><input type="range" min="0" max="100" step="5" value={wheelResistance} aria-label="Workspace scroll resistance" onChange={(event) => onPatch({ speedDial: { wheelResistance: Number(event.target.value) } })} /></label>
              <p className="field-help">Lower values switch workspaces sooner and shorten the wheel cooldown.</p>
              <div className="setting-note"><strong>Free placement is always enabled.</strong><span>There is no grid snapping, auto-arrange, or gravity setting.</span></div>
            </>}
            {page === 'search' && <>
              <h3>Search</h3>
              <label className="setting-field"><span>Default search engine</span><select value={settings.search?.engine || 'google'} onChange={(event) => onPatch({ search: { engine: event.target.value } })}><option value="google">Google</option><option value="duckduckgo">DuckDuckGo</option><option value="brave">Brave</option></select></label>
              <Toggle label="Inline results" checked={settings.search?.inlineEnabled !== false} onChange={(value) => onPatch({ search: { inlineEnabled: value } })} />
              <label className="setting-field"><span>Result click behavior</span><select value={settings.search?.inlineLinkBehavior || 'inline'} onChange={(event) => onPatch({ search: { inlineLinkBehavior: event.target.value } })}><option value="inline">Open inline in right rail</option><option value="inline-fullscreen">Open inline full screen</option><option value="external">Open in a new tab</option></select></label>
              <p className="field-help">Hovering a result still reveals quick alternatives for inline, full-screen, external, and shortcut actions.</p>
              <Toggle label="Image search" checked={settings.search?.imageSearchEnabled !== false} onChange={(value) => onPatch({ search: { imageSearchEnabled: value } })} />
              <Toggle label="Search bar outline" checked={searchAppearance.outline !== false} onChange={(value) => onPatch({ search: { appearance: { outline: value } } })} />
              <label className="setting-field"><span>Search bar glow</span><select value={searchGlowStyle} onChange={(event) => onPatch({ search: { appearance: { glowStyle: event.target.value } } })}>{GLOW_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {searchGlowStyle !== 'off' && <label className="setting-field"><span>Show search glow</span><select value={searchGlowTrigger} onChange={(event) => onPatch({ search: { appearance: { glowTrigger: event.target.value } } })}>{SEARCH_GLOW_TRIGGERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
              <label className="setting-field range-setting"><span>Search bar blur <output aria-hidden="true">{searchBlur}px</output></span><input type="range" min="0" max="40" step="1" value={searchBlur} aria-label="Search bar blur" onChange={(event) => onPatch({ search: { appearance: { blur: Number(event.target.value) } } })} /></label>
              <p className="field-help">In edit mode, drag the handle beside the workspace buttons to set their horizontal relationship to the search bar.</p>
              <div className="setting-note"><strong>Keyboard shortcuts</strong><span><kbd>/</kbd> focuses search · <kbd>⌘ Enter</kbd> enables inline · <kbd>⌘ ⇧ I</kbd> toggles image search</span></div>
              <div className="setting-note"><strong>AI control</strong><span>The V Start 1 glyph opens the local Hermes Agent Mode. Search never stores provider credentials.</span></div>
            </>}
            {page === 'agent' && <>
              <h3>Agent</h3>
              <Toggle label="Enable Agent Mode" detail="Routes through V Start to the native loopback Hermes bridge; no provider API is embedded." checked={settings.agent?.enabled !== false} onChange={(value) => onPatch({ agent: { enabled: value } })} />
              <label className="setting-field"><span>Agent bridge route</span><input className="text-setting-input" defaultValue={settings.agent?.bridgeUrl || '/agent-bridge'} onBlur={(event) => event.target.value.trim() && event.target.value.trim() !== settings.agent?.bridgeUrl && onPatch({ agent: { bridgeUrl: event.target.value.trim() } })} /></label>
              <label className="setting-field"><span>Hermes-profile reasoning default</span><select value={settings.agent?.defaultReasoningEffort || 'medium'} onChange={(event) => onPatch({ agent: { defaultReasoningEffort: event.target.value } })}><option value="none">Off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Max</option></select></label>
              <Toggle label="Fast mode by default" detail="Applied only when the selected Hermes model supports it." checked={settings.agent?.defaultFastMode} onChange={(value) => onPatch({ agent: { defaultFastMode: value } })} />
              <Toggle label="Show tool activity" checked={settings.agent?.showToolActivity !== false} onChange={(value) => onPatch({ agent: { showToolActivity: value } })} />
              <Toggle label="Show token usage" checked={settings.agent?.showUsage} onChange={(value) => onPatch({ agent: { showUsage: value } })} />
              <Toggle label="Workspace-specific agent defaults" detail="Stores working-directory and model preferences in PostgreSQL." checked={settings.agent?.workspaceDefaultsEnabled !== false} onChange={(value) => onPatch({ agent: { workspaceDefaultsEnabled: value } })} />
              <div className="setting-note"><strong>Credentials stay in Hermes.</strong><span>V Start contains no provider key, OAuth, sudo, secret, executable, or arbitrary CLI controls. If Hermes approvals are off, Agent Mode locks rather than running tools automatically.</span></div>
            </>}
            {page === 'appearance' && <>
              <h3>Appearance</h3>
              <Toggle label="Edge effect" checked={settings.appearance?.edgeEffect} onChange={(value) => onPatch({ appearance: { edgeEffect: value } })} />
              <Toggle label="Edge glow" checked={settings.appearance?.edgeGlow} onChange={(value) => onPatch({ appearance: { edgeGlow: value } })} />
              <Toggle label="Animated overlay" checked={settings.appearance?.animatedOverlay} onChange={(value) => onPatch({ appearance: { animatedOverlay: value } })} />
              <label className="setting-field"><span>Global font family</span><select value={globalFontFamily} onChange={(event) => onPatch({ appearance: { fontFamily: event.target.value } })}>
                {!FONT_OPTIONS.some((font) => font.value === globalFontFamily) && <option value={globalFontFamily}>Current custom font</option>}
                {FONT_OPTIONS.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}
              </select></label>
              <label className="setting-field"><span>Accent color</span><input type="color" value={settings.appearance?.accentColor || '#8ba6ff'} onChange={(event) => onPatch({ appearance: { accentColor: event.target.value } })} /></label>
              <label className="setting-field"><span>Text color</span><input type="color" value={settings.appearance?.textColor || '#f4f6ff'} onChange={(event) => onPatch({ appearance: { textColor: event.target.value } })} /></label>
            </>}
            {page === 'backgrounds' && <>
              <h3>Backgrounds</h3>
              <Toggle label="Workspace-specific backgrounds" checked={settings.backgrounds?.workspaceSpecific} onChange={(value) => onPatch({ backgrounds: { workspaceSpecific: value, ...(!value && rotationScope === 'workspace' ? { rotation: { scope: 'all' } } : {}) } })} />
              <div className="background-rotation-settings">
                <Toggle label="Rotate backgrounds" detail="Advances automatically and saves the selected image in PostgreSQL." checked={backgroundRotation.enabled === true} onChange={(value) => onPatch({ backgrounds: { rotation: { enabled: value } } })} />
                {backgroundRotation.enabled === true && <div className="background-rotation-controls">
                  <label className="setting-field"><span>Rotation pool</span><select value={rotationScope} onChange={(event) => onPatch({ backgrounds: { rotation: { scope: event.target.value } } })}>
                    <option value="all">All backgrounds</option>
                    <option value="folder">Imported folder</option>
                    {settings.backgrounds?.workspaceSpecific && <option value="workspace">Current workspace pool</option>}
                  </select></label>
                  {rotationScope === 'folder' && <label className="setting-field"><span>Folder</span><select value={backgroundRotation.collectionId || ''} onChange={(event) => onPatch({ backgrounds: { rotation: { collectionId: event.target.value || null } } })}>
                    <option value="">Choose a folder</option>
                    {(backgroundCollections || []).map((collection) => <option key={collection.id} value={collection.id}>{collection.name} · {collection.assetIds.length}</option>)}
                  </select></label>}
                  <label className="setting-field background-interval-field"><span>Change every</span><span><input key={backgroundRotation.intervalMinutes ?? 15} type="number" min="1" max="1440" step="1" defaultValue={backgroundRotationInterval(backgroundRotation.intervalMinutes)} onBlur={(event) => onPatch({ backgrounds: { rotation: { intervalMinutes: backgroundRotationInterval(event.target.value) } } })} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()} /> minutes</span></label>
                  <button type="button" className="background-rotate-now" onClick={async () => {
                    setBackgroundError('')
                    try {
                      const result = await onRotateBackground()
                      if (!result.rotated) setBackgroundError(result.count ? 'Add at least two backgrounds to this rotation pool.' : 'This rotation pool is empty.')
                    } catch (error) { setBackgroundError(error.message) }
                  }}><Play /> Rotate now</button>
                  {rotationScope === 'workspace' && <p className="field-help">Use the check buttons on background cards to build this workspace’s pool. Selecting or uploading a background adds it automatically.</p>}
                </div>}
              </div>
              <div className="background-library" aria-label="Background library">
                <button type="button" className={!activeBackgroundId ? 'active empty' : 'empty'} onClick={() => onSelectBackground(null)} aria-pressed={!activeBackgroundId}>
                  <span>None</span>
                </button>
                {backgroundAssets.map((asset) => {
                  const collections = (backgroundCollections || []).filter((collection) => collection.assetIds.includes(asset.id))
                  const inWorkspacePool = workspaceBackgroundPool.includes(asset.id)
                  const pendingDelete = pendingBackgroundDeleteId === asset.id
                  return <article key={asset.id} className={`background-card ${activeBackgroundId === asset.id ? 'active' : ''}`}>
                    <button type="button" className="background-card-select" onClick={() => onSelectBackground(asset.id)} aria-pressed={activeBackgroundId === asset.id} title={asset.originalName || 'Background'}>
                      <img src={`/api/assets/${asset.id}/preview`} alt="" loading="lazy" decoding="async" />
                      <span>{asset.originalName || 'Background'}</span>
                      <small>{collections[0]?.name || `${Math.max(1, Math.round(asset.byteLength / 1024))} KiB`}</small>
                    </button>
                    <div className="background-card-actions">
                      {settings.backgrounds?.workspaceSpecific && <button type="button" className={inWorkspacePool ? 'included' : ''} onClick={() => onToggleWorkspaceBackground(asset.id)} title={inWorkspacePool ? 'Remove from this workspace rotation pool' : 'Include in this workspace rotation pool'} aria-label={inWorkspacePool ? 'Remove from workspace rotation pool' : 'Include in workspace rotation pool'}>{inWorkspacePool ? <Check /> : <Plus />}</button>}
                      <button type="button" className={`background-delete ${pendingDelete ? 'confirming' : ''}`} onClick={async () => {
                        if (!pendingDelete) { setPendingBackgroundDeleteId(asset.id); return }
                        setBackgroundError('')
                        try { await onDeleteBackground(asset.id); setPendingBackgroundDeleteId('') }
                        catch (error) { setBackgroundError(error.message) }
                      }} title={pendingDelete ? 'Click again to delete' : 'Delete background'} aria-label={pendingDelete ? 'Confirm delete background' : 'Delete background'}>{pendingDelete ? 'Delete?' : <Trash2 />}</button>
                    </div>
                  </article>
                })}
              </div>
              <div className="background-upload-options">
                <label className="background-upload"><Upload /><strong>Upload images</strong><span>{settings.backgrounds?.workspaceSpecific ? 'Adds them to the active workspace.' : 'Adds them to the global library.'}</span><input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" disabled={saving} onChange={async (event) => {
                  setBackgroundError('')
                  try { await onUploadBackgrounds(event.target.files) }
                  catch (error) { setBackgroundError(error.message) }
                  event.target.value = ''
                }} /></label>
                <label className="background-upload"><FolderUp /><strong>Import image folder</strong><span>No combined folder limit; each image may be up to 300 MB.</span><input type="file" multiple webkitdirectory="" directory="" disabled={saving} onChange={async (event) => {
                  setBackgroundError('')
                  const files = Array.from(event.target.files || [])
                  const collectionName = files[0]?.webkitRelativePath?.split('/')[0] || 'Imported backgrounds'
                  try { await onUploadBackgrounds(files, collectionName) }
                  catch (error) { setBackgroundError(error.message) }
                  event.target.value = ''
                }} /></label>
              </div>
              {backgroundError && <p className="form-error">{backgroundError}</p>}
              <div className="setting-note"><strong>Database-backed assets</strong><span>Images, folder membership, workspace pools, rotation settings, and the current selection are restored from PostgreSQL.</span></div>
            </>}
            {page === 'widgets' && <>
              <h3>Widgets</h3>
              {['clock', 'weather', 'notes', 'email', 'music'].map((widget) => <Toggle key={widget} label={`Show ${widget}`} checked={settings.widgets?.[widget] !== false} onChange={(value) => onPatch({ widgets: { [widget]: value } })} />)}
              <div className="time-weather-settings">
                <h4>Time &amp; weather</h4>
                <label className="setting-field"><span>Primary city</span><select value={weatherLocations.primary.id} onChange={(event) => selectPrimaryLocation(event.target.value)}>{LOCATION_OPTIONS.map((location) => <option key={location.id} value={location.id}>{location.city} · {location.country}</option>)}</select></label>
                {[0, 1].map((index) => <label className="setting-field" key={index}><span>Secondary city {index + 1}</span><select value={secondaryLocationIds[index] || ''} onChange={(event) => selectSecondaryLocation(index, event.target.value)}><option value="">None</option>{LOCATION_OPTIONS.map((location) => <option key={location.id} value={location.id} disabled={location.id === weatherLocations.primary.id || secondaryLocationIds.some((id, selectedIndex) => selectedIndex !== index && id === location.id)}>{location.city} · {location.country}</option>)}</select></label>)}
                <Toggle label="24-hour time" detail="Applies to the primary and secondary clocks." checked={settings.widgets?.twentyFourHour === true} onChange={(value) => onPatch({ widgets: { twentyFourHour: value } })} />
                <Toggle label="Celsius" detail="Also changes weather wind speed to km/h." checked={settings.widgets?.celsius === true} onChange={(value) => onPatch({ widgets: { celsius: value } })} />
                <div className="setting-note"><strong>Clocks control weather context.</strong><span>Click the main or secondary clock to switch both weather views to that city.</span></div>
              </div>
              <label className="setting-field"><span>Music player glow</span><select value={musicGlowStyle} onChange={(event) => onPatch({ widgets: { musicGlowStyle: event.target.value } })}>{GLOW_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              {musicGlowStyle !== 'off' && <label className="setting-field"><span>Show music glow</span><select value={musicGlowTrigger} onChange={(event) => onPatch({ widgets: { musicGlowTrigger: event.target.value } })}>{MUSIC_GLOW_TRIGGERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
              <Toggle label="Music player outline" detail="Off by default for a lighter floating treatment." checked={settings.widgets?.musicOutline === true} onChange={(value) => onPatch({ widgets: { musicOutline: value } })} />
              <label className="setting-field"><span>Music player blur</span><input type="range" min="0" max="40" value={settings.widgets?.musicBlur ?? 18} onChange={(event) => onPatch({ widgets: { musicBlur: Number(event.target.value) } })} /></label>
            </>}
            {page === 'music' && <>
              <h3>Music</h3>
              <p className="settings-intro">Connect multiple local players and choose the active source from either Settings or the widget. Source configuration is stored in PostgreSQL.</p>
              <label className="setting-field"><span>Active source</span><select value={settings.music?.activeSourceId || ''} onChange={(event) => onPatch({ music: { activeSourceId: event.target.value } })} disabled={!musicSources.length}>
                {!musicSources.length && <option value="">No sources configured</option>}
                {musicSources.map((source) => <option key={source.id} value={source.id} disabled={source.enabled === false}>{source.name}{source.enabled === false ? ' (disabled)' : ''}</option>)}
              </select></label>
              <div className="music-source-settings">
                {musicSources.map((source) => {
                  const check = musicChecks[source.id]
                  return <article key={source.id} className={source.id === settings.music?.activeSourceId ? 'active' : ''}>
                    <div className="music-source-heading"><span><Music2 /><strong>{source.name}</strong><small>{source.adapter === 'youtube-music-desktop' ? 'YouTube Music Desktop API' : source.adapter}</small></span><div><button type="button" onClick={() => testMusicSource(source)} disabled={check?.state === 'checking'}><RefreshCw />{check?.state === 'checking' ? 'Testing…' : 'Test'}</button><button type="button" className="danger" onClick={() => updateMusicSources(musicSources.filter((item) => item.id !== source.id))} aria-label={`Delete ${source.name}`}><Trash2 /></button></div></div>
                    <div className="music-source-fields">
                      <label>Name<input defaultValue={source.name} onBlur={(event) => event.target.value.trim() && event.target.value.trim() !== source.name && updateMusicSource(source.id, { name: event.target.value.trim() })} /></label>
                      <label>Provider<select value={source.adapter} onChange={(event) => updateMusicSource(source.id, { adapter: event.target.value })}><option value="youtube-music-desktop">YouTube Music Desktop</option>{source.adapter !== 'youtube-music-desktop' && <option value={source.adapter}>{source.adapter}</option>}</select></label>
                      <label className="music-source-url">API URL<input type="url" defaultValue={source.baseUrl} onBlur={(event) => event.target.value.trim() && event.target.value.trim() !== source.baseUrl && updateMusicSource(source.id, { baseUrl: event.target.value.trim() })} placeholder="http://127.0.0.1:26538" /></label>
                    </div>
                    <Toggle label="Source enabled" checked={source.enabled !== false} onChange={(value) => updateMusicSource(source.id, { enabled: value })} />
                    {check && <p className={`music-source-check ${check.state}`}>{check.detail}</p>}
                  </article>
                })}
              </div>
              <form className="add-music-source" onSubmit={addMusicSource}>
                <h4><Plus /> Add music source</h4>
                <label>Name<input value={newMusicSource.name} onChange={(event) => setNewMusicSource((current) => ({ ...current, name: event.target.value }))} /></label>
                <label>API URL<input required type="url" value={newMusicSource.baseUrl} onChange={(event) => setNewMusicSource((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
                <button type="submit"><Plus /> Add source</button>
              </form>
              <div className="setting-note"><strong>YouTube Music is ready on port 26538.</strong><span>The server proxy translates loopback access correctly when V Start runs inside Docker. Future provider types can use this same source registry.</span></div>
            </>}
            {page === 'mail' && <>
              <h3>Mail</h3>
              <p className="settings-intro">Choose which local inbox opens with each workspace. Assignments and refresh preferences are stored in PostgreSQL.</p>
              <div className={`mail-settings-status ${mailConnection}`}>
                <Mail />
                <span><strong>{mailConnection === 'connected' ? 'Local mail ready' : mailConnection === 'unavailable' ? 'Local mail unavailable' : 'Checking local mail…'}</strong><small>{mailConnection === 'connected' ? `${mailAccounts.length} configured ${mailAccounts.length === 1 ? 'inbox' : 'inboxes'} · warmed in memory while V Start is open` : 'V Start will keep retrying its background warmup.'}</small></span>
              </div>
              <label className="setting-field"><span>Default inbox</span><select value={settings.mail?.defaultAccount || 'all'} onChange={(event) => onPatch({ mail: { defaultAccount: event.target.value } })}>
                <option value="all">All inboxes</option>
                {mailAccounts.map((item) => <option key={item.alias} value={item.alias}>{item.alias} · {item.email}</option>)}
              </select></label>
              <label className="setting-field"><span>Background refresh</span><select value={String(settings.mail?.refreshSeconds ?? 60)} onChange={(event) => onPatch({ mail: { refreshSeconds: Number(event.target.value) } })}>
                <option value="30">Every 30 seconds</option>
                <option value="60">Every minute</option>
                <option value="300">Every 5 minutes</option>
                <option value="0">Only when V Start loads</option>
              </select></label>
              <div className="mail-workspace-settings">
                <h4>Workspace inboxes</h4>
                {workspaces.map((workspace) => {
                  const assigned = settings.mail?.workspaceAccounts?.[workspace.id] || ''
                  const isUnknown = assigned && assigned !== 'all' && !mailAccounts.some((item) => item.alias === assigned)
                  return <label key={workspace.id}><span><strong>{workspace.name}</strong><small>/w/{workspace.slug}</small></span><select value={assigned} onChange={(event) => onPatch({ mail: { workspaceAccounts: { [workspace.id]: event.target.value } } })}>
                    <option value="">Use Mail default</option>
                    <option value="all">All inboxes</option>
                    {isUnknown && <option value={assigned}>{assigned} (not currently available)</option>}
                    {mailAccounts.map((item) => <option key={item.alias} value={item.alias}>{item.alias}</option>)}
                  </select></label>
                })}
              </div>
              <div className="setting-note"><strong>No browser mailbox storage.</strong><span>Only a short-lived memory cache is used for instant opening. Messages are never copied into PostgreSQL or browser storage.</span></div>
            </>}
            {page === 'system' && <>
              <h3>Data & System</h3>
              <div className="database-status"><Database /><div><strong>PostgreSQL connected</strong><span>Settings, workspaces, shortcuts, placements, and icon assets are server-owned.</span></div></div>
              <div className="setting-note"><strong>Browser persistence disabled</strong><span>V Start 2 does not use localStorage, sessionStorage, IndexedDB, or Cache Storage for app state.</span></div>
            </>}
          </main>
        </div>
      </section>
    </div>
  )
}
