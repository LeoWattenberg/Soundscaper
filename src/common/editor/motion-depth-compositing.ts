/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionCamera } from './motion-camera.ts';
import type { MotionDepthPlanePlan } from './motion-depth-plan.ts';
import { MOTION_MAXIMUM_DEPTH_PLANES, MOTION_MAXIMUM_DEPTH_RAYS } from './motion-depth-plan.ts';
import type { MotionLocalRaster } from './motion-local-raster.ts';
import { createMotionSurface, motionBlendChannel, validateMotionSurface, type MotionSurface } from './motion-surface.ts';
import { motionPlaneMatteWeight, sampleMotionPlaneSurface, type MotionPlaneMatte } from './motion-plane-sampling.ts';
import type { MotionLighting } from './motion-lighting-plan.ts';
import { shadeMotionPlaneFragment } from './motion-plane-lighting.ts';

export interface MotionDepthPlane extends MotionDepthPlanePlan {
	readonly local: MotionLocalRaster;
	readonly matte?: MotionPlaneMatte;
	/** A matte is projected without its own composite opacity, which its consumer applies. */
	readonly opacity?: number;
}

/** Independent planes intersect each pixel ray; far-to-near translucent fragments blend over the actual backdrop. */
export async function compositeMotionDepthPlanes(backdrop: MotionSurface, camera: MotionCamera, planes: readonly MotionDepthPlane[], signal?: AbortSignal, lighting: MotionLighting = { lights: [] }): Promise<MotionSurface> {
	signal?.throwIfAborted(); validateMotionSurface(backdrop);
	if (camera.width !== backdrop.width || camera.height !== backdrop.height || planes.length > MOTION_MAXIMUM_DEPTH_PLANES || backdrop.width * backdrop.height * planes.length > MOTION_MAXIMUM_DEPTH_RAYS) throw new RangeError('Motion depth ray workload exceeds its dimensions/plane/ray budget.');
	for (const plane of planes) {
		validateMotionSurface(plane.local.surface);
		if (plane.local.origin.some((value) => !Number.isFinite(value))) throw new RangeError('Motion depth source origin must be finite.');
		if (plane.matte?.surface) { validateMotionSurface(plane.matte.surface); if (plane.matte.surface.width !== backdrop.width || plane.matte.surface.height !== backdrop.height) throw new RangeError('Motion depth matte dimensions do not match the composition.'); }
		if (!Number.isFinite(plane.opacity ?? plane.layer.state.transform.opacity) || !Number.isFinite(plane.matte?.opacity ?? 1)) throw new RangeError('Motion depth opacity must be finite.');
	}
	const output = createMotionSurface(backdrop.width, backdrop.height); output.pixels.set(backdrop.pixels);
	const fragments = new Float64Array(MOTION_MAXIMUM_DEPTH_PLANES * 6);
	const lightingScratch = new Float64Array(4);
	const scale = camera.zoom / Math.max(camera.width, camera.height);
	const chunkPixels = Math.max(1024, Math.min(16384, Math.floor(131072 / Math.max(1, planes.length))));
	for (let start = 0; start < backdrop.width * backdrop.height; start += chunkPixels) {
		if (start) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
		const end = Math.min(backdrop.width * backdrop.height, start + chunkPixels);
		for (let index = start; index < end; index++) {
			const x = index % backdrop.width + 0.5 - camera.width / 2; const y = Math.floor(index / backdrop.width) + 0.5 - camera.height / 2;
			let count = 0;
			for (let p = 0; p < planes.length; p++) {
				const plane = planes[p]!; const m = plane.cameraToLocal;
				const perspective = camera.projection === 'perspective'; const rx = perspective ? x / camera.zoom : x / scale; const ry = perspective ? y / camera.zoom : y / scale;
				const ox = m[12] + (perspective ? 0 : m[0] * rx + m[4] * ry); const oy = m[13] + (perspective ? 0 : m[1] * rx + m[5] * ry); const oz = m[14] + (perspective ? 0 : m[2] * rx + m[6] * ry);
				const dx = m[8] + (perspective ? m[0] * rx + m[4] * ry : 0); const dy = m[9] + (perspective ? m[1] * rx + m[5] * ry : 0); const dz = m[10] + (perspective ? m[2] * rx + m[6] * ry : 0);
				if (Math.abs(dz) <= 1e-12 * Math.hypot(dx, dy, dz)) continue;
				const depth = -oz / dz; if (depth < camera.near || depth > camera.far || !Number.isFinite(depth)) continue;
				const localX = ox + dx * depth; const localY = oy + dy * depth; const sx = localX - plane.local.origin[0] - 0.5; const sy = localY - plane.local.origin[1] - 0.5;
				const slot = count * 6; fragments[slot] = depth; fragments[slot + 1] = p;
				sampleMotionPlaneSurface(plane.local.surface, sx, sy, fragments, slot + 2);
				let weight = Math.max(0, Math.min(1, plane.opacity ?? plane.layer.state.transform.opacity));
				if (plane.matte) {
					const i = index * 4; const pixels = plane.matte.surface?.pixels;
					weight *= motionPlaneMatteWeight(plane.matte, pixels?.[i] ?? 0, pixels?.[i + 1] ?? 0, pixels?.[i + 2] ?? 0, pixels?.[i + 3] ?? 0);
				}
				if (fragments[slot + 5]! * weight <= 0) continue;
				shadeMotionPlaneFragment(lighting, camera, plane, planes, localX, localY, fragments, slot + 2, lightingScratch);
				for (let c = 2; c < 6; c++) fragments[slot + c]! *= weight;
				// The input is bottommost first: insertion is stable for equal depths.
				let at = count; while (at && fragments[(at - 1) * 6]! < depth) { for (let c = 0; c < 6; c++) { const v = fragments[(at - 1) * 6 + c]!; fragments[(at - 1) * 6 + c] = fragments[at * 6 + c]!; fragments[at * 6 + c] = v; } at--; }
				count++;
			}
			const i = index * 4;
			for (let at = 0; at < count; at++) {
				const slot = at * 6; const mode = planes[fragments[slot + 1]!]!.layer.state.blendMode; const ab = output.pixels[i + 3]!; const as = fragments[slot + 5]!;
				for (let c = 0; c < 3; c++) { const cb = output.pixels[i + c]!; const cs = fragments[slot + 2 + c]!;
					output.pixels[i + c] = (1 - as) * cb + (1 - ab) * cs + as * ab * motionBlendChannel(ab ? cb / ab : 0, cs / as, mode); }
				output.pixels[i + 3] = as + ab * (1 - as);
			}
		}
	}
	signal?.throwIfAborted(); validateMotionSurface(output); return output;
}
