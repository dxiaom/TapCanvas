import React from 'react'
import { AsyncDialogLoading } from './AsyncLoadingFeedback'
import { ActionIcon, Badge, Tooltip, useMantineColorScheme } from '@mantine/core'
import {
  IconActivity,
  IconBinaryTree,
  IconCpu,
  IconHistory,
  IconPalette,
  IconTopologyStar3,
  IconUsersGroup,
} from '@tabler/icons-react'

import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { CREATION_NODE_ITEMS } from './creationNodeItems'
import type { CapabilityBayLaunchScope } from './capabilities/CapabilityBayDialog'
import { PanelCard } from './PanelCard'
import { KeyboardShortcutsButton } from './KeyboardShortcutsButton'
import { $ } from '../canvas/i18n'
import { floatingBarPositionStyle } from './utils/panelPosition'
import { useAuth } from '../auth/store'
import { useTaskInbox } from './useTaskInbox'

const CapabilityBayDialog = React.lazy(async () => {
  const module = await import('./capabilities/CapabilityBayDialog')
  return { default: module.CapabilityBayDialog }
})

// 工具栏内提示文字的方向：底部停靠时在上方，左右停靠时分别朝画布内侧。
export type FloatingNavTooltipPosition = 'top' | 'right' | 'left'

type FloatingNavItemProps = {
  label: string
  icon: React.ReactNode
  // 仅点击唤起（已去掉 hover 展开）；回调带触发项水平中心，供上方弹出面板居中。
  onClick?: (x: number) => void
  badge?: string
  tooltipLabel?: string
  tooltipPosition?: FloatingNavTooltipPosition
  active?: boolean
  activeStyle?: React.CSSProperties
  dataTour?: string
}

const FloatingNavItem = React.memo(function FloatingNavItem({
  label,
  icon,
  onClick,
  badge,
  tooltipLabel,
  tooltipPosition = 'top',
  active = false,
  activeStyle,
  dataTour,
}: FloatingNavItemProps): JSX.Element {
  return (
    <div
      className="floating-nav-item-wrap"
      style={{ position: 'relative' }}
      data-ux-floating
    >
      <Tooltip
        className="floating-nav-item-tooltip"
        label={tooltipLabel}
        position={tooltipPosition}
        offset={10}
        withArrow
        disabled={!tooltipLabel}
      >
        <ActionIcon
          className="floating-nav-item"
          variant="subtle"
          size={28}
          radius="md"
          aria-label={label}
          data-tour={dataTour}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onClick?.(r.left + r.width / 2)
          }}
          style={active ? activeStyle : undefined}
        >
          {icon}
        </ActionIcon>
      </Tooltip>
      {badge ? (
        <Badge
          className="floating-nav-item-badge"
          color="gray"
          size="xs"
          variant="light"
          style={{ position: 'absolute', top: -6, right: -6, borderRadius: 999 }}
        >
          {badge}
        </Badge>
      ) : null}
    </div>
  )
})

export default function FloatingNav({ className }: { className?: string }): JSX.Element {
  const [capabilityBayOpened, setCapabilityBayOpened] = React.useState(false)
  const capabilityBayOpenRequest = useUIStore((state) => state.capabilityBayOpenRequest)
  const clearCapabilityBayOpenRequest = useUIStore((state) => state.clearCapabilityBayOpenRequest)
  const activePanel = useUIStore((state) => state.activePanel)
  const setActivePanel = useUIStore((state) => state.setActivePanel)
  const setPanelAnchorX = useUIStore((state) => state.setPanelAnchorX)
  const canvasToolbarPosition = useUIStore((state) => state.canvasToolbarPosition)
  const addNode = useRFStore((state) => state.addNode)
  const addDirectorConsoleNode = useRFStore((state) => state.addDirectorConsoleNode)
  const userId = useAuth((state) => state.user?.sub == null ? null : String(state.user.sub))
  const currentProjectId = useUIStore((state) => state.currentProject?.id ?? '')
  const currentFlow = useUIStore((state) => state.currentFlow)
  const currentChapter = useUIStore((state) => state.currentChapter)
  const canvasProvenanceKey = useRFStore((state) => state.graphProvenanceKey)
  const launchScope = React.useMemo<CapabilityBayLaunchScope | null>(() => {
    if (!capabilityBayOpened) return null
    const selectedGroupIds = useRFStore.getState().nodes.flatMap((node) => (
      node.type === 'groupNode' && node.selected ? [node.id] : []
    ))
    if (currentChapter) {
      if (!currentChapter.projectId || !currentChapter.chapterId || (currentProjectId && currentChapter.projectId !== currentProjectId)) return null
      return {
        projectId: currentChapter.projectId,
        chapterId: currentChapter.chapterId,
        selectedGroupIds: canvasProvenanceKey === `chapter:${currentChapter.chapterId}` ? selectedGroupIds : [],
      }
    }
    if (
      !currentProjectId
      || currentFlow.source !== 'server'
      || currentFlow.ownerType !== 'project'
      || currentFlow.ownerId !== currentProjectId
      || !currentFlow.id
    ) return null
    return {
      projectId: currentProjectId,
      canvasFlowId: currentFlow.id,
      selectedGroupIds: canvasProvenanceKey === `flow:${currentFlow.id}` ? selectedGroupIds : [],
    }
  }, [capabilityBayOpened, canvasProvenanceKey, currentChapter, currentFlow, currentProjectId])
  const taskInbox = useTaskInbox(userId, Boolean(userId))
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme !== 'light'
  const activeItemBackground = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16, 16, 19, 0.06)'
  const activeItemColor = '#f4f4f5'
  const activeItemBorder = isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(16,16,19,0.14)'
  const activeItemShadow = isDark ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(0,0,0,0.28)' : '0 10px 18px rgba(17,18,21,0.14)'
  const activeItemStyle = React.useMemo<React.CSSProperties>(() => ({
    background: activeItemBackground,
    color: activeItemColor,
    border: activeItemBorder,
    boxShadow: activeItemShadow,
  }), [activeItemBackground, activeItemBorder, activeItemShadow])

  React.useEffect(() => {
    if (!capabilityBayOpenRequest) return
    setCapabilityBayOpened(true)
  }, [capabilityBayOpenRequest])

  const closeCapabilityBay = React.useCallback(() => {
    setCapabilityBayOpened(false)
    clearCapabilityBayOpenRequest()
  }, [clearCapabilityBayOpenRequest])

  // 创作节点一键添加：添加成功后关闭任何已打开的面板。
  const addCreationNode = React.useCallback((kind: string) => {
    if (kind === 'directorConsole') {
      addDirectorConsoleNode()
    } else {
      addNode('taskNode', undefined, { kind })
    }
    setActivePanel(null)
  }, [addNode, addDirectorConsoleNode, setActivePanel])

  const isSide = canvasToolbarPosition !== 'bottom'
  // 提示文字方向：底部停靠在按钮上方；左停靠朝右、右停靠朝左（画布内侧）。
  const tooltipPosition: FloatingNavTooltipPosition = canvasToolbarPosition === 'left'
    ? 'right'
    : canvasToolbarPosition === 'right'
      ? 'left'
      : 'top'
  const navClassName = [
    'floating-nav',
    isSide ? 'floating-nav--side' : 'floating-nav--bottom',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div
      className={navClassName}
      style={floatingBarPositionStyle(canvasToolbarPosition)}
      data-ux-floating
      data-tour="floating-nav"
    >
      <PanelCard className="floating-nav-card glass" padding="compact" data-ux-floating>
        <div className="floating-nav-stack">
          {CREATION_NODE_ITEMS.map((item) => (
            <FloatingNavItem
              key={item.kind}
              label={$(item.label)}
              icon={<item.Icon className="floating-nav-item-icon" size={18} />}
              tooltipLabel={item.badge ? `${$(item.label)} · ${item.badge}` : $(item.label)}
              tooltipPosition={tooltipPosition}
              onClick={() => addCreationNode(item.kind)}
            />
          ))}
          <FloatingNavItem
            label="风格库"
            icon={<IconPalette className="floating-nav-item-icon" size={18} />}
            tooltipLabel="风格库"
            tooltipPosition={tooltipPosition}
            onClick={(x) => {
              setPanelAnchorX(x)
              setActivePanel(activePanel === 'style-library' ? null : 'style-library')
            }}
            active={activePanel === 'style-library'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label="角色库"
            icon={<IconUsersGroup className="floating-nav-item-icon" size={18} />}
            tooltipLabel="角色库"
            tooltipPosition={tooltipPosition}
            onClick={(x) => {
              setPanelAnchorX(x)
              setActivePanel(activePanel === 'character-library' ? null : 'character-library')
            }}
            active={activePanel === 'character-library'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label="Agent 配置"
            icon={<IconCpu className="floating-nav-item-icon" size={18} />}
            tooltipLabel="Agent 配置"
            tooltipPosition={tooltipPosition}
            onClick={() => {
              clearCapabilityBayOpenRequest()
              setCapabilityBayOpened(true)
            }}
            active={capabilityBayOpened}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label="AI 编排"
            icon={<IconBinaryTree className="floating-nav-item-icon" size={18} />}
            tooltipLabel="AI 编排 · 触发器、Agent 与工作流"
            tooltipPosition={tooltipPosition}
            dataTour="orchestration-button"
            onClick={(x) => {
              setPanelAnchorX(x)
              setActivePanel(activePanel === 'add' ? null : 'add')
            }}
            active={activePanel === 'add'}
            activeStyle={activeItemStyle}
          />
          <div className="floating-nav-divider" />
          <FloatingNavItem
            label={$('工作流')}
            icon={<IconTopologyStar3 className="floating-nav-item-icon" size={18} />}
            tooltipLabel="工作流 · 历史记录"
            tooltipPosition={tooltipPosition}
            onClick={(x) => {
              setPanelAnchorX(x)
              const inGroup = activePanel === 'template' || activePanel === 'history'
              setActivePanel(inGroup ? null : 'template')
            }}
            active={activePanel === 'template' || activePanel === 'history'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label="生成历史"
            icon={<IconHistory className="floating-nav-item-icon" size={18} />}
            tooltipLabel="生成历史"
            tooltipPosition={tooltipPosition}
            onClick={(x) => {
              setPanelAnchorX(x)
              setActivePanel(activePanel === 'generation-history' ? null : 'generation-history')
            }}
            active={activePanel === 'generation-history'}
            activeStyle={activeItemStyle}
          />
          <FloatingNavItem
            label="创作动态"
            icon={<IconActivity className="floating-nav-item-icon" size={18} />}
            tooltipLabel="创作动态 · 记忆"
            tooltipPosition={tooltipPosition}
            badge={taskInbox.unreadCount > 0
              ? (taskInbox.unreadCount > 99 ? '99+' : String(taskInbox.unreadCount))
              : undefined}
            onClick={(x) => {
              setPanelAnchorX(x)
              setActivePanel(activePanel === 'task-inbox' ? null : 'task-inbox')
            }}
            active={activePanel === 'task-inbox'}
            activeStyle={activeItemStyle}
          />
          <div className="floating-nav-divider floating-nav-divider--bottom" />
          {/* 键盘快捷键「?」：从 CanvasBottomControls 独立浮动按钮合并至此。 */}
          <KeyboardShortcutsButton tooltipPosition={tooltipPosition} />
        </div>
      </PanelCard>
      {capabilityBayOpened ? (
        <React.Suspense fallback={<AsyncDialogLoading onClose={closeCapabilityBay} />}>
          <CapabilityBayDialog
            opened
            projectId={currentProjectId}
            launchScope={launchScope}
            focusRequest={capabilityBayOpenRequest}
            onClose={closeCapabilityBay}
          />
        </React.Suspense>
      ) : null}
    </div>
  )
}
