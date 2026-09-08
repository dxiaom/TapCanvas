import { describe, expect, it } from 'vitest'
import { getPathnameForStatsSection, parseStatsSectionFromPathname } from './statsRoutes'

describe('stats route contract', () => {
  it('parses every supported admin section from its canonical path', () => {
    expect(parseStatsSectionFromPathname('/stats')).toBe('overview')
    expect(parseStatsSectionFromPathname('/stats/users')).toBe('users')
    expect(parseStatsSectionFromPathname('/stats/task-logs')).toBe('task-logs')
    expect(parseStatsSectionFromPathname('/stats/account')).toBe('account')
    expect(parseStatsSectionFromPathname('/stats/homepage')).toBe('homepage')
    expect(parseStatsSectionFromPathname('/stats/projects')).toBe('projects')
    expect(parseStatsSectionFromPathname('/stats/prompts')).toBe('prompts')
    expect(parseStatsSectionFromPathname('/stats/agents')).toBe('agents')
    expect(parseStatsSectionFromPathname('/stats/knowledge')).toBe('knowledge')
    expect(parseStatsSectionFromPathname('/stats/skills')).toBe('skills')
    expect(parseStatsSectionFromPathname('/stats/teams')).toBe('teams')
  })

  it('maps removed and unknown pages to overview without compatibility aliases', () => {
    // system 面板依赖的开源版已删文件无法恢复，路由保持下线。
    expect(parseStatsSectionFromPathname('/stats/system')).toBe('overview')
    expect(parseStatsSectionFromPathname('/stats/model-credits')).toBe('overview')
    expect(parseStatsSectionFromPathname('/stats/not-a-section')).toBe('overview')
    expect(parseStatsSectionFromPathname('/projects')).toBe('overview')
  })

  it('builds canonical section URLs', () => {
    expect(getPathnameForStatsSection('overview')).toBe('/stats')
    expect(getPathnameForStatsSection('users')).toBe('/stats/users')
    expect(getPathnameForStatsSection('task-logs')).toBe('/stats/task-logs')
    expect(getPathnameForStatsSection('account')).toBe('/stats/account')
    expect(getPathnameForStatsSection('homepage')).toBe('/stats/homepage')
    expect(getPathnameForStatsSection('projects')).toBe('/stats/projects')
    expect(getPathnameForStatsSection('prompts')).toBe('/stats/prompts')
    expect(getPathnameForStatsSection('agents')).toBe('/stats/agents')
    expect(getPathnameForStatsSection('knowledge')).toBe('/stats/knowledge')
    expect(getPathnameForStatsSection('skills')).toBe('/stats/skills')
    expect(getPathnameForStatsSection('teams')).toBe('/stats/teams')
  })
})
