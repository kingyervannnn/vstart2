/* eslint-disable react-refresh/only-export-components -- shared icon registry, not a render module */
import { AppWindow, BriefcaseBusiness, Globe2, Grid2X2, Home, Layers3, List, Music2, Star } from 'lucide-react'

export const WORKSPACE_ICON_OPTIONS = Object.freeze([
  { value: 'Home', label: 'Home', Icon: Home },
  { value: 'Layers', label: 'Layers', Icon: Layers3 },
  { value: 'Grid2X2', label: 'Grid', Icon: Grid2X2 },
  { value: 'AppWindow', label: 'Window', Icon: AppWindow },
  { value: 'LayoutList', label: 'List', Icon: List },
  { value: 'Briefcase', label: 'Work', Icon: BriefcaseBusiness },
  { value: 'Music', label: 'Music', Icon: Music2 },
  { value: 'Globe', label: 'Globe', Icon: Globe2 },
  { value: 'Star', label: 'Star', Icon: Star },
])

const ICON_LOOKUP = new Map(WORKSPACE_ICON_OPTIONS.flatMap((option) => [
  [option.value.toLowerCase(), option.Icon],
  [option.label.toLowerCase(), option.Icon],
]))

export function getWorkspaceIcon(value) {
  return ICON_LOOKUP.get(String(value || '').toLowerCase()) || Layers3
}
