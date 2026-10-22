import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { retainRendererResources } from './renderer-resources';

export function RendererResources() {
  const gl = useThree(state => state.gl);
  useLayoutEffect(() => retainRendererResources(gl), [gl]);
  return null;
}
