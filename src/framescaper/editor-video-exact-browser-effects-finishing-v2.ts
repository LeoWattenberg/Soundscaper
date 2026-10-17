/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoEffectsV2 } from '../common/editor/video-effects-v2.ts';
import { CUBE_LUT_PROFILE_EFFECT_TYPE_V1 } from '../common/editor/video-cube-lut-profile-v1.ts';
import { withCubeLutProfilePixelFrameV1 } from '../common/editor/imaging/pixel-frame-cube-lut-profile-v1.ts';
import type { CubeLutSourcePortV1 } from '../common/editor/imaging/cube-lut-source-port-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../common/editor/video-color-cube-lut-v27.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { admitPixelFrameV1 } from '../common/editor/imaging/pixel-frame-admission-v1.ts';
import { readPixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';
import type { UnifiedExactRenderRgbaFrameV13 as Frame } from '../common/editor/unified-exact-render-finishing-consumers-v13.ts';
import { applyVideoExactBrowserEffectsFinishing } from './editor-video-exact-browser-effects-finishing.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
const FILL = Uint8Array.prototype.fill;
const LIMITS = Object.freeze({ maximumSidePixels: 65_536, maximumPixels: 33_554_432, maximumBytes: 128 * 1024 * 1024 });

/** Explicit current Frame resource route. Every effect and capability is
 * captured synchronously before any kernel/body await. One current frame and
 * one stage output are owned; a scoped V27 resource exists only at its authored
 * position. Original V1 rendering and direct graph admission stay strict. */
export async function applyVideoExactBrowserEffectsFinishingV2(frame: Frame, effectsValue: readonly unknown[],
	signal: AbortSignal, options: Readonly<{ source?: CubeLutSourcePortV1 }> = {}): Promise<Frame> {
	const check = () => { Reflect.apply(CHECK, signal, []); };
	check();
	const effects = normalizeVideoEffectsV2(effectsValue);
	const active = effects.some(effect => effect.type === CUBE_LUT_PROFILE_EFFECT_TYPE_V1 && effect.enabled && effect.params.lut !== null);
	const source = active ? captureSource(field(record(options, 'Frame effect resources', ['source']), 'source', 'Frame effect resources')) : undefined;
	const raw = record(frame, 'Frame resource source', ['width', 'height', 'pixels']);
	const admission = admitPixelFrameV1({ schemaVersion: 1, width: field(raw, 'width', 'Frame resource source'),
		height: field(raw, 'height', 'Frame resource source'), sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, { limits: LIMITS });
	const sourceFrame = readPixelFrameV1({ descriptor: admission.descriptor, pixels: field(raw, 'pixels', 'Frame resource source') }, LIMITS);
	check();
	const bytes = new Uint8Array(sourceFrame.pixels.buffer, sourceFrame.pixels.byteOffset, admission.byteLength);
	let current: Frame = Object.freeze({ width: admission.descriptor.width, height: admission.descriptor.height, pixels: new Uint8Array(bytes) });
	try {
		for (let index = 0; index < effects.length;) {
			check();
			const effect = effects[index]!;
			let next: Frame;
			if (effect.type === CUBE_LUT_PROFILE_EFFECT_TYPE_V1) {
				index++;
				if (!effect.enabled || effect.params.lut === null) continue;
				const output: { frame?: Frame } = {};
				try {
					next = await withCubeLutProfilePixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: current.width,
						height: current.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: current.pixels }, effect, signal }, value => {
						output.frame = Object.freeze({ width: value.descriptor.width, height: value.descriptor.height, pixels: new Uint8Array(value.pixels) });
						return output.frame;
					}, { limits: LIMITS, source });
				} catch (error) { if (output.frame) wipe(output.frame.pixels); throw error; }
			} else {
				const start = index++;
				while (index < effects.length && effects[index]!.type !== CUBE_LUT_PROFILE_EFFECT_TYPE_V1) index++;
				next = await applyVideoExactBrowserEffectsFinishing(current, effects.slice(start, index), signal);
			}
			wipe(current.pixels); current = next;
		}
		check();
		return current;
	} catch (error) { wipe(current.pixels); throw error; }
}

function captureSource(value: unknown): CubeLutSourcePortV1 {
	if (!value || typeof value !== 'object') throw new TypeError('Active Frame LUT effects require a resource source.');
	const descriptor = Object.getOwnPropertyDescriptor(value, 'withBytes');
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new TypeError('Frame LUT source requires an own withBytes method.');
	const method = descriptor.value as CubeLutSourcePortV1['withBytes'];
	return Object.freeze({ withBytes: <Result>(reference: Readonly<VideoCubeLutReferenceV1>, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>,
		options?: Readonly<{ signal?: AbortSignal }>) => Reflect.apply(method, value, [reference, consume, options]) as Promise<Result> });
}
function wipe(bytes: Uint8Array): void { Reflect.apply(FILL, bytes, [0]); }
