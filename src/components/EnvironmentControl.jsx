import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Lightbulb, Power, RotateCw, X } from 'lucide-react'

import { environmentApi } from '../lib/environment.js'

function selectedValues(device, selection) {
  const channels = device?.capabilities?.channels || []
  const state = device?.state || {}
  const channel = channels.find((candidate) => candidate.id === selection.channel)
    || channels.find((candidate) => candidate.id === state.channel)
    || channels.find((candidate) => candidate.id === device?.capabilities?.defaultChannel)
    || channels[0]
    || null
  const level = channel?.levels.includes(selection.level)
    ? selection.level
    : channel?.levels.includes(state.level)
      ? state.level
      : channel?.levels.at(-1) ?? null
  return { channel, level }
}

function EnvironmentIntensitySlider({ channel, level, disabled, onPreview, onCommit }) {
  const levels = channel?.levels || []
  const levelIndex = Math.max(0, levels.indexOf(level))
  const levelFromEvent = (event) => levels[Number(event.currentTarget.value)]
  const commitKeyboardChange = (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) onCommit(levelFromEvent(event))
  }
  return (
    <label className="environment-intensity environment-intensity-slider">
      <span>Intensity</span>
      <input type="range" min="0" max={Math.max(0, levels.length - 1)} step="1" value={levelIndex} disabled={disabled || levels.length < 2} onChange={(event) => onPreview(levelFromEvent(event))} onPointerUp={(event) => onCommit(levelFromEvent(event))} onKeyUp={commitKeyboardChange} aria-label="Room light intensity" aria-valuetext={level == null ? 'Unavailable' : `${level}%`} />
      <output>{level == null ? '—' : `${level}%`}</output>
    </label>
  )
}

export function EnvironmentControl({ expanded = false, onClose, onOpen }) {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [action, setAction] = useState('')
  const [selection, setSelection] = useState({ channel: '', level: null })
  const [widgetExpanded, setWidgetExpanded] = useState(false)
  const device = snapshot?.devices?.find((candidate) => candidate.kind === 'light') || null
  const values = useMemo(() => selectedValues(device, selection), [device, selection])
  const isOn = device?.state?.power === true

  const refresh = useCallback(async (signal) => {
    try {
      const next = await environmentApi.snapshot(signal)
      setSnapshot(next)
      setError('')
    } catch (refreshError) {
      if (refreshError.name !== 'AbortError') setError(refreshError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    const timer = window.setInterval(() => void refresh(controller.signal), 12_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [refresh])

  const run = async (kind, operation, optimisticState) => {
    if (action) return
    const previous = snapshot
    setAction(kind)
    setError('')
    if (device && optimisticState) {
      setSnapshot((current) => ({ ...current, devices: current.devices.map((candidate) => candidate.id === device.id ? { ...candidate, state: { ...candidate.state, ...optimisticState } } : candidate) }))
    }
    try {
      setSnapshot(await operation())
    } catch (operationError) {
      setSnapshot(previous)
      setError(operationError.message)
    } finally {
      setAction('')
    }
  }

  const setPower = () => {
    if (values.channel) setSelection({ channel: values.channel.id, level: values.level })
    void run('power', () => environmentApi.setPower(!isOn), { power: !isOn })
  }

  const setChannel = (channel) => {
    const level = channel.levels.includes(values.level) ? values.level : channel.levels.at(-1)
    setSelection({ channel: channel.id, level })
    void run('color', () => environmentApi.setLight(channel.id, level), { power: true, channel: channel.id, level })
  }

  const setLevel = (level) => {
    if (!values.channel) return
    setSelection({ channel: values.channel.id, level })
    void run('level', () => environmentApi.setLight(values.channel.id, level), { power: true, channel: values.channel.id, level })
  }

  const previewLevel = (level) => {
    if (!values.channel || level == null) return
    setSelection({ channel: values.channel.id, level })
  }

  const cycleChannel = (direction) => {
    const channels = device?.capabilities?.channels || []
    if (!channels.length || action) return
    const currentIndex = Math.max(0, channels.findIndex((channel) => channel.id === values.channel?.id))
    setChannel(channels[(currentIndex + direction + channels.length) % channels.length])
  }

  const cycleLevel = (direction) => {
    const levels = values.channel?.levels || []
    if (!levels.length || action) return
    const currentIndex = Math.max(0, levels.indexOf(values.level))
    const nextIndex = Math.min(levels.length - 1, Math.max(0, currentIndex + direction))
    if (levels[nextIndex] !== values.level) setLevel(levels[nextIndex])
  }

  const handleWheel = (event, cycle) => {
    event.preventDefault()
    event.stopPropagation()
    if (Math.abs(event.deltaY) < 1) return
    cycle(event.deltaY > 0 ? 1 : -1)
  }

  const openFull = () => {
    setWidgetExpanded(false)
    onOpen?.()
  }

  const status = loading
    ? 'Connecting to local CLI…'
    : error
      ? 'Bridge unavailable'
      : action
        ? 'Updating room light…'
        : `${device?.name || 'Room Light'} · ${isOn ? `${values.channel?.name || 'On'} ${device?.state?.level ?? values.level ?? ''}%` : 'Off'}`

  if (!expanded && !widgetExpanded) {
    return (
      <section className="environment-control widget compact-strip" aria-label="Environment controls">
        <button type="button" className="environment-open" onClick={openFull} aria-label="Open full Environment controls" disabled={!onOpen}>
          <span className="environment-heading-icon"><Lightbulb /></span>
          <span><strong>Environment</strong><small>{loading ? 'Connecting…' : error ? 'Unavailable' : device?.name || 'Room Light'}</small></span>
        </button>

        {device ? <>
          <label className="environment-strip-select environment-color-select" title="Scroll to change color; click to choose">
            <i style={{ '--environment-swatch': values.channel?.swatch }} />
            <span className="sr-only">Light color</span>
            <select value={values.channel?.id || ''} disabled={Boolean(action)} onWheel={(event) => handleWheel(event, cycleChannel)} onChange={(event) => setChannel(device.capabilities.channels.find((channel) => channel.id === event.target.value))} aria-label="Room light color">
              {device.capabilities.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
            </select>
          </label>
          <label className="environment-strip-select environment-level-select" title="Scroll to change intensity; click to choose">
            <span className="sr-only">Intensity</span>
            <select value={values.level ?? ''} disabled={!values.channel || Boolean(action)} onWheel={(event) => handleWheel(event, cycleLevel)} onChange={(event) => setLevel(Number(event.target.value))} aria-label="Room light intensity">
              {(values.channel?.levels || []).map((level) => <option key={level} value={level}>{level}%</option>)}
            </select>
          </label>
          <button type="button" className={`environment-power ${isOn ? 'on' : ''}`} role="switch" aria-checked={isOn} aria-label={`Turn room light ${isOn ? 'off' : 'on'}`} disabled={Boolean(action)} onClick={setPower}><Power /><span>{isOn ? 'On' : 'Off'}</span></button>
        </> : <button type="button" className="environment-strip-retry" onClick={() => void refresh()} disabled={loading} aria-label="Retry environment connection"><RotateCw className={loading ? 'spin' : ''} /></button>}

        <button type="button" className="environment-expand" onClick={() => setWidgetExpanded(true)} aria-label="Expand Environment widget"><ChevronDown /></button>
      </section>
    )
  }

  if (!expanded) {
    return (
      <section className="environment-control widget rail-expanded" aria-label="Environment controls">
        <header>
          <button type="button" className="environment-heading environment-heading-button" onClick={openFull} aria-label="Open full Environment controls"><span className="environment-heading-icon"><Lightbulb /></span><span><strong>Environment</strong><small>{status}</small></span></button>
          <div className="environment-header-actions"><button type="button" className={`environment-power ${isOn ? 'on' : ''}`} role="switch" aria-checked={isOn} aria-label={`Turn room light ${isOn ? 'off' : 'on'}`} disabled={!device || Boolean(action)} onClick={setPower}><Power /><span>{isOn ? 'On' : 'Off'}</span></button><button type="button" className="environment-expand" onClick={() => setWidgetExpanded(false)} aria-label="Collapse Environment widget"><ChevronUp /></button></div>
        </header>

        {!device && <button type="button" className="environment-retry" onClick={() => void refresh()} disabled={loading}><RotateCw className={loading ? 'spin' : ''} /><span>{error || 'Discovering light capabilities'}</span></button>}

        {device && <>
          <div className="environment-channel-list" role="group" aria-label="Light color">
            {device.capabilities.channels.map((channel) => <button key={channel.id} type="button" className={values.channel?.id === channel.id ? 'active' : ''} aria-pressed={values.channel?.id === channel.id} disabled={Boolean(action)} onClick={() => setChannel(channel)} title={`${channel.name}: ${channel.levels.join(', ')}%`}><i style={{ '--environment-swatch': channel.swatch }} /><span>{channel.name}</span></button>)}
          </div>
          <EnvironmentIntensitySlider channel={values.channel} level={values.level} disabled={!values.channel || Boolean(action)} onPreview={previewLevel} onCommit={setLevel} />
        </>}

        {error && device && <button type="button" className="environment-inline-error" onClick={() => void refresh()}><RotateCw /> {error}</button>}
      </section>
    )
  }

  return (
    <section className="environment-control expanded" aria-label="Environment controls">
      <header>
        <div className="environment-heading"><span className="environment-heading-icon"><Lightbulb /></span><span><strong>Environment</strong><small>{status}</small></span></div>
        <div className="environment-header-actions"><button type="button" className={`environment-power ${isOn ? 'on' : ''}`} role="switch" aria-checked={isOn} aria-label={`Turn room light ${isOn ? 'off' : 'on'}`} disabled={!device || Boolean(action)} onClick={setPower}><Power /><span>{isOn ? 'On' : 'Off'}</span></button><button type="button" className="environment-close" onClick={onClose} aria-label="Close environment controls"><X /></button></div>
      </header>

      {!device && <button type="button" className="environment-retry" onClick={() => void refresh()} disabled={loading}><RotateCw className={loading ? 'spin' : ''} /><span>{error || 'Discovering light capabilities'}</span></button>}

      {device && <>
        <div className="environment-channel-list" role="group" aria-label="Light color">
          {device.capabilities.channels.map((channel) => <button key={channel.id} type="button" className={values.channel?.id === channel.id ? 'active' : ''} aria-pressed={values.channel?.id === channel.id} disabled={Boolean(action)} onClick={() => setChannel(channel)} title={`${channel.name}: ${channel.levels.join(', ')}%`}><i style={{ '--environment-swatch': channel.swatch }} /><span>{channel.name}</span></button>)}
        </div>
        <EnvironmentIntensitySlider channel={values.channel} level={values.level} disabled={!values.channel || Boolean(action)} onPreview={previewLevel} onCommit={setLevel} />
      </>}

      {error && device && <button type="button" className="environment-inline-error" onClick={() => void refresh()}><RotateCw /> {error}</button>}
    </section>
  )
}
