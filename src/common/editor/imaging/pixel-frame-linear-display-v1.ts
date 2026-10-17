/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../photo-library-develop-linear-port-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { fitPixelSizeV1 } from './pixel-frame-resize-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

const PROFILES = Object.freeze(['unorm16', 'float32'].flatMap(sampleFormat => ['srgb', 'bt709'].map(primaries =>
	Object.freeze({ sampleFormat, primaries, transfer: 'linear' }))));
const DISPLAY = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 });
const FULL = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 });

/** Final presentation boundary only. Source-native linear pixels stay borrowed
 * and unchanged through this scope. One fitted/full encoded plane is owned and
 * physically wiped after its joined consumer; no byte plane feeds development. */
export async function withLinearPixelFrameDisplayV1<Result>(value: unknown,
	consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, resolution: 'proxy' | 'full' = 'proxy'): Promise<Result> {
	const input = record(value, 'linear display request', ['frame', 'signal'], ['frame']);
	const signal = captureRepairSignalV1(Object.hasOwn(input, 'signal') ? field(input, 'signal', 'linear display request') : undefined);
	const check = () => { checkRepairSignalV1(signal); }; check();
	if (resolution !== 'proxy' && resolution !== 'full') throw new RangeError('Unknown linear display resolution.');
	if (typeof consume !== 'function') throw new TypeError('Linear display requires a scoped consumer.');
	const raw = record(field(input, 'frame', 'linear display request'), 'linear display source', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(raw, 'descriptor', 'linear display source'), { profiles: PROFILES, limits: PHOTO_DEVELOP_LINEAR_LIMITS_V1.source });
	const size = resolution === 'proxy' ? fitPixelSizeV1(plan.descriptor.width, plan.descriptor.height, 2048, 2048)
		: { width: plan.descriptor.width, height: plan.descriptor.height };
	const descriptor = Object.freeze({ schemaVersion: 1 as const, ...size, sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const });
	const output = admitPixelFrameV1(descriptor, { limits: resolution === 'proxy' ? DISPLAY : FULL });
	if (plan.byteLength + output.byteLength > 512 * 1024 * 1024) throw new RangeError('Linear display exceeds its 512 MiB byte budget.');
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(raw, 'pixels', 'linear display source') }, PHOTO_DEVELOP_LINEAR_LIMITS_V1.source);
	if (!(source.pixels instanceof Uint16Array || source.pixels instanceof Float32Array)) throw new TypeError('Linear display requires native words or floats.');
	const scale = source.pixels instanceof Uint16Array ? 1 / 65535 : 1;
	return withRepairPixelFrameLifetimeV1(async owner => {
		const pixels = owner.bytes(output.byteLength), budget = new RepairTaskBudgetV1(check);
		for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
			const from = (Math.floor(y * plan.descriptor.height / size.height) * plan.descriptor.width
				+ Math.floor(x * plan.descriptor.width / size.width)) * 4, to = (y * size.width + x) * 4;
			for (let channel = 0; channel < 3; channel++) {
				const linear = Math.max(0, Math.min(1, source.pixels[from + channel]! * scale));
				const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
				pixels[to + channel] = Math.round(encoded * 255);
			}
			pixels[to + 3] = Math.round(source.pixels[from + 3]! * scale * 255);
			if (budget.visit()) await budget.yield();
		}
		check(); const result = await consume(Object.freeze({ descriptor, pixels })); check(); return result;
	});
}
