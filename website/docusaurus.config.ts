import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';

const config: Config = {
  title: 'Belfry',
  tagline: '托管你的 CLI Agent，也是一把称手的终端。',
  url: 'https://chengsoon.github.io',
  baseUrl: '/belfry-desktop/',
  favicon: 'img/favicon.png',

  organizationName: 'ChengSoon',
  projectName: 'belfry-desktop',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'zh',
    locales: ['zh', 'en'],
    localeConfigs: {
      zh: {label: '简体中文', htmlLang: 'zh-Hans'},
      en: {label: 'English', htmlLang: 'en'},
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/docs',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/ChengSoon/belfry-desktop/edit/main/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies import('@docusaurus/preset-classic').Options,
    ],
  ],

  plugins: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['zh', 'en'],
        docsRouteBasePath: '/docs',
      },
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    image: 'img/logo.png',
    navbar: {
      title: 'Belfry',
      logo: {
        alt: 'Belfry',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: '文档',
        },
        {
          href: 'https://github.com/ChengSoon/belfry-desktop/releases',
          label: '下载',
          position: 'right',
        },
        {
          href: 'https://github.com/ChengSoon/belfry-desktop',
          label: 'GitHub',
          position: 'right',
        },
        {
          type: 'localeDropdown',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: '文档',
          items: [
            {label: '快速开始', to: '/docs/quickstart'},
            {label: '快捷键', to: '/docs/shortcuts'},
            {label: '故障排查', to: '/docs/troubleshooting'},
          ],
        },
        {
          title: '社区',
          items: [
            {label: 'GitHub Issues', href: 'https://github.com/ChengSoon/belfry-desktop/issues'},
            {label: '更新日志', href: 'https://github.com/ChengSoon/belfry-desktop/releases'},
          ],
        },
        {
          title: '法律',
          items: [
            {label: 'LGPL-3.0', href: 'https://github.com/ChengSoon/belfry-desktop/blob/main/LICENSE'},
            {label: '免责声明', to: '/docs/troubleshooting#disclaimer'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Belfry. 采用 LGPL-3.0 许可。`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies import('@docusaurus/preset-classic').ThemeConfig,
};

export default config;
