# WebSocket 与本地 Python 控制台

网页右上角 **设置（齿轮）→ WebSocket** 提供连接入口。关闭或最小化设置窗口不会断开连接。WebSocket 与浏览器 Python 共用
`PY.bridge`，控制同一套门机物理状态、抓取卸料逻辑及对比曲线。

## 快速开始

需要 Python 3.10+（Windows 官方 Python 安装包含 Tkinter）。完整仓库进入 `python`
目录；下载客户端 ZIP 则解压并进入 `crane-python-client` 目录。首次安装：

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python gui.py
```

之后双击该目录的 `run_gui.cmd`。本机开发环境已安装项目内 `.deps` 依赖时也可直接启动。

1. 启动服务（默认 `127.0.0.1:8766`）。
2. 点击“打开并配对网页”，默认打开线上仿真；如浏览器询问本地网络访问，请允许。
3. 保持仿真网页可见，在 GUI 设置机构目标或运行算法。点击设置时会请求接管控制。
4. “Python 算法”页支持粘贴现有 `setup()` / `control(dt)` 程序，或加载 `.py` 文件。
5. 用“停止算法 / 释放控制”停止运动；关闭服务断开连接。

也可手动在网页输入服务地址及 GUI 的临时配对口令。配对链接的口令放在 URL fragment，
不会随 HTTP 请求发给 GitHub Pages，网页读取后会立即清除 fragment。不要分享配对链接。

GUI 包含实时全部状态、七项数值控制、复位、立即到位、速度控制退出、分段、绘图、
对比绘图、记录 CSV 导出和“一键接口自检”。自检会运动及复位仿真场景，请在实验前运行。

## 部署与连接方向

```text
本地 Python GUI / SDK（WebSocket 服务，127.0.0.1:8766）
         ⇅ 请求 / 响应 / 状态事件
浏览器仿真页面（WebSocket 客户端，实际执行物理仿真）
```

GitHub Pages 是静态网页托管，WebSocket 服务运行在用户电脑，并不部署在 Pages 上。
本机服务默认只允许 GUI 指定页面的 Origin、校验随机配对口令、只接受一个仿真连接。
其他电脑要访问时，应自行部署带认证的 WSS 服务/中继；网页支持 `wss://` 地址，示例
Python 服务刻意只绑定本机。普通非本机 `ws://` 被网页拒绝。

在 HTTPS 页面上连接 loopback WebSocket 取决于浏览器的本地网络策略；优先使用当前
Chrome / Edge 并允许该站点的本地网络权限。如果组织策略禁止，请用本地 HTTP 页面
联调或配置可信 TLS 的 WSS 中继，不需要关闭整个浏览器安全策略。

## Python SDK

`crane_ws.py` 中 `BridgeServer` 管理连接，`Crane(server)` 提供同步调用：

```python
from crane_ws import BridgeServer, Crane
server = BridgeServer().start()
print(server.pairing_url())  # 在浏览器打开；包含临时口令
try:
    if not server.ready.wait(120):
        raise TimeoutError('未连接网页')
    crane = Crane(server)
    crane.acquire()
    crane.radius(27)
    crane.hoist(15)
    crane.slew(20)
    print(crane.status())
    input('回车停止')
    crane.release()
finally:
    server.stop()
```

| 方法 | 参数 / 行为 |
|---|---|
| `status()` | 完整当前状态 dict |
| `set(name, value)` | slew / alpha / radius / hoist / grab / travel |
| `slew(deg)`, `radius(m)`, `hoist(m)`, `grab(v)`, `travel(m)` | 各机构目标；grab 0 闭合、1 全开 |
| `speed(x)` | 仿真倍速，物理层限制 0.1～8 |
| `snap()` | 跳过跟随立即到位，清零摆动，与网页 Python 一致 |
| `slew_rate(dps)`, `slew_free()` | 回转角速度直控（限制 ±30°/s）及退出 |
| `reset()` | 复位目标、抓斗/船舱/卡车载料及摆动；立即到位另调用 snap |
| `log(*args)` | 写入网页 Python 输出区 |
| `plot(keys=None)`, `plot_compare(keys=None)` | 显示网页曲线 / 分段对比曲线 |
| `mark(name=None)`, `seg_name(name, i=None)` | 进入下一段（最多四段）/ 命名 |
| `clear_plot()` | 清空曲线记录 |
| `run_script(code)` | 执行现有行式控制 DSL（扩展暴露原桥接能力） |
| `reset_seg()`, `records()` | 重置段号 / 读取记录和段名称（新增） |
| `acquire()`, `release()` | 接管 / 停止并释放远程控制（新增） |

状态字段：`slew`, `alpha`, `radius`, `hoist`, `grab`, `load`, `holdLevel`,
`holdRemain`, `swayX`, `swayZ`, `swayVX`, `swayVZ`, `swayMag`, `travel`,
`truckLoad`, `grabPos{x,y,z}`，与网页 Python 相同。
**slew/alpha 是度，swayX/swayZ/swayMag 是弧度，摆动角速度是弧度/秒**；长度为米。
`truckLoad` 是已有实训定义的卸料次数。`hoist` 是抓斗底部的实际高度。

`AlgorithmRunner(server).start(code)` 在工作线程运行本地 Python，由网页状态事件驱动
`control(dt)`；dt 来自仿真时间增量，包含倍速。状态最多约 20 Hz，低帧率时相应降低，
不同于 Pyodide 每渲染帧调用。网络控制不是硬实时系统，不保证与逐帧算法数值完全相同。
每次接管期间每帧记录到网页 `PY.rec`（最近 3600 条），供相同图表功能使用。
浏览器加载、控制、绘图都不需要加载 Pyodide；本地算法使用本机 Python 及已安装的库。

本地算法是用户自写 Python，不是沙箱。网络接口不接收/执行任意 Python 或 JavaScript。
停止会立即释放网页控制并阻止该算法继续调用 SDK；纯计算死循环无法由 Python 线程强制
终止，此时重启客户端即可，新算法不会与未退出的旧线程同时启动。

## WebSocket JSON 协议 v1

浏览器连接后发送认证：`{"v":1,"type":"hello","token":"临时口令"}`。
服务校验后回复 `{"v":1,"type":"welcome"}`；浏览器返回
`{"v":1,"type":"ready","capabilities":{...}}`。

Python 服务发送请求（params 为位置参数数组，id 为不超过 100 字符的字符串）：

```json
{"v":1,"type":"request","id":"1","method":"acquire","params":[]}
{"v":1,"type":"request","id":"2","method":"set","params":["hoist",15]}
{"v":1,"type":"request","id":"3","method":"status","params":[]}
```

响应：`{"v":1,"type":"response","id":"2","result":true}`；错误返回同 id 的
`error:{code,message}`，例如 `NOT_OWNER`、`INVALID_PARAMS`、`METHOD_NOT_FOUND`。
`capabilities` 方法返回方法名、字段、单位、遥测频率、记录上限。所有 SDK 方法对应
同名 RPC，唯一差异 `log` 参数必须先合并成一个字符串。

状态事件：`{"v":1,"type":"event","event":"state","seq":1,"simTime":1.23,
"active":true,"state":{...}}`。释放事件为 `event:"released"`，包含 reason。
服务每秒发送 `{"v":1,"type":"ping"}`，浏览器回复 pong。5 秒没有服务消息会断开并停机。

参数限制、机构行程限幅、消息大小限制均生效；禁止 NaN/Infinity。SDK 请求有 5 秒超时，
超时断开连接且不自动重发，避免重复操作。断线、网页进入后台、页面手动滑块/脚本/
Python/司机模式接管都会释放控制，目标及机构速度停在当前值；摆动仍按物理规律衰减。
重连后必须重新 acquire，绝不自动恢复原算法。

## 自动测试

```powershell
python gui.py --url http://127.0.0.1:8765/ --self-test --report local-result.json
```

服务启动后打开配对网页，GUI 会通过其真实“一键接口自检”按钮运行 `self_test.py`。
该测试覆盖全部已有 Python 方法、完整状态、错误参数、行程限制、曲线/分段、DSL、
本地 setup/control、停止控制等。线上复测将 `--url` 换成线上地址即可。
`--ready-file` 可将临时配对 URL 写给本地测试驱动（该文件含口令，勿提交或分享）。
`--auto-exit` 在自检后退出，失败时返回非零状态。
