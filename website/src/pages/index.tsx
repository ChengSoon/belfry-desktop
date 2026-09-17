import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import styles from './index.module.css';

const features = [
  {
    title: '托管你的 CLI Agent',
    text: '自动检测 Codex、Claude Code 与 Pi CLI。会话状态区分进程生命周期与当下行为：闲着、正在输出、等你选，一眼看清它在忙什么。',
  },
  {
    title: '完整终端',
    text: '基于 xterm.js 与 WebGL renderer。macOS 走 Unix PTY，Windows 走 ConPTY，SSH 直连系统 OpenSSH，密码可存进钥匙串。',
  },
  {
    title: '会话协作',
    text: '为 Agent 会话起个稳定名字，通过内置 belfry CLI 在同项目会话之间派活、等待、交差，带批准闸门与排队。',
  },
  {
    title: '用量统计',
    text: '直接读本地会话日志聚合，不发任何网络请求。四类 token 归一口径，按模型与项目拆分。',
  },
  {
    title: '分屏与工作区',
    text: '同一项目下并排开多个会话，命名工作区保留分组、分屏布局与活动焦点，重开时恢复后台会话身份。',
  },
  {
    title: '插件可扩展',
    text: '安装 .piplug、加载开发目录或从插件市场选择。支持面板、命令、Agent 工具、Skill、设置与主题。',
  },
];

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.heroBanner}>
      <div className="container">
        <img
          src="img/logo.png"
          alt="Belfry"
          width="96"
          height="96"
          style={{borderRadius: 20, marginBottom: '1.5rem'}}
        />
        <h1 className={styles.heroTitle}>{siteConfig.title}</h1>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.heroButtons}>
          <Link className="button button--primary button--lg" to="/docs/quickstart">
            快速开始
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/intro">
            了解 Belfry
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): React.ReactElement {
  return (
    <Layout title="Belfry - 托管你的 CLI Agent" description="在 macOS 和 Windows 上托管 Codex、Claude Code 与 Pi CLI 的终端工作台">
      <HomepageHeader />
      <main className="container">
        <section className={styles.features}>
          {features.map((feature, idx) => (
            <div key={idx} className={styles.featureCard}>
              <h3 className={styles.featureTitle}>{feature.title}</h3>
              <p className={styles.featureText}>{feature.text}</p>
            </div>
          ))}
        </section>
      </main>
    </Layout>
  );
}
