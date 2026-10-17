/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../photo-library-develop-full-resolution-port-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameLimitsV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { decodeRepairByteV1 } from './pixel-frame-repair-sampling-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

/** Original edge contrast aid, not automatic dust detection. Partial alpha
 * establishes eligibility without a second attenuation; hidden RGB is ignored.
 * Own snapshot + diagnostic are at most 128 MiB under the 64 MiB Original cap.
 * The borrowed Original adds one source plane, with no luma/float frame cache. */
export async function withRepairSpotsVisualizePixelFrameV1<Result>(value: unknown,
	consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, profile: Readonly<{ limits: PixelFrameLimitsV1 }>): Promise<Result> {
	const input = record(value, 'repair visualization', ['frame', 'threshold', 'signal'], ['frame']);
	const signal = captureRepairSignalV1(Object.hasOwn(input, 'signal') ? field(input, 'signal', 'repair visualization') : undefined);
	const check = () => { checkRepairSignalV1(signal); }; check();
	const threshold = Object.hasOwn(input, 'threshold') ? field(input, 'threshold', 'repair visualization') : .02;
	if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError('Edge threshold must be in [0,1].');
	if (typeof consume !== 'function') throw new TypeError('Repair visualization requires a consumer.');
	const options = record(profile, 'repair visualization profile', ['limits']), limits = field(options, 'limits', 'repair visualization profile');
	const raw = record(field(input, 'frame', 'repair visualization'), 'repair visualization source', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(raw, 'descriptor', 'repair visualization source'), { limits });
	admitPixelFrameV1(plan.descriptor, { limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.source });
	const frame = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(raw, 'pixels', 'repair visualization source') }, limits);
	const sourcePixels = frame.pixels;
	if (frame.descriptor.sampleFormat !== 'unorm8' || !(sourcePixels instanceof Uint8Array || sourcePixels instanceof Uint8ClampedArray)) throw new TypeError('Edge visualization requires encoded sRGB RGBA8.');
	check();
	return withRepairPixelFrameLifetimeV1(async owner => {
		const original = owner.copy(sourcePixels, plan.byteLength), pixels = owner.bytes(plan.byteLength), { width, height } = plan.descriptor;
		const luma = (offset: number) => .2126 * decodeRepairByteV1(original[offset]!) + .7152 * decodeRepairByteV1(original[offset + 1]!) + .0722 * decodeRepairByteV1(original[offset + 2]!);
		const budget = new RepairTaskBudgetV1(check);
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4; let contrast = 0;
			if (original[offset + 3] !== 0) {
				const center = luma(offset);
				for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
					if (nx! < 0 || nx! >= width || ny! < 0 || ny! >= height) continue;
					const neighbor = (ny! * width + nx!) * 4;
					if (original[neighbor + 3] !== 0) contrast = Math.max(contrast, Math.abs(center - luma(neighbor)));
				}
			}
			const intensity = Math.round(255 * Math.max(0, Math.min(1, 4 * (contrast - threshold))));
			pixels[offset] = intensity; pixels[offset + 1] = intensity; pixels[offset + 2] = intensity; pixels[offset + 3] = 255;
			if (budget.visit()) await budget.yield();
		}
		// The terminal yield also gives a exactly-one-chunk frame native cancel a
		// chance before consumer delivery, without weakening the scalar budget.
		await budget.yield(); check();
		const result = await consume(Object.freeze({ descriptor: Object.freeze({ ...plan.descriptor, sampleFormat: 'unorm8' as const }), pixels })); check(); return result;
	});
}
