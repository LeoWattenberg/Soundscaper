/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { admitPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { withGlobalDevelopPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-global-develop-v1.ts';
import { withGeometryPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-geometry-v1.ts';
import { createPixelFrameHistogramV1, type PixelFrameHistogramV1 } from '../../common/editor/imaging/pixel-frame-histogram-v1.ts';
import { isGlobalDevelopEffectTypeV1 } from '../../common/editor/video-global-develop-v1.ts';
import { CHROMA_DEVELOP_EFFECT_TYPE_V1 } from '../../common/editor/video-chroma-develop-v1.ts';
import { BLACK_WHITE_MIX_EFFECT_TYPE_V1 } from '../../common/editor/video-black-white-mix-v1.ts';
import { HSL_MIXER_EFFECT_TYPE_V1 } from '../../common/editor/video-hsl-mixer-v1.ts';
import { IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1, imageGeometryForVideoEffectV1 } from '../../common/editor/video-image-geometry-v1.ts';
import type { ImageGeometryV1 } from '../../common/editor/imaging/image-geometry-v1.ts';
import { normalizePhotoDevelopV1 } from '../catalog/develop-state.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../catalog/types.ts';

export const PHOTO_DEVELOP_PROXY_LIMITS_V1 = Object.freeze({
	source: Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 }),
	render: Object.freeze({ maximumSidePixels: 4096, maximumPixels: 8_388_608, maximumBytes: 33_554_432 }),
});
interface Frame {
	readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly pixels: Uint8Array<ArrayBuffer>;
}
export interface PhotoDevelopProxyViewV1 {
	readonly frame: Readonly<Frame>;
	readonly histogram: Readonly<PixelFrameHistogramV1>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** One already-oriented derivative; source/settings are detached before awaiting.
 * Natural geometry stays Photo-owned. Each completed stage replaces/wipes its
 * predecessor, so stack length never multiplies retained pixel backing. */
export async function withPhotoDevelopProxyV1<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopProxyViewV1>) => Result | Promise<Result>): Promise<Result> {
	const input = record(value, 'photo develop proxy', ['frame', 'develop', 'signal'], ['frame', 'develop']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'photo develop proxy') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Photo develop proxy requires a scoped consumer.');
	const develop = normalizePhotoDevelopV1(field(input, 'develop', 'photo develop proxy'));
	const serialized = JSON.stringify(develop), maximum = LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes;
	if (serialized.length > maximum || new TextEncoder().encode(serialized).byteLength > maximum) throw new RangeError('Photo proxy settings exceed their byte budget.');
	if (develop.maskBindings.length) throw new RangeError('Photo proxy mask-bound adjustments are unsupported.');
	for (const effect of develop.effects) {
		if (effect.enabled && effect.type !== IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1 && effect.type !== CHROMA_DEVELOP_EFFECT_TYPE_V1
			&& effect.type !== BLACK_WHITE_MIX_EFFECT_TYPE_V1 && effect.type !== HSL_MIXER_EFFECT_TYPE_V1 && !isGlobalDevelopEffectTypeV1(effect.type)) {
			throw new RangeError(`Unsupported photo proxy effect: ${effect.type}.`);
		}
	}
	const raw = record(field(input, 'frame', 'photo develop proxy'), 'photo proxy source', ['descriptor', 'pixels']);
	const admitted = admitPixelFrameV1(field(raw, 'descriptor', 'photo proxy source'), { limits: PHOTO_DEVELOP_PROXY_LIMITS_V1.source });
	const source = readPixelFrameV1({ descriptor: admitted.descriptor, pixels: field(raw, 'pixels', 'photo proxy source') }, PHOTO_DEVELOP_PROXY_LIMITS_V1.source);
	let current: Frame = Object.freeze({ descriptor: source.descriptor, pixels: new Uint8Array(source.pixels) });
	let owned = current.pixels.buffer;
	const replace = (next: Frame) => { wipe(owned); current = next; owned = next.pixels.buffer; };
	try {
		const legacy = develop.geometry;
		if (legacy.crop !== null || legacy.rotationDegrees !== 0 || legacy.flipHorizontal || legacy.flipVertical) {
			replace(await geometry(current, { schemaVersion: 1, ...legacy, perspective: null }, signal as AbortSignal | undefined));
		}
		for (const effect of develop.effects) {
			check(); if (!effect.enabled) continue;
			if (effect.type === IMAGE_GEOMETRY_VIDEO_EFFECT_TYPE_V1) {
				replace(await geometry(current, imageGeometryForVideoEffectV1(effect, current.descriptor.width, current.descriptor.height), signal as AbortSignal | undefined));
			} else {
				replace(await stage(accept => withGlobalDevelopPixelFrameV1({ frame: current, effects: [effect], signal }, accept,
					{ limits: PHOTO_DEVELOP_PROXY_LIMITS_V1.render, maximumEffects: 1 })));
			}
		}
		check();
		const histogram = await createPixelFrameHistogramV1(current, { limits: PHOTO_DEVELOP_PROXY_LIMITS_V1.render, ...(signal ? { signal } : {}) });
		check(); const result = await consume(Object.freeze({ frame: current, histogram })); check(); return result;
	} finally { wipe(owned); }
}

function geometry(frame: Frame, geometry: Readonly<ImageGeometryV1>, signal: AbortSignal | undefined): Promise<Frame> {
	return stage(accept => withGeometryPixelFrameV1({ frame, geometry, signal }, accept, { limits: PHOTO_DEVELOP_PROXY_LIMITS_V1.render }));
}

/** A kernel may cancel after its callback returns. Retain and wipe that staged
 * copy if delivery refuses, rather than abandoning an allocated output. */
async function stage(run: (accept: (frame: Frame) => void) => Promise<void>): Promise<Frame> {
	const staged: { frame: Frame | null; buffer: ArrayBuffer | null } = { frame: null, buffer: null };
	try {
		await run(frame => {
			const pixels = new Uint8Array(frame.pixels); staged.buffer = pixels.buffer;
			staged.frame = Object.freeze({ descriptor: frame.descriptor, pixels });
		});
		if (!staged.frame) throw new Error('Photo proxy stage produced no frame.');
		return staged.frame;
	} catch (error) { if (staged.buffer) wipe(staged.buffer); throw error; }
}

function wipe(buffer: ArrayBuffer): void {
	if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0);
}
