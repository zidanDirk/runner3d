export interface CameraLayout { readonly y: number; readonly z: number; readonly baseFov: number; readonly targetY: number; readonly targetZ: number }
const desktop: CameraLayout = { y: 7.8, z: 12, baseFov: 51, targetY: 1.1, targetZ: -19 };

/** FOV is vertical in Three.js. Preserve at least 40° horizontally on portrait
 * canvases, rather than shrinking the three lanes with a CSS transform. */
export function cameraLayout(width: number, height: number): CameraLayout {
  const aspect = Math.max(.2, width / Math.max(1, height));
  if (aspect < .9) return { ...desktop, baseFov: Math.max(51, 2 * Math.atan(Math.tan(20 * Math.PI / 180) / aspect) * 180 / Math.PI) };
  if (height < 430 && aspect > 1.4) return { ...desktop, y: 6.5, z: 10, baseFov: 55 };
  return desktop;
}
