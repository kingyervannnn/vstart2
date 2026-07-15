import { PanelRightOpen } from 'lucide-react'
import { linkifiedParts } from '../lib/linkify.js'

export function LinkifiedText({ text, openInNewTab = false, onOpenInline }) {
  return linkifiedParts(text).map((part, index) => part.type === 'text'
    ? <span key={`text:${index}`}>{part.value}</span>
    : <span className="embedded-link" key={`${part.url}:${index}`}>
      <a href={part.url} target={openInNewTab ? '_blank' : undefined} rel={openInNewTab ? 'noreferrer' : undefined}>{part.value}</a>
      {onOpenInline && <button type="button" className="embedded-link-inline" onClick={() => onOpenInline({ url: part.url, title: part.value })} aria-label={`Open ${part.value} inline`} title="Open inline"><PanelRightOpen /></button>}
    </span>)
}
