import {
  IconEye,
  IconLayoutGrid,
  IconMovie,
  IconMusic,
  IconPhoto,
  IconScissors,
  IconTable,
  IconTypography,
  IconVideo,
} from '@tabler/icons-react'

// 创作节点目录：底部工具栏平铺项与画布空白区右键菜单共用同一份清单，保证入口一致。
export type CreationNodeItem = Readonly<{
  kind: string
  label: string
  Icon: typeof IconTypography
  badge: 'Beta' | null
}>

export const CREATION_NODE_ITEMS: readonly CreationNodeItem[] = [
  { kind: 'text', label: '文本', Icon: IconTypography, badge: null },
  { kind: 'image', label: '图像', Icon: IconPhoto, badge: null },
  { kind: 'storyboard', label: '分镜编辑', Icon: IconLayoutGrid, badge: null },
  { kind: 'shotTable', label: '分镜表', Icon: IconTable, badge: null },
  { kind: 'directorConsole', label: '导演台', Icon: IconMovie, badge: 'Beta' },
  { kind: 'video', label: '视频', Icon: IconVideo, badge: null },
  { kind: 'audio', label: '音频', Icon: IconMusic, badge: 'Beta' },
  { kind: 'videoAnalysis', label: '视频分析', Icon: IconEye, badge: null },
  { kind: 'videoCompose', label: '视频合成', Icon: IconScissors, badge: 'Beta' },
]
