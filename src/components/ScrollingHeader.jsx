export function ScrollingHeader({ workspace, direction, onNext, onPrevious }) {
  const text = Array.from({ length: 8 }, () => workspace?.name || 'V START 2').join('   ')
  return (
    <button
      className={`scrolling-header direction-${direction}`}
      type="button"
      onClick={(event) => event.shiftKey ? onPrevious() : onNext()}
      aria-label={`${workspace?.name || 'Workspace'}; click for next workspace, shift-click for previous`}
    >
      <span>{text}</span>
      <span aria-hidden="true">{text}</span>
    </button>
  )
}
