/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderRgbaFrameV13 } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import { withGlobalDevelopPixelFrameV1 } from '../common/editor/imaging/pixel-frame-global-develop-v1.ts';
import { isGlobalDevelopEffectTypeV1, normalizeGlobalDevelopEffectV1 } from '../common/editor/video-global-develop-v1.ts';
import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1, normalizeImageGeometryVideoEffectV1 } from '../common/editor/video-image-geometry-v1.ts';
import { withGeometryPixelFrameV1 } from '../common/editor/imaging/pixel-frame-geometry-v1.ts';
import { admitPixelFrameV1 } from '../common/editor/imaging/pixel-frame-admission-v1.ts';
import { normalizeVideoEffect, videoEffectDefinition, VIDEO_EFFECT_TYPES } from '../common/editor/video-effects.js';
import { readPixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';

const CHECK_ABORT = AbortSignal.prototype.throwIfAborted;
const GEOMETRY_LIMITS = Object.freeze({ maximumSidePixels: 65_536, maximumPixels: 33_554_432, maximumBytes: 128 * 1024 * 1024 });

/** Execute maintained browser effects over straight RGBA without changing transfer encoding. */
export async function applyVideoExactBrowserEffectsFinishing(
	frame: UnifiedExactRenderRgbaFrameV13,
	effects: readonly unknown[],
	signal: AbortSignal,
): Promise<UnifiedExactRenderRgbaFrameV13> {
	throwIfAborted(signal);
	// A valid owning project is already bounded by the 100,000-node interchange ceiling.
	const admitted = readClosedDomainArray(effects, 'Frame browser effects', 0, 100_000).map(value => {
		const effect = readClosedDomainRecord(value, 'Frame browser effect', ['id', 'type', 'enabled', 'params']);
		if (readClosedDomainField(effect, 'type', 'Frame browser effect') === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) return normalizeImageGeometryVideoEffectV1(value);
		return isGlobalDevelopEffectTypeV1(readClosedDomainField(effect, 'type', 'Frame browser effect'))
			? normalizeGlobalDevelopEffectV1(value) : readLegacyEffect(effect);
	});
	const sourceFrame = readAdmittedFrame(frame, signal);
	if (admitted.some(value => Object.getOwnPropertyDescriptor(value, 'type')?.value === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1)) {
		let current = clone(sourceFrame);
		try {
			for (const effect of admitted) {
				throwIfAborted(signal);
				const geometry = Object.getOwnPropertyDescriptor(effect, 'type')?.value === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1
					? normalizeImageGeometryVideoEffectV1(effect) : null;
				if (geometry && !geometry.enabled) continue;
				const next = geometry ? await withGeometryPixelFrameV1({ frame: { descriptor: { schemaVersion: 1,
					width: current.width, height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels },
					geometry: imageGeometryForVideoEffectV1(geometry, current.width, current.height), signal },
					output => Object.freeze({ width: output.descriptor.width, height: output.descriptor.height, pixels: output.pixels.slice() }),
					{ limits: GEOMETRY_LIMITS,
						delivery: { width: current.width, height: current.height } }) : await applyVideoExactBrowserEffectsFinishing(current, [effect], signal);
				current.pixels.fill(0); current = next;
			}
			return current;
		} catch (error) { current.pixels.fill(0); throw error; }
	}
	if (admitted.length === 0) return clone(sourceFrame);
	if (admitted.every(value => isGlobalDevelopEffectTypeV1(Object.getOwnPropertyDescriptor(value, 'type')?.value))) {
		return withGlobalDevelopPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: sourceFrame.width, height: sourceFrame.height,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: sourceFrame.pixels }, effects: admitted, signal },
			output => Object.freeze({ width: output.descriptor.width, height: output.descriptor.height, pixels: output.pixels.slice() }),
			{ maximumEffects: 100_000, limits: { maximumSidePixels: 65_536, maximumPixels: 33_554_432, maximumBytes: 128 * 1024 * 1024 } });
	}
	// Own bytes and settings before loading resources; capture native source
	// geometry once for every route, including empty and disabled recipes.
	const pixels = new Uint8Array(sourceFrame.pixels);
	try {
		const backend = await import('../common/editor/ui/video-preview-straight-rgba.ts');
		throwIfAborted(signal);
		return await backend.renderVideoPreviewStraightRgba({ width: sourceFrame.width, height: sourceFrame.height, pixels }, admitted, signal);
	} finally { pixels.fill(0); }
}

function clone(frame: UnifiedExactRenderRgbaFrameV13): UnifiedExactRenderRgbaFrameV13 {
	return Object.freeze({ width: frame.width, height: frame.height, pixels: frame.pixels.slice() });
}

function readAdmittedFrame(value: unknown, signal: AbortSignal): UnifiedExactRenderRgbaFrameV13 {
	const input = readClosedDomainRecord(value, 'Frame browser source', ['width', 'height', 'pixels']);
	const plan = admitPixelFrameV1({ schemaVersion: 1, width: readClosedDomainField(input, 'width', 'Frame browser source'),
		height: readClosedDomainField(input, 'height', 'Frame browser source'), sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, { limits: GEOMETRY_LIMITS });
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: readClosedDomainField(input, 'pixels', 'Frame browser source') }, GEOMETRY_LIMITS);
	throwIfAborted(signal);
	return Object.freeze({ width: plan.descriptor.width, height: plan.descriptor.height,
		pixels: new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, plan.byteLength) });
}

function throwIfAborted(signal: AbortSignal): void {
	Reflect.apply(CHECK_ABORT, signal, []);
}

function readLegacyEffect(effect: Record<string, unknown>) {
	const type = readClosedDomainField(effect, 'type', 'Frame browser effect');
	if (typeof type !== 'string' || !VIDEO_EFFECT_TYPES.includes(type)) throw new RangeError('Unsupported Frame browser effect.');
	const params = readClosedDomainRecord(readClosedDomainField(effect, 'params', 'Frame browser effect'),
		'Frame browser effect parameters', Object.keys(videoEffectDefinition(type).params), []);
	const captured = Object.fromEntries(Object.keys(params).map(key => [key, readClosedDomainField(params, key, 'Frame browser effect parameters')]));
	const normalized = normalizeVideoEffect({ id: readClosedDomainField(effect, 'id', 'Frame browser effect'), type,
		enabled: readClosedDomainField(effect, 'enabled', 'Frame browser effect'), params: captured });
	return Object.freeze({ ...normalized, params: Object.freeze(normalized.params) });
}
