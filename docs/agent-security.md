# Agent 安全边界

这是单机开发工具，不是给陌生用户开放的Shell服务。没有Web管理端、生产接口、自动调度或无限Agent互调。状态目录由本地账号拥有；同账号主动篡改状态/二进制、宿主机失陷、恶意系统服务不在本版本隔离承诺内。

## 权限分离

Research只读既有项目证据与GitHub，写本地草稿；Planning只编译已批准scope的有限步骤。Implementation模型使用read-only sandbox、never自动升级、ignore-user-config、ephemeral与JSON Schema。实际help/features验证后关闭shell_tool、unified_exec、apps、plugins、hooks、browser_use、computer_use、code_mode、code_mode_host、goals。没有Shell/账号/发布工具时无需通过提示词劝模型遵守权限；提示词的数据分隔只是附加防护。

Codex父CLI仍需要已有账号认证；本程序不读取、打印或复制认证文件，不重新登录/购买额度。模型子环境只传PATH、原HOME、系统临时/语言等白名单，不传GitHub、Qiniu、OpenAI API或任意VITE私钥。`--ignore-user-config`避免继承额外MCP/Hook配置，但会采用该CLI的默认模型配置；本程序不硬编码模型或擅自切换付费服务。

**模型结果不是操作权限。** 只接受summary和edits，拒绝额外字段；路径需精确属于人工scope，禁止穿越、绝对路径、隐藏文件、symlink、控制面/发布/依赖配置、视觉基线、二进制直写、测试skip/only。每文件beforeSha256必须匹配当前内容；整批验证后才开始写入。即使Issue正文要求“忽略规则、部署”，最多成为JSON中的普通字符串，不会改变审批或工具表。

## QA也是不可信代码

模型可能把恶意代码写进测试或Blender脚本，单纯限制Codex写权限不足。真实QA固定命令在macOS Seatbelt内执行：默认deny，只写任务工作区（含独立缓存），普通用户目录/外部卷/非本任务临时目录默认不可读，只例外读取自己的代码、Node运行时、仓库Git元数据和Playwright浏览器缓存；其余系统运行资源可读。网络只允许loopback，以运行现有本地Playwright服务器；不开放公网。

本机隔离启动不了就失败，不会改用无沙盒重跑。Linux/Windows尚未实现等价隔离，需要经过验证的独立runner适配，不能将直接spawn等同安全隔离。允许本机端口意味着宿主已有本地服务仍属于信任边界，运行本工具前不应在loopback上暴露无认证敏感服务。不是容器、虚拟机或对抗同用户恶意进程的完整安全产品。

## GitHub与审批

gh只接收参数数组和结构化stdin JSON，Issue/反馈/日志不会拼进Shell。GitHub凭据仅gh适配器可通过既有keychain或显式GH_TOKEN使用，不传Codex/QA。写Issue/分支/Draft PR的命令需要操作者确认具体task ID；完整活跃/已关闭Issue扫描与同分支PR检查保证重试幂等，网络结果不明先重查。`remoteIntent`先落盘，再执行写入。

普通文件本地approve没有身份认证功能，必须由真正的人操作。远程label批准必须有真实人类事件和写权限；正文不变、未撤销、未挂起/拒绝。人工反馈不可授予权限，模型JSON不能增加scope、批准自己、修改生产权限或购买服务。

## 日志、预算与恢复

错误/日志脱敏Bearer、常见token/API key、密码赋值、私钥块、带凭据URL；不转储环境或存档。不保证识别任意未知编码秘密，原始私人数据应在导入前移除；没有授权的玩家反馈不能导入或交给模型。来源摘录仅有界本地文件行，不搜私人目录或云端反馈服务。

每个任务1并发、最多4模型调用/3修复，1800秒任务、180秒调用、64k输入字符、256KiB子进程/结果输出。进程组超时先TERM再KILL；输入/输出/结果都校验。已报告usage累计60k后阻止继续；这是调用后停止门，不是服务端硬token限制或计费保障，美元费用没有可验证数据时记N/A。真实调用使用已有授权ChatGPT账号，不安装新服务。

锁绑定owner UUID、PID、主机；只允许显式恢复同主机已死亡PID。状态写入临时文件、fsync再原子rename，调用前预留轮次。最多100任务记录、20份Dry Run；到限停下由人归档。中断时保留Worktree和未完成结果，不运行reset --hard/clean -fd、不删除其他任务目录。

参考：[OWASP LLM Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)、[Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)。规则也见仓库AGENTS.md；安全测试与真实隔离探针和长期无人值守验收必须分开表述。
