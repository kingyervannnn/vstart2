function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)))
}

export function folderPopoverPosition(anchor, viewport, popover, gap = 16, padding = 22) {
  const centeredLeft = anchor.left + anchor.width / 2 - popover.width / 2
  const rightLeft = anchor.right + gap
  const leftLeft = anchor.left - gap - popover.width
  const fitsRight = rightLeft + popover.width <= viewport.width - padding
  const fitsLeft = leftLeft >= padding
  const left = fitsRight ? rightLeft : fitsLeft ? leftLeft : centeredLeft
  const centeredTop = anchor.top + anchor.height / 2 - popover.height / 2

  return {
    left: Math.round(clamp(left, padding, viewport.width - popover.width - padding)),
    top: Math.round(clamp(centeredTop, padding, viewport.height - popover.height - padding)),
  }
}
