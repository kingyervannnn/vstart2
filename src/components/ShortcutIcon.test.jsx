/* @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ShortcutIcon } from './FolderPopover.jsx'

describe('ShortcutIcon', () => {
  it('tries the explicit image URL before archived and discovered fallbacks', () => {
    const { container } = render(<ShortcutIcon item={{
      title: 'Example',
      iconOverrideUrl: 'https://images.example/custom.png',
      iconAssetId: 'asset-1',
      faviconUrl: 'https://example.com/favicon.ico',
    }} />)

    expect(container.querySelector('img')).toHaveAttribute('src', 'https://images.example/custom.png')
    fireEvent.error(container.querySelector('img'))
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/assets/asset-1')
    fireEvent.error(container.querySelector('img'))
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/favicon.ico')
  })
})
