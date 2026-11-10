# 来源与许可

本项目从 https://github.com/jqiankun8866/DSH-assistant 抽离，基于 v0.1.1 的表情与浏览器模块；独立适配器保留独立数据存储。

- src/assistant下的meme-library、meme-semantics、meme-affinity、meme-preferences、meme-collector、meme-ocr-script、received-memes及XHS浏览器模块来自父项目，沿用MIT声明；received-memes已移除仅微信会话限制，persona为独立设置适配器。独立控制台、服务入口和宿主客户端为本项目新增代码。
- 保留父项目历史版权：Copyright (c) 2026 dsh-wechat-assistant contributors；Copyright (c) 2026 Ox2g；Copyright (c) Tencent。父项目微信通道来源 https://github.com/Ox2g/dsh-plugin-wechat ，协议来源 https://github.com/Tencent/openclaw-weixin 。本独立包不包含微信协议实现，这些保留声明不代表其作者为新控制台背书。
- Node.js及其SQLite、Chrome、Windows OCR与FFmpeg由用户本机提供，不打包二进制。FFmpeg不同构建许可证可能不同，见https://ffmpeg.org/legal.html；若未来打包需单独核对实际构建。
- Playwright仅用于开发验收，不包含在运行时；宿主视觉模型与发送工具也不包含在项目中。
- 小红书素材、用户发送的表情、私人收藏及数据库不随包分发，素材权利与代码MIT许可分别处理；来源注明不等于取得再分发许可。


本项目不附带任何表情图片；用户连接的图库和运行时采集内容不随代码发布。
