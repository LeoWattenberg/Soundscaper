/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { PIXEL_FRAME_HARD_LIMITS_V1, readPixelFrameV1, type PixelFrameLimitsV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { normalizeImageDevelopRepairSpotsV1 } from './image-develop-repair-spots-v1.ts';
import { planImageDevelopRepairSpotsV1 } from './image-develop-repair-plan-v1.ts';
import { applyRepairHealV1 } from './pixel-frame-heal-screened-poisson-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { blendRepairSampleV1, repairCoverageV1, sampleRepairDonorV1 } from './pixel-frame-repair-sampling-v1.ts';

export interface RepairPixelFrameProfileV1 { readonly limits: PixelFrameLimitsV1; }

/** Explicit original-space foundation. No provenance or persisted recipe is
 * inferred: all spots and the complete serial work ledger are admitted before
 * source pixels. Capture one immutable native original before the first await;
 * only destination RGB is ordered. The consumer borrows one same-extent output
 * until settlement, then snapshot, output and each joined patch are retired. */
export async function withRepairSpotsPixelFrameV1<Result>(
	value: unknown,
	consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>,
	profile: Readonly<RepairPixelFrameProfileV1>,
): Promise<Result> {
	const input = record(value, 'repair frame request', ['frame', 'repairs', 'signal'], ['frame', 'repairs']);
	const signal = captureRepairSignalV1(Object.hasOwn(input, 'signal') ? field(input, 'signal', 'repair frame request') : undefined);
	const check = () => { checkRepairSignalV1(signal); }; check();
	const admitted = (() => {
		try {
			if (typeof consume !== 'function') throw new TypeError('Repair requires a scoped frame consumer.');
			const options = record(profile, 'repair frame profile', ['limits']);
			const limits = captureLimits(field(options, 'limits', 'repair frame profile'));
			const repairs = normalizeImageDevelopRepairSpotsV1(field(input, 'repairs', 'repair frame request'));
			const rawValue = field(input, 'frame', 'repair frame request');
			if (typeof rawValue !== 'object' || rawValue === null) throw new TypeError('Repair source frame must be an object.');
			// The owning field reader checks inert own data without inspecting the
			// pixels property. Full frame closure follows the complete work plan.
			const descriptor = field(rawValue as Readonly<Record<string, unknown>>, 'descriptor', 'repair source frame');
			const metadata = admitPixelFrameV1(descriptor, { limits });
			const plan = planImageDevelopRepairSpotsV1(repairs, metadata.descriptor.width, metadata.descriptor.height);
			check();
			const raw = record(rawValue, 'repair source frame', ['descriptor', 'pixels']);
			const source = readPixelFrameV1({ descriptor: metadata.descriptor, pixels: field(raw, 'pixels', 'repair source frame') }, limits);
			const pixels = source.pixels;
			if (source.descriptor.sampleFormat !== 'unorm8' || !(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) {
				throw new RangeError('Repair requires UNORM8 encoded sRGB pixels.');
			}
			check(); return { source: { descriptor: source.descriptor, pixels }, plan, byteLength: metadata.byteLength };
		} catch (error) { check(); throw error; }
	})();
	return withRepairPixelFrameLifetimeV1(async owner => {
		const original = owner.copy(admitted.source.pixels, admitted.byteLength);
		const output = owner.copy(original, admitted.byteLength), { width, height } = admitted.plan;
		const budget = new RepairTaskBudgetV1(check), sample = { red: 0, green: 0, blue: 0, alpha: 0 };
		for (const plan of admitted.plan.spots) {
			check();
			if (!plan.spot.enabled || plan.spot.opacity === 0 || plan.rectangle.width === 0 || plan.rectangle.height === 0) continue;
			if (plan.spot.mode === 'heal') { await applyRepairHealV1(original, output, width, height, plan, budget); continue; }
			const rectangle = plan.rectangle;
			for (let y = rectangle.y; y < rectangle.y + rectangle.height; y++) for (let x = rectangle.x; x < rectangle.x + rectangle.width; x++) {
				const amount = plan.spot.opacity * repairCoverageV1(plan, x + 0.5, y + 0.5), offset = (y * width + x) * 4;
				if (amount > 0 && original[offset + 3] !== 0) {
					sampleRepairDonorV1(original, width, height, x + 0.5 + plan.sourceDelta.x, y + 0.5 + plan.sourceDelta.y, sample);
					blendRepairSampleV1(output, offset, sample, amount);
				}
				if (budget.visit()) await budget.yield();
			}
		}
		check();
		const descriptor = Object.freeze({ ...admitted.source.descriptor, sampleFormat: 'unorm8' as const });
		const result = await consume(Object.freeze({ descriptor, pixels: output })); check(); return result;
	});
}

function captureLimits(value: unknown): Readonly<PixelFrameLimitsV1> {
	const names = ['maximumSidePixels', 'maximumPixels', 'maximumBytes'] as const;
	const raw = record(value, 'repair frame limits', names);
	const limits: { -readonly [Key in keyof PixelFrameLimitsV1]: number } = { ...PIXEL_FRAME_HARD_LIMITS_V1 };
	for (const name of names) {
		const maximum = field(raw, name, 'repair frame limits');
		if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum <= 0 || maximum > limits[name]) {
			throw new RangeError('Repair frame limit exceeds the hard pixel interchange ceiling.');
		}
		limits[name] = maximum;
	}
	return Object.freeze(limits);
}
