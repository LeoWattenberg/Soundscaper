/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { prepareDetailSharpenEffectV1 } from '../video-sharpen-v1.ts';
import { prepareClarityEffectV1 } from '../video-clarity-v1.ts';
import { prepareNoiseReductionEffectV1 } from '../video-noise-reduction-v1.ts';
import { grainNoiseV1, prepareGrainEffectV1 } from '../video-grain-v1.ts';
import { prepareTextureEffectV1 } from '../video-texture-v1.ts';
import { prepareDehazeEffectV1 } from '../video-dehaze-v1.ts';
import { postCropVignetteWeightV1, preparePostCropVignetteEffectV1 } from '../video-post-crop-vignette-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { captureLinearKernelDescriptorV1, captureLinearKernelPlanesV1, captureLinearKernelScratchV1, writeLinearKernelPixelV1,
	linearKernelEncodedV1 as encoded, linearKernelDecodedV1 as decoded, type LinearKernelDescriptorV1 } from './linear-kernel-planes-v1.ts';
import { LINEAR_BINOMIAL3_V1, LINEAR_BINOMIAL5_V1, LINEAR_BINOMIAL7_V1, linearSpatialLumaV1, linearSpatialMeanV1, linearSpatialDarkV1, linearSpatialUnitV1 } from './linear-spatial-neighborhood-v1.ts';
import { writeLinearSpatialNoiseV1 } from './linear-spatial-noise-v1.ts';

type Spatial = ReturnType<typeof prepareDetailSharpenEffectV1> | ReturnType<typeof prepareClarityEffectV1> | ReturnType<typeof prepareNoiseReductionEffectV1>
	| ReturnType<typeof prepareGrainEffectV1> | ReturnType<typeof prepareTextureEffectV1> | ReturnType<typeof prepareDehazeEffectV1> | ReturnType<typeof preparePostCropVignetteEffectV1>;
export interface PreparedLinearSpatialEffectV1 {
	readonly id: string; readonly type: Spatial['type']; readonly enabled: boolean; readonly neutral: boolean;
	readonly descriptor: LinearKernelDescriptorV1; readonly scratchBytes: 0;
}
const PREPARED = new WeakMap<object, Spatial>();

/** Metadata-only admission. The immutable source is the neighborhood plane,
 * and the caller supplies the destination, so no frame-sized scratch is used. */
export function prepareLinearSpatialEffectV1(value: unknown, descriptor: unknown): Readonly<PreparedLinearSpatialEffectV1> {
	const input = record(value, 'linear spatial effect', ['id', 'type', 'enabled', 'params']), type = field(input, 'type', 'linear spatial effect');
	const id = field(input, 'id', 'linear spatial effect');
	if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new TypeError('Linear spatial effect requires a bounded ID.');
	let effect: Spatial;
	switch (type) {
		case 'detail-sharpen-v1': effect = prepareDetailSharpenEffectV1(input); break;
		case 'clarity-v1': effect = prepareClarityEffectV1(input); break;
		case 'noise-reduction-v1': effect = prepareNoiseReductionEffectV1(input); break;
		case 'grain-v1': effect = prepareGrainEffectV1(input); break;
		case 'texture-v1': effect = prepareTextureEffectV1(input); break;
		case 'dehaze-v1': effect = prepareDehazeEffectV1(input); break;
		case 'post-crop-vignette-v1': effect = preparePostCropVignetteEffectV1(input); break;
		default: throw new RangeError('Unsupported linear spatial effect family.');
	}
	const prepared = Object.freeze({ id, type: effect.type, enabled: effect.enabled,
		neutral: effect.neutral, descriptor: captureLinearKernelDescriptorV1(descriptor), scratchBytes: 0 as const });
	PREPARED.set(prepared, effect); return prepared;
}

/** Native Float32 owner-to-owner stage. All encoded-domain algebra remains
 * continuous; only authored Q8 controls, geometric coverage and seeded grain
 * lattice retain their existing discrete definitions. RGB never gamut clips. */
export async function writeLinearSpatialEffectV1(prepared: PreparedLinearSpatialEffectV1, sourceValue: Float32Array<ArrayBuffer>, targetValue: Float32Array<ArrayBuffer>,
	scratchValue: Uint8Array<ArrayBuffer>, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const effect = PREPARED.get(prepared); if (!effect) throw new TypeError('An owning linear spatial preparation is required.');
	const planes = captureLinearKernelPlanesV1(prepared.descriptor, sourceValue, targetValue), { source, target } = planes;
	const scratch = captureLinearKernelScratchV1(scratchValue, prepared.scratchBytes, [source.buffer, target.buffer]);
	const check = () => { checkRepairSignalV1(signal); planes.check(); scratch.check(); }; check();
	const { width, height } = prepared.descriptor, rgb = { red: 0, green: 0, blue: 0 };
	let processed = 0;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const offset = 4 * (y * width + x), alpha = source[offset + 3]!;
		if (!effect.enabled || effect.neutral || alpha === 0) {
			writeLinearKernelPixelV1(target, offset, source[offset]!, source[offset + 1]!, source[offset + 2]!, alpha);
		} else {
			const red = encoded(source[offset]!), green = encoded(source[offset + 1]!), blue = encoded(source[offset + 2]!);
			rgb.red = red; rgb.green = green; rgb.blue = blue;
			switch (effect.type) {
				case 'detail-sharpen-v1':
					for (let channel = 0; channel < 3; channel++) {
						const original = channel === 0 ? red : channel === 1 ? green : blue;
						const delta = original - linearSpatialMeanV1(source, width, height, x, y, LINEAR_BINOMIAL3_V1, channel as 0 | 1 | 2);
						const result = Math.abs(delta) * 255 <= effect.threshold ? original : original + delta * effect.gainQ8 / 256;
						if (channel === 0) rgb.red = result; else if (channel === 1) rgb.green = result; else rgb.blue = result;
					} break;
				case 'clarity-v1': {
					const luma = linearSpatialLumaV1(red, green, blue), blur = linearSpatialMeanV1(source, width, height, x, y, LINEAR_BINOMIAL7_V1, -1);
					const gate = linearSpatialUnitV1(2 * Math.min(luma, 1 - luma) * 255 / 254), delta = (luma - blur) * effect.gainQ8 / 256 * gate;
					rgb.red += delta; rgb.green += delta; rgb.blue += delta; break;
				}
				case 'texture-v1': {
					const fine = linearSpatialMeanV1(source, width, height, x, y, LINEAR_BINOMIAL3_V1, -1), coarse = linearSpatialMeanV1(source, width, height, x, y, LINEAR_BINOMIAL5_V1, -1);
					const gate = linearSpatialUnitV1(1 - 4 * 255 * Math.abs(linearSpatialLumaV1(red, green, blue) - coarse) / 256), delta = (fine - coarse) * effect.gainQ8 / 256 * gate;
					rgb.red += delta; rgb.green += delta; rgb.blue += delta; break;
				}
				case 'noise-reduction-v1': writeLinearSpatialNoiseV1(effect, source, width, height, x, y, red, green, blue, rgb); break;
				case 'grain-v1': {
					const response = linearSpatialUnitV1(2 * Math.min(linearSpatialLumaV1(red, green, blue), 1 - linearSpatialLumaV1(red, green, blue)));
					const delta = grainNoiseV1(effect, x, y) * effect.amountQ8 / 256 * response / 1024;
					rgb.red += delta; rgb.green += delta; rgb.blue += delta; break;
				}
				case 'dehaze-v1': {
					const transmission = effect.gainQ8 > 0 ? Math.max(26 / 256, 1 - linearSpatialDarkV1(source, width, height, x, y) * effect.gainQ8 / 256 * 243 / 256) : 1;
					if (effect.gainQ8 < 0) { rgb.red += (1 - red) * effect.fogQ8 / 256; rgb.green += (1 - green) * effect.fogQ8 / 256; rgb.blue += (1 - blue) * effect.fogQ8 / 256; }
					else { rgb.red = 1 + (red - 1) / transmission; rgb.green = 1 + (green - 1) / transmission; rgb.blue = 1 + (blue - 1) / transmission; } break;
				}
				case 'post-crop-vignette-v1': {
					const weight = postCropVignetteWeightV1(effect, width, height, x, y) / 256;
					const protection = effect.amountQ8 < 0 ? linearSpatialUnitV1(Math.max(red, green, blue)) * effect.highlightsQ8 / 256 : 0;
					const amount = Math.abs(effect.amountQ8) / 256 * weight * (1 - protection), destination = effect.amountQ8 < 0 ? 0 : 1;
					rgb.red += (destination - red) * amount; rgb.green += (destination - green) * amount; rgb.blue += (destination - blue) * amount; break;
				}
			}
			writeLinearKernelPixelV1(target, offset, rgb.red === red ? source[offset]! : decoded(rgb.red), rgb.green === green ? source[offset + 1]! : decoded(rgb.green), rgb.blue === blue ? source[offset + 2]! : decoded(rgb.blue), alpha);
		}
		if (++processed === 2048) { processed = 0; await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(); }
	}
	check();
}
