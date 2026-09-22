import type { Cs2Crosshair } from './cs2';
import type { ValorantCrosshair } from './valorant';
import type { CrosshairWarning } from './errors';

export type ParsedCrosshair = Cs2Crosshair | ValorantCrosshair;
export type CrosshairProfile = 'primary' | 'ads';
export interface RenderOptions { size?: number; scale?: number; profile?: CrosshairProfile }
export interface CrosshairRect { x: number; y: number; width: number; height: number; opacity: number }
export interface CrosshairScene {
  rectangles: CrosshairRect[];
  color: [number, number, number, number];
  outlineThickness: number;
  outlineOpacity: number;
  warnings: CrosshairWarning[];
}
export interface RasterImage { width: number; height: number; data: Uint8Array; warnings: CrosshairWarning[] }
