export default function DeferredPanel({ onClose }: { onClose: () => void }) {
  return <section className="usage-panel" data-loaded-panel>
    <h2>测试面板已加载</h2><button onClick={onClose} type="button">关闭测试面板</button>
  </section>;
}
