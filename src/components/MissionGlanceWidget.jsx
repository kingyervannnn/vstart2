import { useEffect, useMemo, useState } from 'react'
import { GitBranch } from 'lucide-react'

import { isRecentCommit, missionGlanceApi, missionGlanceProjectName, normalizeMissionGlancePaths, relativeCommitTime, truncateCommitSubject } from '../lib/missionGlance.js'

const REFRESH_MS = 15_000

function unavailableProject(path) {
  return { path, name: missionGlanceProjectName(path), available: false }
}

function normalizedSnapshot(paths, body) {
  const byPath = new Map((Array.isArray(body?.projects) ? body.projects : []).map((project) => [project?.path, project]))
  return paths.map((path) => {
    const project = byPath.get(path)
    if (!project?.available) return unavailableProject(path)
    const committedAt = project.lastCommit?.committedAt
    if (typeof project.branch !== 'string' || !project.branch || !Number.isInteger(project.dirtyCount) || project.dirtyCount < 0 || !relativeCommitTime(committedAt)) {
      return unavailableProject(path)
    }
    return {
      path,
      name: typeof project.name === 'string' && project.name ? project.name : missionGlanceProjectName(path),
      available: true,
      branch: project.branch,
      dirtyCount: project.dirtyCount,
      lastCommit: {
        committedAt,
        subject: typeof project.lastCommit?.subject === 'string' ? project.lastCommit.subject : '',
      },
    }
  })
}

export function MissionGlanceWidget({ paths }) {
  const pathKey = JSON.stringify(normalizeMissionGlancePaths(paths))
  const projectPaths = useMemo(() => JSON.parse(pathKey), [pathKey])
  const [state, setState] = useState({ loading: true, projects: [] })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const refresh = async () => {
      try {
        const body = await missionGlanceApi.snapshot(projectPaths, controller.signal)
        if (active) setState({ loading: false, projects: normalizedSnapshot(projectPaths, body) })
      } catch (error) {
        if (active && error.name !== 'AbortError') setState({ loading: false, projects: projectPaths.map(unavailableProject) })
      }
    }
    setState({ loading: true, projects: [] })
    void refresh()
    const timer = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(timer)
    }
  }, [projectPaths])

  return (
    <section className="mission-glance-widget" aria-label="Mission Glance">
      <header><span><GitBranch /><strong>Mission Glance</strong></span><small>Read-only</small></header>
      {state.loading && <p className="mission-glance-state">Loading project status…</p>}
      {!state.loading && !state.projects.length && <p className="mission-glance-state">No projects configured</p>}
      {!state.loading && !!state.projects.length && <ul>
        {state.projects.map((project) => <li key={project.path} className={project.available ? '' : 'unavailable'}>
          <div className="mission-glance-project-heading"><strong title={project.name}>{project.name}</strong>{project.available && <span className={project.dirtyCount ? 'dirty' : 'clean'}>{project.dirtyCount ? `${project.dirtyCount} ${project.dirtyCount === 1 ? 'change' : 'changes'}` : 'clean'}</span>}</div>
          {!project.available && <p>unavailable</p>}
          {project.available && <>
            <div className="mission-glance-branch"><GitBranch /><span title={project.branch}>{project.branch}</span></div>
            <div className="mission-glance-commit">
              {isRecentCommit(project.lastCommit.committedAt) && <i aria-label="Committed in the last 24 hours" />}
              <time dateTime={project.lastCommit.committedAt}>{relativeCommitTime(project.lastCommit.committedAt)}</time>
              <span title={project.lastCommit.subject}>{truncateCommitSubject(project.lastCommit.subject) || 'No commit subject'}</span>
            </div>
          </>}
        </li>)}
      </ul>}
    </section>
  )
}
