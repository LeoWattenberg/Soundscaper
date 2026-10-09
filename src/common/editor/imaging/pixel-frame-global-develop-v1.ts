/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { readClosedDomainArray } from '../closed-domain-value.ts';
import { COLOR_WHEELS_EFFECT_TYPE_V1, normalizeColorWheelsEffectV1, prepareColorWheelsEffectV1,
	colorWheelsByteChannelV1, releaseColorWheelsEffectV1 } from '../video-color-wheels-v1.ts';
import { isCurvesEffectTypeV1, prepareCurvesEffectV1, createCurvesTransferV1 } from '../video-curves-v1.ts';
import { globalDevelopByteChannelV1, prepareGlobalDevelopEffectV1 } from '../video-global-develop-v1.ts';
import { CHROMA_DEVELOP_EFFECT_TYPE_V1, applyChromaDevelopPixelV1, prepareChromaDevelopEffectV1 } from '../video-chroma-develop-v1.ts';
import { BLACK_WHITE_MIX_EFFECT_TYPE_V1, applyBlackWhiteMixPixelV1, prepareBlackWhiteMixEffectV1 } from '../video-black-white-mix-v1.ts';
import { HSL_MIXER_EFFECT_TYPE_V1, applyHslMixerPixelV1, prepareHslMixerEffectV1 } from '../video-hsl-mixer-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameDescriptorV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';

export interface GlobalDevelopPixelFrameV1 {
	readonly descriptor: Readonly<PixelFrameDescriptorV1>;
	readonly pixels: Uint8Array<ArrayBuffer>;
}

const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const CHUNK_BYTES = 256 * 1024;

/** One bounded native snapshot/output, processed in place; source buffers and settings stay borrowed only through admission. */
export async function withGlobalDevelopPixelFrameV1<Result>(value: unknown,
	consume: (frame: GlobalDevelopPixelFrameV1) => Result | Promise<Result>, options: Readonly<{ limits: PixelFrameLimitsV1; maximumEffects?: number }>): Promise<Result> {
	const input = record(value, 'global develop frame', ['frame', 'effects', 'signal'], ['frame', 'effects']);
	const option = record(options, 'global develop frame options', ['limits', 'maximumEffects'], ['limits']), limits = field(option, 'limits', 'global develop frame options');
	const maximumEffects = Object.hasOwn(option, 'maximumEffects') ? field(option, 'maximumEffects', 'global develop frame options') : 64;
	if (typeof maximumEffects !== 'number' || !Number.isSafeInteger(maximumEffects) || maximumEffects < 1 || maximumEffects > 100_000) {
		throw new RangeError('Global develop effect limit requires 1 through 100000 entries.');
	}
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', 'global develop frame') : undefined;
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Global develop requires a scoped frame consumer.');
	const effects = readClosedDomainArray(field(input, 'effects', 'global develop frame'), 'global develop effects', 0, maximumEffects);
	const ids = new Set<unknown>();
	const prepared = effects.map(value => {
		const effect = record(value, 'global develop effect', ['id', 'type', 'enabled', 'params']);
		const id = field(effect, 'id', 'global develop effect');
		if (ids.has(id)) throw new RangeError('Global develop effects require unique IDs.'); ids.add(id);
		const type=field(effect, 'type', 'global develop effect');
		if(type===COLOR_WHEELS_EFFECT_TYPE_V1)return normalizeColorWheelsEffectV1(value);
		if(isCurvesEffectTypeV1(type))return prepareCurvesEffectV1(value);
		if(type===HSL_MIXER_EFFECT_TYPE_V1)return prepareHslMixerEffectV1(value);
		if(type===BLACK_WHITE_MIX_EFFECT_TYPE_V1)return prepareBlackWhiteMixEffectV1(value);
		return type === CHROMA_DEVELOP_EFFECT_TYPE_V1 ? prepareChromaDevelopEffectV1(value) : prepareGlobalDevelopEffectV1(value);
	});
	const raw = record(field(input, 'frame', 'global develop frame'), 'global develop source frame', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(raw, 'descriptor', 'global develop source frame'), { limits });
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(raw, 'pixels', 'global develop source frame') }, limits);
	check();
	const pixels = new Uint8Array(new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength));
	const buffer = pixels.buffer;
	try {
		let processedBytes = 0;
		for (const effect of prepared) {
			if (!effect.enabled || ('neutral' in effect && effect.neutral)) continue;
			// Admission retains recipes; only the current scalar wheel stage owns a table.
			const wheel = effect.type === COLOR_WHEELS_EFFECT_TYPE_V1 ? prepareColorWheelsEffectV1(effect) : null;
			const lookup = isCurvesEffectTypeV1(effect.type) ? createCurvesTransferV1(effect) : null;
			try { for (let start = 0; start < pixels.length; start += CHUNK_BYTES) {
				check(); const end = Math.min(pixels.length, start + CHUNK_BYTES);
				for (let offset = start; offset < end; offset += 4) {
					if (effect.type === COLOR_WHEELS_EFFECT_TYPE_V1) {
						if (!wheel) throw new Error('An admitted color wheel preparation is unavailable.');
						for (const channel of [0,1,2] as const) pixels[offset + channel] = colorWheelsByteChannelV1(wheel, pixels[offset + channel]!, channel);
						continue;
					}
					if (effect.type === 'point-curves-v1' || effect.type === 'parametric-curves-v1') {
						if (!lookup) throw new Error('An admitted curve transfer is unavailable.');
						for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = lookup[4 * pixels[offset + channel]! + channel]!; continue;
					}
					if (effect.type === HSL_MIXER_EFFECT_TYPE_V1) { applyHslMixerPixelV1(effect, pixels, offset); continue; }
					if (effect.type === BLACK_WHITE_MIX_EFFECT_TYPE_V1) { applyBlackWhiteMixPixelV1(effect, pixels, offset); continue; }
					if (effect.type === CHROMA_DEVELOP_EFFECT_TYPE_V1) { applyChromaDevelopPixelV1(effect, pixels, offset); continue; }
					pixels[offset] = globalDevelopByteChannelV1(effect, pixels[offset]!, 0);
					pixels[offset + 1] = globalDevelopByteChannelV1(effect, pixels[offset + 1]!, 1);
					pixels[offset + 2] = globalDevelopByteChannelV1(effect, pixels[offset + 2]!, 2);
				}
				processedBytes += end - start;
				if (processedBytes >= CHUNK_BYTES) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); processedBytes = 0; check(); }
			} } finally { lookup?.fill(0); if (wheel) releaseColorWheelsEffectV1(wheel); }
		}
		check(); const result = await consume(Object.freeze({ descriptor: source.descriptor, pixels })); check(); return result;
	} finally { if (Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0) new Uint8Array(buffer).fill(0); }
}
