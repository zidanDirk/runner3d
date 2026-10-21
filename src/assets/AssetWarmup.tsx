import { Component, Suspense, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useGLTF } from '@react-three/drei/core/Gltf.js';
import { assetUrl, getAsset } from './catalog';
import type { AssetId } from './catalog';
import { validateAssetDimensions } from './GeneratedAsset';
import { AssetValidationError, loading, useAssetRevision, useLoading, registerAssetCacheClear } from './loading';

function AssetProbe({ id, revision }: { id: AssetId; revision: number }) {
  // This exact URL/loader pair is also used by the visible model and City. R3F
  // suspend-react caches its request AND parse result; this is not a second load.
  const { scene } = useGLTF(assetUrl(id), false, false);
  useMemo(() => validateAssetDimensions(scene, getAsset(id).dimensions), [scene, id]);
  useEffect(() => { loading.loaded(id, revision); }, [id, revision, scene]);
  return null;
}

class WarmupBoundary extends Component<{ id: AssetId; revision: number; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error): void {
    loading.failed(this.props.id, error, this.props.revision, error instanceof AssetValidationError ? 'validation' : 'load');
    console.error(`[assets] ${this.props.id}: 资源加载失败，可重试或继续使用基础模型。`, error);
  }
  render() { return this.state.failed ? null : this.props.children; }
}

function WarmupAsset({ id }: { id: AssetId }) {
  const revision = useAssetRevision(id);
  return <WarmupBoundary key={`${id}-${revision}`} id={id} revision={revision}>
    <Suspense fallback={null}><AssetProbe id={id} revision={revision} /></Suspense>
  </WarmupBoundary>;
}

/** Mount within the existing Canvas. It draws nothing and never clones model geometry. */
export function AssetWarmup() {
  useEffect(() => registerAssetCacheClear((id) => useGLTF.clear(assetUrl(id))), []);
  const { requested } = useLoading();
  return <>{requested.map((id) => <WarmupAsset key={id} id={id} />)}</>;
}
