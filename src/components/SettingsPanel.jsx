import { useState } from 'react'
import { ArrowDown, ArrowUp, Database, Image, LayoutGrid, Palette, PanelsTopLeft, Search, SlidersHorizontal, X } from 'lucide-react'

const PAGES = [
  ['general', 'General', SlidersHorizontal],
  ['workspaces', 'Workspaces', PanelsTopLeft],
  ['speedDial', 'Speed Dial', LayoutGrid],
  ['search', 'Search', Search],
  ['appearance', 'Appearance', Palette],
  ['backgrounds', 'Backgrounds', Image],
  ['widgets', 'Widgets', PanelsTopLeft],
  ['system', 'Data & System', Database],
]

function Toggle({ label, detail, checked, onChange }) {
  return (
    <label className="setting-row">
      <span><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
      <input type="checkbox" checked={!!checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

export function SettingsPanel({ settings, workspaces, saving, onClose, onPatch, onCreateWorkspace, onDeleteWorkspace, onUpdateWorkspace, onReorderWorkspace, onUploadBackground }) {
  const [page, setPage] = useState('general')
  const [workspaceName, setWorkspaceName] = useState('')
  const [backgroundError, setBackgroundError] = useState('')

  const addWorkspace = async (event) => {
    event.preventDefault()
    if (!workspaceName.trim()) return
    await onCreateWorkspace(workspaceName.trim())
    setWorkspaceName('')
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
              <Toggle label="Inner outline" checked={settings.general?.innerOutline} onChange={(value) => onPatch({ general: { innerOutline: value } })} />
            </>}
            {page === 'workspaces' && <>
              <h3>Workspaces</h3>
              <p className="settings-intro">Each workspace has a stable URL. Renaming never silently changes its slug.</p>
              <div className="workspace-settings-list">
                {workspaces.map((workspace, index) => <div className="workspace-editor" key={`${workspace.id}:${workspace.version}`}>
                  <div className="workspace-editor-title">
                    <span><strong>{workspace.name}</strong><small>/w/{workspace.slug}</small></span>
                    <div className="workspace-order-actions"><button type="button" disabled={index === 0} onClick={() => onReorderWorkspace(workspace.id, -1)} aria-label={`Move ${workspace.name} up`}><ArrowUp /></button><button type="button" disabled={index === workspaces.length - 1} onClick={() => onReorderWorkspace(workspace.id, 1)} aria-label={`Move ${workspace.name} down`}><ArrowDown /></button><button type="button" disabled={workspaces.length === 1} onClick={() => confirm(`Delete ${workspace.name}?`) && onDeleteWorkspace(workspace.id)}>Delete</button></div>
                  </div>
                  <div className="workspace-editor-fields">
                    <label>Name<input defaultValue={workspace.name} onBlur={(event) => event.target.value.trim() && event.target.value.trim() !== workspace.name && onUpdateWorkspace(workspace, { name: event.target.value.trim() })} /></label>
                    <label>URL slug<input defaultValue={workspace.slug} onBlur={(event) => event.target.value.trim() && event.target.value.trim() !== workspace.slug && onUpdateWorkspace(workspace, { slug: event.target.value.trim() })} /></label>
                  </div>
                  {settings.workspaces?.individualTypography && <div className="workspace-theme-fields">
                    <label>Font<input defaultValue={workspace.fontFamily || ''} placeholder="Use global font" onBlur={(event) => onUpdateWorkspace(workspace, { fontFamily: event.target.value.trim() || null })} /></label>
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
              <div className="setting-note"><strong>Free placement is always enabled.</strong><span>There is no grid snapping, auto-arrange, or gravity setting.</span></div>
            </>}
            {page === 'search' && <>
              <h3>Search</h3>
              <label className="setting-field"><span>Default search engine</span><select value={settings.search?.engine || 'google'} onChange={(event) => onPatch({ search: { engine: event.target.value } })}><option value="google">Google</option><option value="duckduckgo">DuckDuckGo</option><option value="brave">Brave</option></select></label>
              <Toggle label="Inline results" checked={settings.search?.inlineEnabled !== false} onChange={(value) => onPatch({ search: { inlineEnabled: value } })} />
              <Toggle label="Image search" checked={settings.search?.imageSearchEnabled !== false} onChange={(value) => onPatch({ search: { imageSearchEnabled: value } })} />
              <div className="setting-note"><strong>Keyboard shortcuts</strong><span><kbd>/</kbd> focuses search · <kbd>⌘ Enter</kbd> enables inline · <kbd>⌘ ⇧ I</kbd> toggles image search</span></div>
              <div className="setting-note"><strong>AI control</strong><span>The V Start 1 glyph is a clickable local placeholder. No backend or provider settings are included.</span></div>
            </>}
            {page === 'appearance' && <>
              <h3>Appearance</h3>
              <Toggle label="Edge effect" checked={settings.appearance?.edgeEffect} onChange={(value) => onPatch({ appearance: { edgeEffect: value } })} />
              <Toggle label="Edge glow" checked={settings.appearance?.edgeGlow} onChange={(value) => onPatch({ appearance: { edgeGlow: value } })} />
              <Toggle label="Animated overlay" checked={settings.appearance?.animatedOverlay} onChange={(value) => onPatch({ appearance: { animatedOverlay: value } })} />
              <label className="setting-field"><span>Global font family</span><input className="text-setting-input" defaultValue={settings.appearance?.fontFamily || ''} onBlur={(event) => onPatch({ appearance: { fontFamily: event.target.value.trim() || 'Inter, system-ui, sans-serif' } })} /></label>
              <label className="setting-field"><span>Accent color</span><input type="color" value={settings.appearance?.accentColor || '#8ba6ff'} onChange={(event) => onPatch({ appearance: { accentColor: event.target.value } })} /></label>
              <label className="setting-field"><span>Text color</span><input type="color" value={settings.appearance?.textColor || '#f4f6ff'} onChange={(event) => onPatch({ appearance: { textColor: event.target.value } })} /></label>
            </>}
            {page === 'backgrounds' && <>
              <h3>Backgrounds</h3>
              <Toggle label="Workspace-specific backgrounds" checked={settings.backgrounds?.workspaceSpecific} onChange={(value) => onPatch({ backgrounds: { workspaceSpecific: value } })} />
              <label className="background-upload"><strong>Upload background</strong><span>{settings.backgrounds?.workspaceSpecific ? 'Applies to the active workspace.' : 'Applies globally.'} Images are stored in PostgreSQL.</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async (event) => {
                setBackgroundError('')
                try { await onUploadBackground(event.target.files?.[0]) }
                catch (error) { setBackgroundError(error.message) }
                event.target.value = ''
              }} /></label>
              {backgroundError && <p className="form-error">{backgroundError}</p>}
              <div className="setting-note"><strong>Database-backed assets</strong><span>Background selection is restored from PostgreSQL; no browser cache is used.</span></div>
            </>}
            {page === 'widgets' && <>
              <h3>Widgets</h3>
              {['clock', 'weather', 'notes', 'email', 'music'].map((widget) => <Toggle key={widget} label={`Show ${widget}`} checked={settings.widgets?.[widget] !== false} onChange={(value) => onPatch({ widgets: { [widget]: value } })} />)}
              <label className="setting-field"><span>Music player blur</span><input type="range" min="0" max="40" value={settings.widgets?.musicBlur ?? 18} onChange={(event) => onPatch({ widgets: { musicBlur: Number(event.target.value) } })} /></label>
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
