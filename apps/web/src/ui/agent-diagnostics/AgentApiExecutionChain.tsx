import React from 'react'
import { Alert, Stack, Text } from '@mantine/core'
import type { AgentPipelineRunDto } from '../../api/server'

type AgentApiExecutionChainProps = {
  jobs: AgentPipelineRunDto[]
  jobsLoading: boolean
  jobsError: string
  selectedJobId: string
  traces: readonly unknown[]
  diagnosticsLoading: boolean
  onSelectJob: (jobId: string) => void
  onRefreshJobs: () => void
}

// 开源版本移除了执行链视图的实现文件（AgentApiExecutionChain 原文件），
// 此占位仅显式声明该子视图不可用：不伪造筛选逻辑与数据，
// trace 查询通过诊断面板内的手动输入通道进行。
export default function AgentApiExecutionChain(_props: AgentApiExecutionChainProps): JSX.Element {
  return (
    <Stack className="agent-api-execution-chain-unavailable" gap="xs">
      <Alert className="agent-api-execution-chain-unavailable__alert" color="yellow" variant="light" title="执行链视图不可用">
        <Text className="agent-api-execution-chain-unavailable__text" size="xs">
          Agent API 执行链选择视图的实现未包含在当前版本中。请直接在下方输入 Agent API Job / Trace ID 进行查询。
        </Text>
      </Alert>
    </Stack>
  )
}

// 原实现用于筛选 Agent API 视频任务；判据随实现文件一同被移除。
// 显式返回 false（jobs 列表保持为空）而非猜测筛选条件，避免混入无法识别来源的任务。
export function isAgentApiVideoRun(_run: AgentPipelineRunDto): boolean {
  return false
}
