import { useEffect, useState } from 'react'
import { ArrowLeft, CloudSun, FileText, ListMusic, Mail, Music2, NotebookPen, Paperclip, PenLine, RefreshCw, Search, Send, X } from 'lucide-react'
import { mailBridge } from '../lib/mailBridge.js'

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7'

const SERVICE_META = {
  notes: { label: 'Notes', Icon: NotebookPen },
  mail: { label: 'Mail', Icon: Mail },
  weather: { label: 'Weather', Icon: CloudSun },
  music: { label: 'Music', Icon: Music2 },
}

function MusicServiceView() {
  const [query, setQuery] = useState('')
  return (
    <div className="music-service-view">
      <label className="music-search-field"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search music when a provider is connected" /></label>
      <section><h3><ListMusic /> Queue</h3><div className="service-state">The queue is ready for a music provider. Playback data will appear here once an API is connected.</div></section>
      <section><h3><Search /> Search</h3><div className="service-state">{query ? `No provider is connected to search for “${query}” yet.` : 'Enter a title, artist, album, or playlist.'}</div></section>
    </div>
  )
}

function WeatherServiceView({ data }) {
  const current = data.current
  const days = (data.daily?.time || []).map((date, index) => ({
    date,
    high: data.daily.temperature_2m_max[index],
    low: data.daily.temperature_2m_min[index],
    sunrise: data.daily.sunrise[index],
    sunset: data.daily.sunset[index],
  }))
  return (
    <div className="weather-service-view">
      <section className="weather-detail-current"><CloudSun /><div><small>NEW YORK · FEELS LIKE {Math.round(current.apparent_temperature)}°</small><strong>{Math.round(current.temperature_2m)}°F</strong><p>{Math.round(current.relative_humidity_2m)}% humidity · {Math.round(current.wind_speed_10m)} mph wind</p></div></section>
      <div className="weather-detail-days">
        {days.map((day, index) => <article key={day.date}><span><small>{index === 0 ? 'Today' : new Intl.DateTimeFormat([], { weekday: 'long' }).format(new Date(`${day.date}T12:00:00`))}</small><strong>{new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' }).format(new Date(`${day.date}T12:00:00`))}</strong></span><span className="weather-high-low"><strong>{Math.round(day.high)}°</strong><small>{Math.round(day.low)}°</small></span><span className="weather-sun"><small>Sunrise {new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(day.sunrise))}</small><small>Sunset {new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(day.sunset))}</small></span></article>)}
      </div>
    </div>
  )
}

function formatMailDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat([], sameYear
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

function fileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.onload = () => resolve({ name: file.name, type: file.type, data: String(reader.result).split(',')[1] || '' })
    reader.readAsDataURL(file)
  })
}

function MailComposer({ accounts, initial, onCancel, onCreated }) {
  const [draft, setDraft] = useState(() => ({
    account: initial?.account || accounts[0]?.alias || '',
    to: initial?.replyTo ? '' : (initial?.to || ''),
    cc: '',
    bcc: '',
    subject: initial?.replyTo ? '' : (initial?.subject || ''),
    body: '',
    replyTo: initial?.replyTo || '',
    attachments: [],
  }))
  const [files, setFiles] = useState([])
  const [state, setState] = useState({ working: false, error: '' })

  const submit = async (event, sendAfter) => {
    event.preventDefault()
    setState({ working: true, error: '' })
    try {
      const attachments = await Promise.all(files.map(fileAsAttachment))
      const result = await mailBridge.createDraft({ ...draft, attachments })
      onCreated({ account: draft.account, draft: result.draft, sendAfter, summary: { to: draft.to || initial?.from, subject: draft.subject || initial?.subject } })
    } catch (error) {
      setState({ working: false, error: error.message })
    }
  }

  return (
    <form className="mail-composer" onSubmit={(event) => submit(event, false)}>
      <header><button type="button" className="mail-back" onClick={onCancel}><ArrowLeft /> Inbox</button><span>{draft.replyTo ? 'Reply' : 'New message'}</span></header>
      <label><span>From</span><select value={draft.account} onChange={(event) => setDraft((value) => ({ ...value, account: event.target.value }))}>{accounts.map((item) => <option key={item.alias} value={item.alias}>{item.alias} · {item.email}</option>)}</select></label>
      {!draft.replyTo && <label><span>To</span><input required value={draft.to} onChange={(event) => setDraft((value) => ({ ...value, to: event.target.value }))} /></label>}
      {!draft.replyTo && <label><span>Cc</span><input value={draft.cc} onChange={(event) => setDraft((value) => ({ ...value, cc: event.target.value }))} /></label>}
      {!draft.replyTo && <label><span>Bcc</span><input value={draft.bcc} onChange={(event) => setDraft((value) => ({ ...value, bcc: event.target.value }))} /></label>}
      {!draft.replyTo && <label><span>Subject</span><input required value={draft.subject} onChange={(event) => setDraft((value) => ({ ...value, subject: event.target.value }))} /></label>}
      {draft.replyTo && <div className="mail-reply-context"><strong>{initial.subject}</strong><small>Replying to {initial.from}</small></div>}
      <textarea required autoFocus placeholder="Write a message…" value={draft.body} onChange={(event) => setDraft((value) => ({ ...value, body: event.target.value }))} />
      {!!files.length && <div className="mail-attachment-list">{files.map((file) => <span key={`${file.name}:${file.size}`}>{file.name}<small>{Math.ceil(file.size / 1024)} KB</small></span>)}</div>}
      {state.error && <div className="service-state error">{state.error}</div>}
      <footer>
        <label className="mail-attach"><Paperclip /> Attach<input type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 10))} /></label>
        <span />
        <button type="submit" disabled={state.working}><FileText /> Save draft</button>
        <button type="button" className="primary" disabled={state.working} onClick={(event) => submit(event, true)}><Send /> Review & send</button>
      </footer>
    </form>
  )
}

function MailServiceView() {
  const [accounts, setAccounts] = useState([])
  const [account, setAccount] = useState('all')
  const [queryInput, setQueryInput] = useState('in:inbox')
  const [query, setQuery] = useState('in:inbox')
  const [messages, setMessages] = useState([])
  const [selected, setSelected] = useState(null)
  const [compose, setCompose] = useState(null)
  const [drafts, setDrafts] = useState(null)
  const [pendingSend, setPendingSend] = useState(null)
  const [notice, setNotice] = useState('')
  const [state, setState] = useState({ loading: true, error: '' })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true, error: '' })
    Promise.all([
      mailBridge.accounts({ signal: controller.signal }),
      mailBridge.messages({ account, query, max: 30, signal: controller.signal }),
    ]).then(([accountData, messageData]) => {
      setAccounts(accountData.accounts || [])
      setMessages(messageData.messages || [])
      setState({ loading: false, error: '' })
    }).catch((error) => {
      if (error.name !== 'AbortError') setState({ loading: false, error: error.message })
    })
    return () => controller.abort()
  }, [account, query, refreshKey])

  const openMessage = async (message) => {
    setSelected({ ...message, loading: true })
    try {
      const result = await mailBridge.message(message.account, message.id)
      setSelected(result.message)
    } catch (error) {
      setSelected({ ...message, error: error.message })
    }
  }

  const submitSearch = (event) => {
    event.preventDefault()
    setSelected(null)
    setQuery(queryInput.trim() || 'in:inbox')
  }

  const openDrafts = async () => {
    const target = account === 'all' ? accounts[0]?.alias : account
    if (!target) return
    setState({ loading: true, error: '' })
    try {
      const result = await mailBridge.drafts(target)
      setDrafts({ account: target, items: result.drafts || [] })
      setState({ loading: false, error: '' })
    } catch (error) {
      setState({ loading: false, error: error.message })
    }
  }

  const finishDraft = ({ account: draftAccount, draft, sendAfter, summary }) => {
    setCompose(null)
    if (sendAfter) setPendingSend({ account: draftAccount, draftId: draft.draftId, summary })
    else {
      setNotice('Draft saved to Gmail.')
      setRefreshKey((value) => value + 1)
    }
  }

  const sendPendingDraft = async () => {
    setState({ loading: true, error: '' })
    try {
      await mailBridge.sendDraft(pendingSend.account, pendingSend.draftId)
      setPendingSend(null)
      setNotice('Message sent.')
      setState({ loading: false, error: '' })
      setRefreshKey((value) => value + 1)
    } catch (error) {
      setState({ loading: false, error: error.message })
    }
  }

  if (compose) return <MailComposer accounts={accounts} initial={compose} onCancel={() => setCompose(null)} onCreated={finishDraft} />

  if (pendingSend) {
    return (
      <div className="mail-send-confirm">
        <Send />
        <small>READY TO SEND</small>
        <h3>{pendingSend.summary.subject || 'Reply'}</h3>
        <p>Send this message from <strong>{pendingSend.account}</strong> to <strong>{pendingSend.summary.to}</strong>?</p>
        {state.error && <div className="service-state error">{state.error}</div>}
        <div><button type="button" onClick={() => setPendingSend(null)}>Keep as draft</button><button type="button" className="primary" onClick={sendPendingDraft} disabled={state.loading}>Send now</button></div>
      </div>
    )
  }

  if (drafts) {
    return (
      <div className="mail-drafts-view">
        <header><button type="button" className="mail-back" onClick={() => setDrafts(null)}><ArrowLeft /> Inbox</button><span>Drafts · {drafts.account}</span></header>
        <div className="mail-message-list">
          {drafts.items.map((draft) => <button type="button" key={draft.draftId} onClick={() => setPendingSend({ account: drafts.account, draftId: draft.draftId, summary: { to: draft.to, subject: draft.subject } })}><span className="mail-message-meta"><span className="mail-account-badge">DRAFT</span><time>{formatMailDate(draft.date)}</time></span><strong>{draft.subject || '(no subject)'}</strong><small>{draft.to}</small><p>{draft.snippet}</p></button>)}
          {!drafts.items.length && <div className="service-state">No drafts in this account.</div>}
        </div>
      </div>
    )
  }

  if (selected) {
    return (
      <div className="mail-reader">
        <div className="mail-reader-actions"><button type="button" className="mail-back" onClick={() => setSelected(null)}><ArrowLeft /> Inbox</button><button type="button" onClick={() => setCompose({ account: selected.account, replyTo: selected.id, from: selected.from, subject: selected.subject })}><PenLine /> Reply</button></div>
        <article>
          <header><span className="mail-account-badge">{selected.account}</span><time>{formatMailDate(selected.date)}</time></header>
          <h3>{selected.subject}</h3>
          <dl><div><dt>From</dt><dd>{selected.from}</dd></div><div><dt>To</dt><dd>{selected.to}</dd></div></dl>
          {selected.loading && <div className="service-state">Opening message…</div>}
          {selected.error && <div className="service-state error">{selected.error}</div>}
          {!selected.loading && !selected.error && <div className="mail-body">{selected.body || selected.snippet || 'This message has no text body.'}</div>}
        </article>
      </div>
    )
  }

  return (
    <div className="mail-service-view">
      <div className="mail-toolbar">
        <div className="mail-account-tabs" aria-label="Mail account">
          <button type="button" className={account === 'all' ? 'active' : ''} onClick={() => setAccount('all')}>All</button>
          {accounts.map((item) => <button type="button" key={item.alias} className={account === item.alias ? 'active' : ''} title={item.email} onClick={() => setAccount(item.alias)}>{item.alias}</button>)}
        </div>
        <div className="mail-toolbar-actions"><button type="button" onClick={openDrafts}><FileText /> Drafts</button><button type="button" className="primary" onClick={() => setCompose({ account: account === 'all' ? accounts[0]?.alias : account })}><PenLine /> Compose</button><button type="button" className="mail-refresh" onClick={() => setRefreshKey((value) => value + 1)} aria-label="Refresh mail"><RefreshCw /></button></div>
      </div>
      <form className="mail-search" onSubmit={submitSearch}>
        <Search />
        <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Search mail (Gmail query syntax)" />
        <button type="submit">Search</button>
      </form>
      <p className="mail-safety-note">Local mailctl · draft-first sending with confirmation</p>
      {notice && <button type="button" className="mail-notice" onClick={() => setNotice('')}>{notice}</button>}
      {state.loading && <div className="service-state">Reading local mail…</div>}
      {state.error && <div className="service-state error"><strong>Mail bridge unavailable.</strong><br />{state.error}</div>}
      {!state.loading && !state.error && <div className="mail-message-list">
        {messages.map((message) => (
          <button type="button" key={`${message.account}:${message.id}`} onClick={() => openMessage(message)}>
            <span className="mail-message-meta"><span className="mail-account-badge">{message.account}</span><time>{formatMailDate(message.date)}</time></span>
            <strong>{message.subject}</strong>
            <small>{message.from}</small>
            <p>{message.snippet}</p>
          </button>
        ))}
        {!messages.length && <div className="service-state">No messages match this search.</div>}
      </div>}
    </div>
  )
}

export function ServiceRailView({ kind, onClose }) {
  const [state, setState] = useState({ loading: !['music', 'mail'].includes(kind), error: '', data: null })

  useEffect(() => {
    if (kind === 'music' || kind === 'mail') {
      setState({ loading: false, error: '', data: null })
      return undefined
    }
    const controller = new AbortController()
    setState({ loading: true, error: '', data: null })
    const request = kind === 'notes'
      ? fetch('/notes/api/v1/vault/default/notes', { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Notes service is unavailable')))
      : kind === 'weather'
        ? fetch(WEATHER_URL, { signal: controller.signal }).then((response) => response.ok ? response.json() : Promise.reject(new Error('Weather service is unavailable')))
        : Promise.reject(new Error('Unknown service'))
    request.then((data) => setState({ loading: false, error: '', data })).catch((error) => {
      if (error.name !== 'AbortError') setState({ loading: false, error: error.message, data: null })
    })
    return () => controller.abort()
  }, [kind])

  const meta = SERVICE_META[kind] || SERVICE_META.mail
  const Icon = meta.Icon
  return (
    <section className={`service-rail-view ${kind}-service`} aria-label={meta.label}>
      <header><div><Icon /><span><small>WIDGET VIEW</small><h2>{meta.label}</h2></span></div><button type="button" onClick={onClose} aria-label={`Close ${kind}`}><X /></button></header>
      {state.loading && <div className="service-state">Connecting to the V Start 2 service…</div>}
      {state.error && <div className="service-state error">{state.error}</div>}
      {!state.loading && !state.error && kind === 'notes' && <div className="notes-service-list">
        {(state.data.notes || []).map((note) => <article key={note.id}><NotebookPen /><div><strong>{note.title || note.id}</strong><p>{String(note.content || '').slice(0, 220) || 'Empty note'}</p></div></article>)}
        {!(state.data.notes || []).length && <div className="service-state">No notes found in the mounted vault.</div>}
      </div>}
      {kind === 'mail' && <MailServiceView />}
      {!state.loading && !state.error && kind === 'weather' && <WeatherServiceView data={state.data} />}
      {!state.loading && !state.error && kind === 'music' && <MusicServiceView />}
    </section>
  )
}
