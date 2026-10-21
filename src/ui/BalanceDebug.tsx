import { useEffect } from 'react';
import { attachBalanceDebug, useBalanceDebug } from '../runtime/balance-debug';

export function BalanceDebug() {
  const m = useBalanceDebug();
  useEffect(attachBalanceDebug, []);
  return <aside className="balance-debug" aria-label="游戏平衡调试信息">
    <strong>BALANCE / 开发分析</strong>
    {m ? <>
      <div>阶段 {m.difficulty.stage.name} · {m.distance.toFixed(0)}m · Tick {m.tick}</div>
      <div>实际速度 {m.speed.toFixed(2)}m/s · 上限 {m.maxSpeed}m/s</div>
      <div>障碍 {m.difficulty.obstaclesPerMeter.toFixed(4)}/m · 决策行 {m.difficulty.rowsPerSecond.toFixed(3)}/s</div>
      <div>障碍行 {(m.difficulty.obstacleRowProbability * 100).toFixed(0)}% · 道具 {(m.difficulty.powerupProbability * 100).toFixed(0)}% / 合格行</div>
      <div>Seed {m.seed}</div>
      <div>最近生成证书 {m.generation?.status ?? '待生成'} · 搜索节点 {m.generation?.expandedNodes ?? 0}</div>
      <div>{m.planningDistance}m行距预算：决策 {m.reaction.decisionWindowSeconds.toFixed(3)}s · 余量 {m.reaction.slackSeconds.toFixed(3)}s</div>
      <div>钱包 {m.wallet} · 等级 M{m.upgrades.magnet} / S{m.upgrades.shield} / D{m.upgrades['double-score']}</div>
      <small>250ms只读采样；反应与输入延迟来自难度配置，准备0.05s为设计假设。行距预算不等于人类可见性。证书不证明任意错误状态可获救。</small>
    </> : <div>等待分析采样…</div>}
  </aside>;
}
