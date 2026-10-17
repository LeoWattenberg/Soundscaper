/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionCamera } from './motion-camera.ts';
import type { MotionDepthPlanePlan } from './motion-depth-plan.ts';
import { MOTION_MAXIMUM_DEPTH_PLANES, MOTION_MAXIMUM_DEPTH_RAYS } from './motion-depth-plan.ts';
import type { MotionLocalRaster } from './motion-local-raster.ts';
import { createMotionSurface, motionBlendChannel, validateMotionSurface, type MotionSurface } from './motion-surface.ts';
import { motionPlaneMatteWeight, sampleMotionPlaneSurface, type MotionPlaneMatte } from './motion-plane-sampling.ts';
import type { MotionLighting } from './motion-lighting-plan.ts';
import { shadeMotionPlaneFragment } from './motion-plane-lighting.ts';
import type { MotionVector2 } from './motion-property.ts';
import { MOTION_PINHOLE_LENS } from './motion-lens-sampling.ts';

export interface MotionDepthPlane extends MotionDepthPlanePlan {
	readonly local: MotionLocalRaster;
	readonly matte?: MotionPlaneMatte;
	/** A matte is projected without its own composite opacity, which its consumer applies. */
	readonly opacity?: number;
}

/** Independent planes intersect each pixel ray; far-to-near translucent fragments blend over the actual backdrop. */
export async function compositeMotionDepthPlanes(backdrop: MotionSurface, camera: MotionCamera, planes: readonly MotionDepthPlane[], signal?: AbortSignal,
	lighting: MotionLighting = { lights: [] }, lenses: readonly MotionVector2[] = MOTION_PINHOLE_LENS): Promise<MotionSurface> {
	signal?.throwIfAborted(); validateMotionSurface(backdrop);
	if (camera.width !== backdrop.width || camera.height !== backdrop.height || planes.length > MOTION_MAXIMUM_DEPTH_PLANES || !lenses.length || lenses.length > 64 || backdrop.width * backdrop.height * planes.length * lenses.length > MOTION_MAXIMUM_DEPTH_RAYS) throw new RangeError('Motion depth ray workload exceeds its dimensions/plane/ray budget.');
	if (lenses.some((lens) => lens.length !== 2 || lens.some((value) => !Number.isFinite(value)))) throw new RangeError('Motion camera lens samples must be finite pairs.');
	for (const plane of planes) {
		validateMotionSurface(plane.local.surface);
		if (plane.local.origin.some((value) => !Number.isFinite(value))) throw new RangeError('Motion depth source origin must be finite.');
		if (plane.matte?.surface) { validateMotionSurface(plane.matte.surface); if (plane.matte.surface.width !== backdrop.width || plane.matte.surface.height !== backdrop.height) throw new RangeError('Motion depth matte dimensions do not match the composition.'); }
		if (!Number.isFinite(plane.opacity ?? plane.layer.state.transform.opacity) || !Number.isFinite(plane.matte?.opacity ?? 1)) throw new RangeError('Motion depth opacity must be finite.');
	}
	const output = createMotionSurface(backdrop.width, backdrop.height);
	const fragments = new Float64Array(MOTION_MAXIMUM_DEPTH_PLANES * 6);
	const lightingScratch = new Float64Array(4);
	const scale = camera.zoom / Math.max(camera.width, camera.height);
	const lightWork = 1 + lighting.lights.length + lighting.lights.filter((light) => light.castsShadows).length * planes.length;
	const chunkPixels = Math.max(16, Math.min(16384, Math.floor(131072 / Math.max(1, planes.length * lenses.length * lightWork))));
	for (let start = 0; start < backdrop.width * backdrop.height; start += chunkPixels) {
		if (start) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
		const end = Math.min(backdrop.width * backdrop.height, start + chunkPixels);
		for (let index = start; index < end; index++) {
			const x = index % backdrop.width + 0.5 - camera.width / 2; const y = Math.floor(index / backdrop.width) + 0.5 - camera.height / 2;
			const i = index * 4; let sumR = 0; let sumG = 0; let sumB = 0; let sumAlpha = 0;
			for (const lens of lenses) {
				let r = backdrop.pixels[i]!; let g = backdrop.pixels[i + 1]!; let b = backdrop.pixels[i + 2]!; let alpha = backdrop.pixels[i + 3]!;
				let count = 0;
				for (let p = 0; p < planes.length; p++) {
					const plane = planes[p]!; const m = plane.cameraToLocal;
					const perspective = camera.projection === 'perspective';
					const ax = (perspective ? 0 : x / scale) + lens[0]; const ay = (perspective ? 0 : y / scale) + lens[1];
					const rx = (perspective ? x / camera.zoom : 0) - lens[0] / camera.focusDistance; const ry = (perspective ? y / camera.zoom : 0) - lens[1] / camera.focusDistance;
					const oz = m[14] + m[2] * ax + m[6] * ay;
					const dx = m[8] + m[0] * rx + m[4] * ry; const dy = m[9] + m[1] * rx + m[5] * ry; const dz = m[10] + m[2] * rx + m[6] * ry;
					if (Math.abs(dz) <= 1e-12 * Math.hypot(dx, dy, dz)) continue;
					const depth = -oz / dz; if (depth < camera.near || depth > camera.far || !Number.isFinite(depth)) continue;
					// Keep the lens coefficient together so it cancels exactly on the focus plane.
					const cameraX = (perspective ? x / camera.zoom * depth : x / scale) + lens[0] * (1 - depth / camera.focusDistance);
					const cameraY = (perspective ? y / camera.zoom * depth : y / scale) + lens[1] * (1 - depth / camera.focusDistance);
					const localX = m[12] + m[0] * cameraX + m[4] * cameraY + m[8] * depth; const localY = m[13] + m[1] * cameraX + m[5] * cameraY + m[9] * depth;
					const sx = localX - plane.local.origin[0] - 0.5; const sy = localY - plane.local.origin[1] - 0.5;
					const slot = count * 6; fragments[slot] = depth; fragments[slot + 1] = p;
					sampleMotionPlaneSurface(plane.local.surface, sx, sy, fragments, slot + 2);
					let weight = Math.max(0, Math.min(1, plane.opacity ?? plane.layer.state.transform.opacity));
					if (plane.matte) {
						const i = index * 4; const pixels = plane.matte.surface?.pixels;
						weight *= motionPlaneMatteWeight(plane.matte, pixels?.[i] ?? 0, pixels?.[i + 1] ?? 0, pixels?.[i + 2] ?? 0, pixels?.[i + 3] ?? 0);
					}
					if (fragments[slot + 5]! * weight <= 0) continue;
					shadeMotionPlaneFragment(lighting, camera, plane, planes, localX, localY, fragments, slot + 2, lightingScratch, lens);
					for (let c = 2; c < 6; c++) fragments[slot + c]! *= weight;
					// The input is bottommost first: insertion is stable for equal depths.
					let at = count; while (at && fragments[(at - 1) * 6]! < depth) { for (let c = 0; c < 6; c++) { const v = fragments[(at - 1) * 6 + c]!; fragments[(at - 1) * 6 + c] = fragments[at * 6 + c]!; fragments[at * 6 + c] = v; } at--; }
					count++;
				}
				for (let at = 0; at < count; at++) {
					const slot = at * 6; const mode = planes[fragments[slot + 1]!]!.layer.state.blendMode; const as = fragments[slot + 5]!;
					const sourceR = fragments[slot + 2]!; const sourceG = fragments[slot + 3]!; const sourceB = fragments[slot + 4]!;
					r = (1 - as) * r + (1 - alpha) * sourceR + as * alpha * motionBlendChannel(alpha ? r / alpha : 0, sourceR / as, mode);
					g = (1 - as) * g + (1 - alpha) * sourceG + as * alpha * motionBlendChannel(alpha ? g / alpha : 0, sourceG / as, mode);
					b = (1 - as) * b + (1 - alpha) * sourceB + as * alpha * motionBlendChannel(alpha ? b / alpha : 0, sourceB / as, mode);
					alpha = as + alpha * (1 - as);
				}
				sumR += r; sumG += g; sumB += b; sumAlpha += alpha;
			}
			output.pixels[i] = sumR / lenses.length; output.pixels[i + 1] = sumG / lenses.length; output.pixels[i + 2] = sumB / lenses.length; output.pixels[i + 3] = Math.min(1, sumAlpha / lenses.length);
		}
	}
	signal?.throwIfAborted(); validateMotionSurface(output); return output;
}
