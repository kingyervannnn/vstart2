// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceSwitcher } from '../src/components/WorkspaceSwitcher.jsx'

afterEach(cleanup)

describe('workspace switcher confirmation', () => {
  it('marks the selected workspace pending and confirms it when clicked', () => {
    const home = { id: 'home', name: 'Home', icon: 'layers' }
    const onSelect = vi.fn()
    const { container } = render(<WorkspaceSwitcher
      workspaces={[home, { id: 'work', name: 'Work', icon: 'briefcase' }]}
      activeId="home"
      confirmationPending
      onSelect={onSelect}
      compact={false}
      editMode={false}
      onContextMenu={vi.fn()}
    />)

    expect(container.querySelector('.workspace-switcher.confirmation-pending')).toBeTruthy()
    const pending = screen.getByRole('button', { name: 'Home, confirm workspace' })
    expect(pending.classList.contains('pending-confirmation')).toBe(true)
    fireEvent.click(pending)
    expect(onSelect).toHaveBeenCalledWith(home)
  })
})
