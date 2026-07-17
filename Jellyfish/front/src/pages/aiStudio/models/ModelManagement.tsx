import { useState } from 'react'
import { Layout, Tabs } from 'antd'
import ProvidersTab from './ProvidersTab'
import ModelsTab from './ModelsTab'
import SettingsTab from './SettingsTab'
import { useCanvasBridgeConfig } from '../../../services/canvasBridge'

export default function ModelManagement() {
  const [activeTab, setActiveTab] = useState<string>('providers')
  const canvasConfig = useCanvasBridgeConfig()

  return (
    <Layout className="h-full flex flex-col" style={{ minHeight: 0 }}>
      <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-white space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-gray-800">模型管理</span>
        </div>
        {canvasConfig && <div className="text-xs text-cyan-700">当前使用画布配置（只读）</div>}
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          size="small"
          items={[
            { key: 'providers', label: '供应商' },
            { key: 'models', label: '模型' },
            { key: 'settings', label: '设置' },
          ]}
        />
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab === 'providers' && <ProvidersTab canvasConfig={canvasConfig} />}
        {activeTab === 'models' && <ModelsTab canvasConfig={canvasConfig} />}
        {activeTab === 'settings' && <SettingsTab canvasConfig={canvasConfig} />}
      </div>
    </Layout>
  )
}
