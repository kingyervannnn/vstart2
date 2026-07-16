import { describe, expect, it } from 'vitest'

import { folderPopoverPosition } from './folderPopover.js'

describe('folderPopoverPosition', () => {
  const viewport = { width: 1600, height: 900 }
  const popover = { width: 680, height: 590 }

  it('opens beside a folder when the right side has room', () => {
    expect(folderPopoverPosition({ left: 480, right: 560, top: 260, width: 80, height: 80 }, viewport, popover)).toEqual({ left: 576, top: 22 })
  })

  it('opens to the left of a folder near the right edge', () => {
    expect(folderPopoverPosition({ left: 1420, right: 1500, top: 520, width: 80, height: 80 }, viewport, popover)).toEqual({ left: 724, top: 265 })
  })

  it('keeps the popover inside the viewport when neither side fits', () => {
    expect(folderPopoverPosition({ left: 500, right: 580, top: 10, width: 80, height: 80 }, { width: 1000, height: 700 }, popover)).toEqual({ left: 200, top: 22 })
  })
})
