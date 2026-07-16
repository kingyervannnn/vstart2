/* global chrome */
const loading = document.querySelector('#loading')
const errorPanel = document.querySelector('#error')
const errorMessage = document.querySelector('#error-message')
const form = document.querySelector('#capture-form')
const titleInput = document.querySelector('#title')
const workspaceSelect = document.querySelector('#workspace')
const detectionNote = document.querySelector('#detection-note')
const pinOption = document.querySelector('#pin-option')
const pinInput = document.querySelector('#pin-across')
const pinLabel = document.querySelector('#pin-label')
const submit = document.querySelector('#submit')
const status = document.querySelector('#status')
const favicon = document.querySelector('#favicon')
const faviconFallback = document.querySelector('#favicon-fallback')
const pageHost = document.querySelector('#page-host')
const pageUrl = document.querySelector('#page-url')
let context = null

const SOURCE_LABELS = {
  vivaldi: 'Detected from the current Vivaldi workspace.',
  'vstart-tab': 'Detected from the open V Start workspace.',
  'vstart-state': 'Using the last active V Start workspace.',
  'first-workspace': 'Select a workspace before adding.',
}

function showError(message) {
  loading.hidden = true
  form.hidden = true
  errorPanel.hidden = false
  errorMessage.textContent = message
}

function setStatus(message, isError = false) {
  status.textContent = message
  status.classList.toggle('error', isError)
}

async function send(message) {
  const result = await chrome.runtime.sendMessage(message)
  if (!result?.ok) throw new Error(result?.error || 'The extension could not reach V Start.')
  return result
}

function render(nextContext) {
  context = nextContext
  const page = nextContext.page
  const parsed = new URL(page.url)
  titleInput.value = page.title
  pageHost.textContent = parsed.hostname.replace(/^www\./, '')
  pageUrl.textContent = page.url
  workspaceSelect.replaceChildren(...nextContext.workspaces.map((workspace) => {
    const option = document.createElement('option')
    option.value = workspace.id
    option.textContent = workspace.name
    return option
  }))
  workspaceSelect.value = nextContext.selectedWorkspaceId || nextContext.workspaces[0]?.id || ''
  detectionNote.textContent = SOURCE_LABELS[nextContext.detectionSource] || 'Choose the destination workspace.'

  const canPin = nextContext.workspaces.length > 1
  pinInput.disabled = !canPin
  pinOption.classList.toggle('disabled', !canPin)
  pinLabel.textContent = nextContext.workspaces.length === 2 ? 'Pin to both workspaces' : 'Pin across all workspaces'

  if (page.faviconUrl) {
    favicon.src = page.faviconUrl
    favicon.hidden = false
    faviconFallback.hidden = true
  }
  loading.hidden = true
  errorPanel.hidden = true
  form.hidden = false
  titleInput.focus()
  titleInput.select()
}

async function load() {
  loading.hidden = false
  errorPanel.hidden = true
  form.hidden = true
  try {
    render(await send({ type: 'vstartMultitool.capture.context' }))
  } catch (error) {
    showError(error.message)
  }
}

favicon.addEventListener('error', () => {
  favicon.hidden = true
  faviconFallback.hidden = false
})

workspaceSelect.addEventListener('change', () => {
  detectionNote.textContent = 'Selected manually.'
})

document.querySelector('#retry').addEventListener('click', load)

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  submit.disabled = true
  setStatus('Adding…')
  try {
    const result = await send({
      type: 'vstartMultitool.capture.add',
      title: titleInput.value,
      url: context.page.url,
      workspaceId: workspaceSelect.value,
      pinAcross: pinInput.checked,
    })
    const destination = result.pinned ? 'all workspaces' : result.workspaceName
    setStatus(result.alreadyExists
      ? `${result.title} is already available in ${destination}.`
      : `${result.title} added to ${destination}.`)
    submit.textContent = result.alreadyExists ? 'Already added' : 'Added'
    setTimeout(() => window.close(), 850)
  } catch (error) {
    setStatus(error.message, true)
    submit.disabled = false
  }
})

void load()
