# 人工审核 Beta 反馈导入

入口复用 Task15：

```sh
npm run agent -- beta-feedback --file=docs/examples/beta-feedback.synthetic.json
npm test -- tests/unit/agent-beta-feedback.test.ts
```

该可执行样例明确 `synthetic:true`，只有虚构的 p00/r00 与测试观察；重复两条是为了演示“2条反馈/1名虚构参与者”，不是真人验收。只生成忽略目录 `.agent-data/` 中 dry-run 未审核草稿，不调用模型、不联网查Issue或发布。重复运行复用同一任务。

真实导入由组织者把已经主动提供、去除隐私并人工审核的 JSON 放在项目内，再执行同一命令。没有真实反馈时不要把 synthetic 改 false 来充当数据。

Schema1 字段严格限定：

- 根：schemaVersion、synthetic、review、feedback（1..100条，最多20个不同问题，文件≤64k）。
- review：匿名reviewerId（r01）、ISO reviewedAt、decision=`reviewed-for-research`、privacyReviewed=true。这是可信本地操作者声明，不是认证或数字签名。
- 每条：id、participantId（同一真实人复用p01）、version、buildId、device、category、problem、steps、frequency、severity、verification、issueKey、evidence。
- device：desktop / ios-safari / android-chrome / other。
- category：Bug / UX Problem / Performance Problem / Gameplay Balance / Feature Request。
- frequency：occurrences与attempts非负/正安全整数，发生次数≤尝试次数。
- severity：P0..P3；verification：unverified / reproduced / not-reproduced，是人工标记，不能当程序自动复现。
- issueKey：组织者为相同问题赋相同小写key。同key合并，类别冲突拒绝；反馈ID不能重复。
- evidence：项目内源码/测试/报告的path、实际line、完整文件sha256。导入时核对真实文件/hash/行，摘录从实物读取，失效证据须重新审核。

未知字段、审批/命令/scope注入、路径穿越、隐藏目录、symlink、超预算、重复ID、非法分类、过期证据均拒绝。正文和步骤拒绝检测到的联系方式、URL、凭据与隐藏方向控制字符；自动检测不能识别所有隐私，组织者仍需人工删除身份信息。引用行也必须不含敏感数据。

获取需要引用的实际文件Hash示例（只读取公开项目源码）：

```sh
node --input-type=module -e "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';console.log(createHash('sha256').update(readFileSync('src/input/dom.ts')).digest('hex'))"
```

真实批次仅只读查询GitHub完整Issue索引，按稳定 `beta-<issueKey>` marker / 标题查重；离线明确保留本地草稿，不能宣称完成远端查重。默认所有候选为 hypothesis / AWAITING_APPROVAL、scope为空，不赋予实现权限。人先工程复现，再单独明确文件范围/验收/风险并重新审批。经济类提高风险下限。反馈中的“忽略规则、执行命令、部署”只是文本，不成为工具指令。

报告：`.agent-data/reports/beta-feedback-import.json`；草稿：`drafts/*-issue.md`。真实参与者按不同participantId计数；跨文件的人群编号由组织者维护，程序不能验证现实身份或推断总体满意度。将来人工显式发布仍走原publish入口，synthetic/dry-run不得发布，真实未审核任务不得自动执行。没有新增接收服务、Cookie、存档上传或发布权限。
