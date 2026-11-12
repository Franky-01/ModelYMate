# 第三方代码与素材

项目原创代码采用根目录 [MIT 许可](LICENSE)。本说明区分代码、模型及依赖的授权范围；根许可不会重新授权第三方作品。

## 车辆模型：CC BY-NC 4.0

- 作品：2025 Tesla Model Y（Juniper）。
- 原作者：[BloxBloger](https://sketchfab.com/BloxBloger)。
- 原始来源：[Sketchfab 模型页面](https://sketchfab.com/3d-models/2025-tesla-model-y-619601e7800d418da5922c4fa7833f74)。
- 许可：[Creative Commons Attribution-NonCommercial 4.0 International](https://creativecommons.org/licenses/by-nc/4.0/)。
- 中间来源：[aditano/tesla-studio](https://github.com/aditano/tesla-studio/tree/1d4be35d45e8357f58d1ac620cfcfcf0544bbd56)，固定提交 `1d4be35d45e8357f58d1ac620cfcfcf0544bbd56`。
- 当前资源：`public/assets/vehicle.glb`；几何转换记录：`public/assets/vehicle.audit.json`。

ModelYMate 对已署名的模型进行了曲面与材质调整、面板开合结构和内衬添加、SceneKit/glTF 转换及无损传输压缩。这些修改不取消原模型的非商业条件。模型不是 OEM CAD，也不表示作者、Tesla 或任何上游对本项目的背书。

复制、修改或分享模型及其衍生版本时，应遵守 CC BY-NC 4.0，包括署名、保留许可链接、说明修改和非商业使用条件。**模型不在本项目 MIT 授权范围内；本仓库没有提供模型的商业使用授权。** 完整来源、修改历史与几何审计说明保留在 [CREDITS.md](public/assets/CREDITS.md)。

## 原创环境与界面资源

`public/assets/Atelier.hdr` 是 ModelYMate 程序生成的中性摄影棚环境，不含下载图片。项目原创图标、显示屏示意图及其他原创展示代码采用本项目 MIT 许可；该授权不覆盖车辆网格。CREDITS 中提到的历史 Poly Haven 环境并非当前随附的 Atelier 文件。

## my-tesla：MIT

电池满充健康公式和回放交互参考 [kinopico-zhang/my-tesla](https://github.com/kinopico-zhang/my-tesla/tree/c1210ef0e65db22a745476f332af9300a10dbbb1)，固定提交 `c1210ef0e65db22a745476f332af9300a10dbbb1`。

Copyright (c) 2026 kinopico。完整许可及改编说明见 [my-tesla-MIT.txt](public/licenses/my-tesla-MIT.txt)。本项目保留相应源码注释与界面归属说明。

## coordtransform：MIT

坐标显示转换使用 [wandergis/coordtransform](https://github.com/wandergis/coordtransform) 2.1.2。

Copyright (c) 2015 记忆的残骸。完整许可见 [coordtransform.txt](public/licenses/coordtransform.txt)。转换只用于显示，不覆盖原始 GPS 记录。

## Meshoptimizer 与软件依赖

车辆传输格式使用 `EXT_meshopt_compression`。上游编码工具为 [meshoptimizer](https://github.com/zeux/meshoptimizer) 0.22（Copyright Arseny Kapoulkine，MIT），运行时使用 Three.js 所附解码器。压缩不改变车辆模型许可。

React、Three.js、Lucide、Vite 等软件通过包管理器安装，其版本由 `pnpm-lock.yaml` 固定，各自的许可随依赖包提供。分发打包后的应用或依赖副本时，须保留适用的许可与版权声明。高德地图是可选的外部服务，其服务条件不由本仓库许可替代。
