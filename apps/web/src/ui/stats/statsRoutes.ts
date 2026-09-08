export type StatsSection =
  | 'overview'
  | 'users'
  | 'task-logs'
  | 'account'
  | 'homepage'
  | 'projects'
  | 'prompts'
  | 'agents'
  | 'knowledge'
  | 'skills'
  | 'teams'

const SECTION_PATHS: Readonly<Record<Exclude<StatsSection, 'overview'>, string>> = {
  users: '/stats/users',
  'task-logs': '/stats/task-logs',
  account: '/stats/account',
  homepage: '/stats/homepage',
  projects: '/stats/projects',
  prompts: '/stats/prompts',
  agents: '/stats/agents',
  knowledge: '/stats/knowledge',
  skills: '/stats/skills',
  teams: '/stats/teams',
}

const SECTION_BY_PATH: Readonly<Record<string, StatsSection>> = Object.fromEntries(
  Object.entries(SECTION_PATHS).map(([section, path]) => [path, section]),
)

export function parseStatsSectionFromPathname(pathname: string): StatsSection {
  const path = pathname.trim()
  if (path === '/stats' || path === '/stats/' || !path) return 'overview'
  if (!path.startsWith('/stats/')) return 'overview'

  const first = path.slice('/stats/'.length).split('/').filter(Boolean)[0] ?? ''
  if (!first) return 'overview'
  return SECTION_BY_PATH[`/stats/${first}`] ?? 'overview'
}

export function getPathnameForStatsSection(section: StatsSection): string {
  return section === 'overview' ? '/stats' : SECTION_PATHS[section]
}
