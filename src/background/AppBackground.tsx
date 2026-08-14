import "./background.css";

/**
 * 整个窗口的背景层。
 *
 * 不读 context：所有参数都由 BackgroundProvider 写成根节点上的 CSS 变量，
 * 这里只负责把两层结构摆出来，换图和调参都不会让它重新渲染。
 *
 * 必须是 .app-shell 的第一个子节点：它和侧栏、工作区一样是 z-index auto/0 的
 * 定位元素，绘制次序只由 DOM 顺序决定，往后挪就会盖住界面。
 */
export function AppBackground() {
  return (
    <div className="app-background" aria-hidden="true">
      <div className="app-background__scrim" />
    </div>
  );
}
