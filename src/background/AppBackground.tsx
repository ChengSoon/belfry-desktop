import { useEffect, useRef } from "react";
import { useBackground } from "./BackgroundProvider";
import "./background.css";

/**
 * 整个窗口的背景层。
 *
 * 不读 context：所有参数都由 BackgroundProvider 写成根节点上的 CSS 变量，
 * 这里只负责提供图片层的挂载点，换图和调参都不会让它重新渲染。
 *
 * 必须是 .app-shell 的第一个子节点：它和侧栏、工作区一样是 z-index auto/0 的
 * 定位元素，绘制次序只由 DOM 顺序决定，往后挪就会盖住界面。
 */
export function AppBackground() {
  const { config, url } = useBackground();
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = Boolean(url && config.mime?.startsWith("video/"));

  // 窗口退到后台时停止解码，回来后仅在用户没有主动暂停时继续播放。
  useEffect(() => {
    const syncPlayback = () => {
      const video = videoRef.current;
      if (!video) return;
      if (config.videoPaused || document.hidden) video.pause();
      else void video.play().catch(() => undefined);
    };
    syncPlayback();
    document.addEventListener("visibilitychange", syncPlayback);
    return () => document.removeEventListener("visibilitychange", syncPlayback);
  }, [isVideo, config.videoPaused, url]);

  return (
    <div className="app-background" aria-hidden="true">
      {isVideo ? (
        <video
          autoPlay={!config.videoPaused}
          className={`app-background__video app-background__video--${config.fit}`}
          loop
          muted
          playsInline
          ref={videoRef}
          src={url ?? undefined}
        />
      ) : null}
    </div>
  );
}
