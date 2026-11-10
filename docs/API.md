# 本机接口

从私人数据目录 panel-access.json 读取 origin 和 token；请求头为 Authorization: Bearer <token>。POST 使用 JSON。不公开令牌。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /api/state | 采集周期、统计、视觉连接与错误 |
| GET | /api/catalog | 图库与含义 |
| GET | /api/pending | 最多20张待标注图片及本地 path，供宿主看图 |
| GET | /api/schema | 标签词表及标注提示词 |
| GET | /api/image/:sha256 | 图片内容 |
| GET | /api/dependencies | 本机依赖检查 |
| POST | /api/libraries/connect | path：连接用户指定的已有图库，直接读取、不复制 |
| POST | /api/libraries/disconnect | path：断开目录，不删除原图 |
| POST | /api/settings | enabled、intervalHours（1–720）、prompt（采集方向，最多100字，空字符串不限） |
| POST | /api/collect | 开始一次异步采集，随后查 state |
| POST | /api/browser | port，绑定本人登录的浏览器 |
| POST | /api/import | base64、title、tags，导入用户表情 |
| POST | /api/annotate | id、meaning，提交视觉标注 |
| POST | /api/annotate-pending | 用已配置模型处理一批，最多3张 |
| POST | /api/open-folder | 打开图库文件夹 |

仅单用户本机运行；选图与回执接口不等于微信消息发送通道。模型配置见 VISION.md。

## 聊天发送（0.3.0）

POST `delivery/settings` 保存 enabled、frequency（every/natural/requested）、style、avoidRepeat；GET state.delivery 读取。
POST `delivery/select` 接收会话、轮次和语义标签，返回候选；POST `delivery/receipt` 记录真实发送结果。
完整协议与示例见 [发送规则](../skills/meme-studio/references/delivery.md)。这些接口不会自行发送微信消息，实际通道由宿主提供。

GET `contract` 返回平台无关的规则、设置、词表和模型验收用例；模型实际执行用例后才能报告理解情况，不把接口可达当成理解通过。
