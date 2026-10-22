import { Component } from 'react';
import type { ReactNode } from 'react';
import { monitor } from '../observability/client';
import { releaseInfo } from '../release/info';
export class FatalBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error): void { monitor.error('GAME_FATAL', { error }); }
  render() { return this.state.failed ? <main role="alert"><h1>游戏暂时无法继续</h1><p>已保存的进度仍保留在本机。请刷新后重试。</p><p>{releaseInfo.version} · {releaseInfo.buildId}</p><button type="button" onClick={() => window.location.reload()}>刷新游戏</button></main> : this.props.children; }
}
