import type { CSSProperties } from 'react';

type IconName = 'arrow-left' | 'arrow-right' | 'jump' | 'slide' | 'play' | 'pause' | 'retry' | 'coin' | 'chevron' | 'route';

const paths: Record<IconName, string> = {
  'arrow-left': 'M19 12H5m7-7-7 7 7 7',
  'arrow-right': 'M5 12h14m-7-7 7 7-7 7',
  jump: 'M12 20V4m-7 7 7-7 7 7M5 20h14',
  slide: 'M5 5h14M12 5v14m-7-7 7 7 7-7',
  play: 'm9 5 11 7-11 7V5Z',
  pause: 'M8 5v14M16 5v14',
  retry: 'M4 10a8 8 0 1 1 1 8M4 4v6h6',
  coin: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 4v10m3-8h-5a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9',
  chevron: 'm9 5 7 7-7 7',
  route: 'M5 20 9 4m6 0 4 16M12 5v3m0 4v3m0 4v1',
};

export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
