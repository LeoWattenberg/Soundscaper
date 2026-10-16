/* SPDX-License-Identifier: AGPL-3.0-only */
import { readPixelFrameWebGl2ColorCurrentV1, writePixelFrameWebGl2ColorChannelsCurrentV1,
	type PreparedPixelFrameWebGl2ColorCurrentV1 } from './pixel-frame-webgl2-color-current-v1.ts';
import { isPixelFrameWebGl2LutCurrentV1, readPixelFrameWebGl2LutCurrentV1,
	type PreparedPixelFrameWebGl2LutCurrentV1, type PixelFrameWebGl2LutResourcesCurrentV1 } from './pixel-frame-webgl2-lut-current-v1.ts';
import type { LinearColorChannelsV1 } from './pixel-frame-linear-chroma-v1.ts';
import { isPixelFrameWebGl2GeometryCurrentV1, readPixelFrameWebGl2GeometryCurrentV1,
	type PreparedPixelFrameWebGl2GeometryCurrentV1 } from './pixel-frame-webgl2-geometry-current-v1.ts';
import { isPixelFrameWebGl2OpticsCurrentV1, readPixelFrameWebGl2OpticsCurrentV1,
	type PreparedPixelFrameWebGl2OpticsCurrentV1 } from './pixel-frame-webgl2-optics-current-v1.ts';
import { isPixelFrameWebGl2SpatialCurrentV1, readPixelFrameWebGl2SpatialCurrentV1,
	type PreparedPixelFrameWebGl2SpatialCurrentV1 } from './pixel-frame-webgl2-spatial-current-v1.ts';

export type PreparedPixelFrameWebGl2PassCurrentV1 = Readonly<PreparedPixelFrameWebGl2ColorCurrentV1> | Readonly<PreparedPixelFrameWebGl2LutCurrentV1>
	| Readonly<PreparedPixelFrameWebGl2GeometryCurrentV1> | Readonly<PreparedPixelFrameWebGl2OpticsCurrentV1>
	| Readonly<PreparedPixelFrameWebGl2SpatialCurrentV1>;

/** Only owning color, geometry, optics, spatial and closed LUT identities enter the native
 * dispatcher. A LUT reference grants no table access outside its resource scope. */
export function readPixelFrameWebGl2PassCurrentV1(value: unknown): PreparedPixelFrameWebGl2PassCurrentV1 {
	if (isPixelFrameWebGl2GeometryCurrentV1(value)) return readPixelFrameWebGl2GeometryCurrentV1(value);
	if (isPixelFrameWebGl2OpticsCurrentV1(value)) return readPixelFrameWebGl2OpticsCurrentV1(value);
	if (isPixelFrameWebGl2SpatialCurrentV1(value)) return readPixelFrameWebGl2SpatialCurrentV1(value);
	return isPixelFrameWebGl2LutCurrentV1(value) ? readPixelFrameWebGl2LutCurrentV1(value) : readPixelFrameWebGl2ColorCurrentV1(value);
}
export function pixelFrameWebGl2PassSupportedCurrentV1(value: unknown, resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>): boolean {
	const pass = readPixelFrameWebGl2PassCurrentV1(value);
	if (pass.kind !== 8) return pass.supported;
	if (!resources) throw new TypeError('Native GPU LUT requires its current authenticated resource scope.');
	return resources.supported(pass);
}
export function writePixelFrameWebGl2PassChannelsCurrentV1(value: unknown, red: number, green: number, blue: number,
	target: LinearColorChannelsV1, resources?: Readonly<PixelFrameWebGl2LutResourcesCurrentV1>): void {
	const pass = readPixelFrameWebGl2PassCurrentV1(value);
	if ('sourceDescriptor' in pass) throw new TypeError('Native GPU geometry, optics and spatial effects require a whole-plane normative reference.');
	if (pass.kind !== 8) { writePixelFrameWebGl2ColorChannelsCurrentV1(pass, red, green, blue, target); return; }
	if (!resources) throw new TypeError('Native GPU LUT requires its current authenticated resource scope.');
	resources.writeChannels(pass, red, green, blue, target);
}
