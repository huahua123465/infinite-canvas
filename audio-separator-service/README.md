# 本地音频分离助手

`start-web.bat` 会自动在后台启动本服务。首次启动时，服务会在当前目录私有安装 Python 3.11、FFmpeg 和 `audio-separator[gpu]`，不要求安装 Docker，也不会修改系统 Python。

Windows NVIDIA 机器固定使用 PyTorch CUDA 12.8 运行包；私有 FFmpeg 目录只注入本地分离子进程，不修改系统 `PATH`。

- 服务地址：`http://127.0.0.1:17372`
- 默认模型：`model_bs_roformer_ep_317_sdr_12.9755.ckpt`
- 运行数据：`.runtime/`、`.venv/`、`models/`、`work/`
- 安装与运行日志：`logs/`

首次安装和首次下载模型需要联网。安装完成后，模型会保存在 `models/`，后续分离不再重复下载。
