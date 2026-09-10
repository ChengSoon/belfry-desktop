# PI 插件示例

在 Belfry 的插件中心加载此开发目录。编辑 main.js 或资源后自动重载。

使用“校验”和“打包”生成可分享的 .piplug，安装者直接选择插件包即可。
CLI：在 Belfry 仓库运行 node scripts/plugin-devkit.mjs check <插件目录> 或 pack <插件目录>。

manifest.json 声明身份、入口、贡献和权限；main.js 导出 onLoad/onUnload，通过 pi 调用宿主。
添加权限或扩大文件/网络范围后需要重新安装确认。
