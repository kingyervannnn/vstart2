/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { linkifiedParts } from '../lib/linkify.js'
import { LinkifiedText } from './LinkifiedText.jsx'

describe('LinkifiedText', () => {
  it('recognizes plain and Markdown HTTP links without swallowing punctuation', () => {
    expect(linkifiedParts('See https://example.com/docs. Or [Help](https://example.com/help).')).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'link', value: 'https://example.com/docs', url: 'https://example.com/docs' },
      { type: 'text', value: '. Or ' },
      { type: 'link', value: 'Help', url: 'https://example.com/help' },
      { type: 'text', value: '.' },
    ])
  })

  it('keeps the main link native and exposes a separate inline action', () => {
    const onOpenInline = vi.fn()
    render(<p><LinkifiedText text="Open https://example.com" openInNewTab onOpenInline={onOpenInline} /></p>)

    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByRole('link')).toHaveAttribute('target', '_blank')
    fireEvent.click(screen.getByRole('button', { name: 'Open https://example.com inline' }))
    expect(onOpenInline).toHaveBeenCalledWith({ url: 'https://example.com', title: 'https://example.com' })
  })
})
