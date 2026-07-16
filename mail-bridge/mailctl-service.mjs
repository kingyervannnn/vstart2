import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const DEFAULT_MAILCTL_PATH = '/Users/vbitzx/SS/TOOLS/bin/mailctl'
const CONTACT_CACHE_MS = 5 * 60 * 1000

function mailboxParts(value) {
  const parts = []
  let start = 0
  let quoted = false
  let angleDepth = 0
  const input = String(value || '')
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (character === '"' && input[index - 1] !== '\\') quoted = !quoted
    else if (!quoted && character === '<') angleDepth += 1
    else if (!quoted && character === '>') angleDepth = Math.max(0, angleDepth - 1)
    else if (!quoted && angleDepth === 0 && [',', ';'].includes(character)) {
      parts.push(input.slice(start, index))
      start = index + 1
    }
  }
  parts.push(input.slice(start))
  return parts
}

function parseMailbox(value) {
  const bracketed = String(value || '').trim().match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/)
  const email = bracketed?.[2] || String(value || '').match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0]
  if (!email) return null
  const rawName = bracketed?.[1]?.trim().replace(/^"|"$/g, '') || ''
  return { email: email.toLowerCase(), name: rawName && !rawName.includes('@') ? rawName : '' }
}

function mailboxes(value) {
  return mailboxParts(value).map(parseMailbox).filter(Boolean)
}

export class MailBridgeError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class MailctlService {
  constructor({
    mailctlPath = process.env.VSTART_MAILCTL_PATH || DEFAULT_MAILCTL_PATH,
    run = execFile,
  } = {}) {
    this.mailctlPath = mailctlPath
    this.run = run
    this.accountCache = null
    this.contactCache = new Map()
  }

  async health() {
    try {
      const accounts = await this.accounts({ refresh: true })
      return { status: 'ok', service: 'mailctl', capabilities: ['search', 'read', 'contacts', 'draft', 'reply', 'forward', 'attach', 'send', 'trash', 'star'], accountCount: accounts.length }
    } catch {
      return { status: 'unavailable', service: 'mailctl', capabilities: [], accountCount: 0 }
    }
  }

  async accounts({ refresh = false } = {}) {
    if (this.accountCache && !refresh) return this.accountCache
    const result = await this.#json(['accounts', 'list', '--json'])
    if (!Array.isArray(result)) throw new MailBridgeError(502, 'mailctl_invalid_response', 'mailctl returned an invalid account list')
    this.accountCache = result.map((account) => ({
      alias: String(account.alias || ''),
      email: String(account.email || ''),
      scopePreset: String(account.scopePreset || ''),
    })).filter((account) => account.alias)
    return this.accountCache
  }

  async messages({ account = 'all', query = 'in:inbox', max = 20 } = {}) {
    const accounts = await this.#resolveAccounts(account)
    const safeQuery = String(query || 'in:inbox').trim().slice(0, 500) || 'in:inbox'
    const safeMax = Math.max(1, Math.min(Number(max) || 20, 50))
    const perAccount = account === 'all' ? Math.max(1, Math.ceil(safeMax / accounts.length)) : safeMax
    const batches = await Promise.all(accounts.map(async ({ alias }) => {
      const result = await this.#json(['search', '--account', alias, '--query', safeQuery, '--max', String(perAccount), '--json'])
      return (Array.isArray(result.messages) ? result.messages : []).map((message) => this.#normalizeMessage(alias, message))
    }))
    return batches.flat()
      .sort((left, right) => this.#timestamp(right.date) - this.#timestamp(left.date))
      .slice(0, safeMax)
  }

  async message(account, id) {
    const [{ alias }] = await this.#resolveAccounts(account)
    const safeId = String(id || '')
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(safeId)) throw new MailBridgeError(400, 'message_id_invalid', 'Message id is invalid')
    const result = await this.#json(['read', '--account', alias, '--id', safeId, '--json'])
    return this.#normalizeMessage(alias, result, { includeBody: true })
  }

  async contacts({ account, query = '', max = 12, refresh = false } = {}) {
    const [{ alias }] = await this.#resolveAccounts(account)
    const accounts = await this.accounts()
    const ownAddresses = new Set(accounts.map((candidate) => candidate.email.toLowerCase()).filter(Boolean))
    let cached = this.contactCache.get(alias)
    if (refresh || !cached || Date.now() - cached.updatedAt > CONTACT_CACHE_MS) {
      const [inbox, sent] = await Promise.all([
        this.messages({ account: alias, query: 'in:inbox', max: 50 }),
        this.messages({ account: alias, query: 'in:sent', max: 50 }),
      ])
      const candidates = new Map()
      const remember = (mailbox, source, date) => {
        if (!mailbox || ownAddresses.has(mailbox.email)) return
        const current = candidates.get(mailbox.email) || { email: mailbox.email, name: '', inboxCount: 0, sentCount: 0, lastSeen: '' }
        if (mailbox.name && mailbox.name.length > current.name.length) current.name = mailbox.name
        current[`${source}Count`] += 1
        if (this.#timestamp(date) > this.#timestamp(current.lastSeen)) current.lastSeen = date
        candidates.set(mailbox.email, current)
      }
      for (const message of inbox) for (const mailbox of mailboxes(message.from)) remember(mailbox, 'inbox', message.date)
      for (const message of sent) for (const mailbox of mailboxes(message.to)) remember(mailbox, 'sent', message.date)
      cached = {
        updatedAt: Date.now(),
        contacts: [...candidates.values()].sort((left, right) =>
          right.sentCount - left.sentCount
          || (right.sentCount + right.inboxCount) - (left.sentCount + left.inboxCount)
          || this.#timestamp(right.lastSeen) - this.#timestamp(left.lastSeen)),
      }
      this.contactCache.set(alias, cached)
    }
    const safeQuery = String(query || '').trim().toLowerCase().slice(0, 200)
    const safeMax = Math.max(1, Math.min(Number(max) || 12, 100))
    const matches = safeQuery
      ? cached.contacts.filter((contact) => contact.email.includes(safeQuery) || contact.name.toLowerCase().includes(safeQuery))
      : cached.contacts
    return matches.slice(0, safeMax).map(({ email, name }) => ({ email, name }))
  }

  async drafts({ account, max = 20 }) {
    const [{ alias }] = await this.#resolveAccounts(account)
    const safeMax = Math.max(1, Math.min(Number(max) || 20, 50))
    const result = await this.#json(['drafts', 'list', '--account', alias, '--max', String(safeMax), '--json'])
    if (!Array.isArray(result)) throw new MailBridgeError(502, 'mailctl_invalid_response', 'mailctl returned an invalid draft list')
    return result.map((draft) => ({ account: alias, ...draft }))
  }

  async createDraft({ account, to = '', cc = '', bcc = '', subject = '', body, replyTo = '', attachments = [] }) {
    const [{ alias }] = await this.#resolveAccounts(account)
    if (!String(body || '').trim()) throw new MailBridgeError(400, 'draft_body_missing', 'Message body is required')
    if (!replyTo && (!String(to).trim() || !String(subject).trim())) {
      throw new MailBridgeError(400, 'draft_fields_missing', 'Recipient and subject are required')
    }
    if (attachments.length > 10) throw new MailBridgeError(400, 'attachments_too_many', 'A maximum of 10 attachments is allowed')

    const workDir = await mkdtemp(join(tmpdir(), 'vstart-mail-'))
    try {
      const bodyPath = join(workDir, 'body.txt')
      await writeFile(bodyPath, String(body), { encoding: 'utf8', mode: 0o600 })
      const args = ['draft', '--account', alias, '--body-file', bodyPath]
      if (replyTo) args.push('--reply-to', this.#safeId(replyTo, 'Reply message id'))
      else args.push('--to', String(to).trim().slice(0, 2_000), '--subject', String(subject).trim().slice(0, 998))
      if (cc) args.push('--cc', String(cc).trim().slice(0, 2_000))
      if (bcc) args.push('--bcc', String(bcc).trim().slice(0, 2_000))

      let totalBytes = 0
      for (let index = 0; index < attachments.length; index += 1) {
        const attachment = attachments[index]
        const data = Buffer.from(String(attachment.data || ''), 'base64')
        totalBytes += data.length
        if (totalBytes > 18 * 1_024 * 1_024) throw new MailBridgeError(400, 'attachments_too_large', 'Attachments may not exceed 18 MiB combined')
        const name = basename(String(attachment.name || `attachment-${index + 1}`)).replaceAll(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 180)
        const filePath = join(workDir, `${index}-${name || `attachment-${index + 1}`}`)
        await writeFile(filePath, data, { mode: 0o600 })
        args.push('--attach', filePath)
      }
      return await this.#json(args)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  }

  async sendDraft({ account, draftId, confirmSend }) {
    if (confirmSend !== true) throw new MailBridgeError(400, 'send_confirmation_required', 'Explicit send confirmation is required')
    const [{ alias }] = await this.#resolveAccounts(account)
    return this.#json(['send-draft', '--account', alias, '--draft-id', this.#safeId(draftId, 'Draft id'), '--yes'])
  }

  async trashMessage({ account, messageId, confirmTrash }) {
    if (confirmTrash !== true) throw new MailBridgeError(400, 'trash_confirmation_required', 'Explicit trash confirmation is required')
    const [{ alias }] = await this.#resolveAccounts(account)
    return this.#json(['trash', '--account', alias, '--id', this.#safeId(messageId, 'Message id'), '--yes'])
  }

  async starMessage({ account, messageId, starred }) {
    if (typeof starred !== 'boolean') throw new MailBridgeError(400, 'star_state_invalid', 'Favorite state must be true or false')
    const [{ alias }] = await this.#resolveAccounts(account)
    const result = await this.#json([starred ? 'star' : 'unstar', '--account', alias, '--id', this.#safeId(messageId, 'Message id'), '--yes'])
    return { account: alias, ...(result.message || {}), starred }
  }

  async #resolveAccounts(requested) {
    const accounts = await this.accounts()
    if (!accounts.length) throw new MailBridgeError(503, 'mail_accounts_missing', 'No mailctl accounts are configured')
    if (requested === 'all') return accounts
    const match = accounts.find((account) => account.alias === requested)
    if (!match) throw new MailBridgeError(400, 'mail_account_invalid', 'Mail account is not configured')
    return [match]
  }

  #normalizeMessage(account, message, { includeBody = false } = {}) {
    const labelIds = Array.isArray(message.labelIds) ? message.labelIds.map(String) : []
    const normalized = {
      account,
      id: String(message.id || ''),
      threadId: String(message.threadId || ''),
      date: String(message.date || ''),
      from: String(message.from || ''),
      to: String(message.to || ''),
      subject: String(message.subject || '(no subject)'),
      snippet: String(message.snippet || ''),
      labelIds,
      starred: message.starred === true || labelIds.includes('STARRED'),
    }
    if (includeBody) normalized.body = String(message.body || '')
    return normalized
  }

  #timestamp(value) {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : 0
  }

  #safeId(value, label) {
    const id = String(value || '')
    if (!/^[a-zA-Z0-9_-]{1,300}$/.test(id)) throw new MailBridgeError(400, 'mail_id_invalid', `${label} is invalid`)
    return id
  }

  async #json(args) {
    try {
      const { stdout } = await this.run(this.mailctlPath, args, {
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 8 * 1_024 * 1_024,
      })
      return JSON.parse(stdout)
    } catch (error) {
      if (error instanceof MailBridgeError) throw error
      throw new MailBridgeError(502, 'mailctl_failed', 'The local mail service could not complete the request')
    }
  }
}
