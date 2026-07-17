import { useSyncExternalStore } from 'react'

export type CanvasBridgeChannel = {
  id: string
  name: string
  baseUrl: string
  hasApiKey: boolean
  apiFormat: string
  models: string[]
}

export type CanvasBridgeConfig = {
  channels: CanvasBridgeChannel[]
  model: string
  imageModel: string
  videoModel: string
  textModel: string
  audioModel: string
  imageModels: string[]
  videoModels: string[]
  textModels: string[]
  audioModels: string[]
}

export function canvasProviderRows(config: CanvasBridgeConfig) {
  return config.channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    base_url: channel.baseUrl,
    image_base_url: channel.baseUrl,
    video_base_url: channel.baseUrl,
    description: '来自无限画布配置',
    status: 'active' as const,
    created_by: 'infinite-canvas',
    remark: channel.apiFormat,
  }))
}

export function canvasModelRows(config: CanvasBridgeConfig) {
  const categoryFor = (value: string) => {
    if (config.imageModels.includes(value)) return 'image' as const
    if (config.videoModels.includes(value)) return 'video' as const
    if (config.textModels.includes(value)) return 'text' as const
    return null
  }
  return config.channels.flatMap((channel) =>
    channel.models.flatMap((name) => {
      const id = `${channel.id}::${name}`
      const category = categoryFor(id)
      return category ? [{ id, name, category, provider_id: channel.id, params: {}, description: '来自无限画布配置', created_by: 'infinite-canvas' }] : []
    }),
  )
}

const listeners = new Set<() => void>()
let currentConfig: CanvasBridgeConfig | null = null

export function initCanvasBridge() {
  window.addEventListener('message', handleMessage)
  window.parent?.postMessage({ type: 'jellyfish:ready' }, '*')
  return () => window.removeEventListener('message', handleMessage)
}

export function useCanvasBridgeConfig() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return currentConfig
}

function getServerSnapshot() {
  return null
}

function handleMessage(event: MessageEvent) {
  if (window.parent !== window && event.source !== window.parent) return
  if (event.data?.type !== 'infinite-canvas:config') return
  const config = event.data.config as CanvasBridgeConfig | undefined
  if (!config || !Array.isArray(config.channels)) return
  currentConfig = config
  listeners.forEach((listener) => listener())
}
