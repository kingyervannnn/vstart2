export function ScrollingHeader({ workspace, direction, onNext, onPrevious }) {
  const text = workspace?.name || 'V START 2'
  const segments = Array.from({ length: 14 }, (_, index) => <span key={index}>{text}</span>)
  return (
    <button
      className={`scrolling-header direction-${direction}`}
      type="button"
      onClick={(event) => event.shiftKey ? onPrevious() : onNext()}
      aria-label={`${workspace?.name || 'Workspace'}; click for next workspace, shift-click for previous`}
    >
      <span className="scrolling-header-track" key={`${workspace?.id || 'default'}:${direction}`} aria-hidden="true">
        <span className="scrolling-header-group">{segments}</span>
        <span className="scrolling-header-group">{segments}</span>
      </span>
    </button>
  )
}
