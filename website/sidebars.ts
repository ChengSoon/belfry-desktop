import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: '开始',
      items: ['intro', 'install', 'quickstart'],
    },
    {
      type: 'category',
      label: '工作区',
      items: ['workspace', 'shortcuts'],
    },
    {
      type: 'category',
      label: 'Agent 托管',
      items: ['agent', 'provider', 'collab'],
    },
    {
      type: 'category',
      label: '终端',
      items: ['terminal'],
    },
    {
      type: 'category',
      label: '统计与扩展',
      items: ['usage', 'plugins'],
    },
    {
      type: 'category',
      label: '外观',
      items: ['appearance'],
    },
    {
      type: 'category',
      label: '帮助',
      items: ['troubleshooting'],
    },
  ],
};

export default sidebars;
