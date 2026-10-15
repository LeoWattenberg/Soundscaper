/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeImageDevelopStateCurrentV1 } from './image-develop-state-current-v1.ts';
import { withImageDevelopLinearFrameV1, type LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import type { ImageDevelopFrameProfile } from './image-develop-frame-core.ts';
import { prepareLinearColorEffectsV1, writeLinearColorChannelsV1 } from './pixel-frame-linear-color-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

/** Current continuous color route. The foundation owns the single native
 * Float32 snapshot/lifetime; color stages write that plane in authored order.
 * Source-native values are never converted through a byte preview. */
export async function withImageDevelopLinearCurrentV1<Result>(value: unknown,
	consume: (frame: Readonly<LinearWorkingPixelFrameV1>) => Result | Promise<Result>, profile: ImageDevelopFrameProfile): Promise<Result> {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Linear Develop signal must be an own data property.');
	const signal = captureRepairSignalV1(signalField?.value);
	const check = () => { checkRepairSignalV1(signal); };
	const prepared = (() => { try {
		check(); if (typeof consume !== 'function') throw new TypeError('Current linear Develop requires a scoped consumer.');
		const input = record(value, 'Current linear Develop', ['frame', 'develop', 'signal', 'maskOverlay'], ['frame', 'develop']);
		const develop = normalizeImageDevelopStateCurrentV1(field(input, 'develop', 'Current linear Develop'));
		if (Object.hasOwn(input, 'maskOverlay') || develop.masks.length || develop.maskBindings.length) throw new RangeError('Native RAW mask processing remains unavailable.');
		if (develop.geometry.crop || develop.geometry.rotationDegrees !== 0 || develop.geometry.flipHorizontal || develop.geometry.flipVertical) throw new RangeError('Native RAW geometry processing remains unavailable.');
		if (develop.processVersion === 3 && develop.repairs.spots.some(spot => spot.enabled)) throw new RangeError('Native RAW repair processing remains unavailable.');
		const effects = prepareLinearColorEffectsV1(develop.effects), frame = field(input, 'frame', 'Current linear Develop');
		const identity = normalizeImageDevelopStateCurrentV1({ ...develop, effects: [],
			...(develop.processVersion === 3 ? { repairs: { schemaVersion: 1, spots: [] } } : {}) });
		return { frame, identity, effects };
	} catch (error) { check(); throw error; } })();
	return withImageDevelopLinearFrameV1({ frame: prepared.frame, develop: prepared.identity, ...(signal ? { signal } : {}) }, async output => {
			const pixels = output.pixels, budget = new RepairTaskBudgetV1(check), rgb = { red: 0, green: 0, blue: 0 };
			for (const effect of prepared.effects) {
				for (let offset = 0; offset < pixels.length; offset += 4) {
					writeLinearColorChannelsV1(effect, pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, rgb);
					const red = Math.fround(rgb.red), green = Math.fround(rgb.green), blue = Math.fround(rgb.blue);
					if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) throw new RangeError('Current linear Develop exceeds finite Float32 range.');
					pixels[offset] = red; pixels[offset + 1] = green; pixels[offset + 2] = blue;
					if (budget.visit()) await budget.yield();
				}
			}
			check(); const result = await consume(output); check(); return result;
		}, profile);
}
