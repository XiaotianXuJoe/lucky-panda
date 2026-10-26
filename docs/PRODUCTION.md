# 生产环境边界

- 项目：幸运熊猫·注意力训练
- 端口：8200
- 目录：/home/ubuntu/lucky-panda
- 进程：PM2：lucky-panda

## 推荐检查

`npm start；node --check server.js`

## 不上传、不覆盖

data.json、email-config.json、backup/ 和日志。这些内容只应通过独立的生产备份机制保存，不属于 Git 源码。

本仓库公开可见。任何真实凭据都不应写入代码、Issue、Actions 日志或 Git 历史。
