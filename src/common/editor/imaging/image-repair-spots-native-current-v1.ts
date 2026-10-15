/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../photo-library-develop-full-resolution-port-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../photo-library-develop-linear-port-v1.ts';
import { defaultImageDevelopStateV2 } from './image-develop-state-v2.ts';
import { withImageDevelopLinearFrameV1 } from './image-develop-linear-frame-v1.ts';
import { LinearDevelopOwnerV1 } from './image-develop-linear-owner-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { prepareLinearRepairsV1, writeLinearRepairsV1 } from './pixel-frame-linear-repair-v1.ts';
import { withLinearPixelFrameDisplayV1 } from './pixel-frame-linear-display-v1.ts';
import { withRepairSpotsPixelFrameV1 } from './pixel-frame-repair-spots-v1.ts';
import { withRepairSpotsVisualizePixelFrameV1 } from './pixel-frame-repair-visualize-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

const WORKING_BYTES = 768 * 1024 * 1024;
// The full Original canvas can remain visible during Apply's serial demand.
const AUTHORING_DISPLAY_BYTES = 64 * 1024 * 1024;
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const PROFILES = Object.freeze([{ sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
	...['unorm16', 'float32'].flatMap(sampleFormat => ['srgb', 'bt709'].map(primaries => ({ sampleFormat, primaries, transfer: 'linear' })))]);

function sourceMetadata(value: unknown) {
	const input = record(value, 'Current repair Original frame', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(input, 'descriptor', 'Current repair Original frame'),
		{ profiles: PROFILES, limits: PHOTO_DEVELOP_LINEAR_LIMITS_V1.source });
	return { input, plan };
}
function physicalBytes(frame: Readonly<PixelFrameV1>): number {
	return Number(Reflect.apply(SIZE, Reflect.apply(BUFFER, frame.pixels, []), []));
}

/** The Current policy admits real linear words/floats without changing the
 * permanent byte author's profile or its Original-space dimensions. */
export function readImageRepairSpotsOriginalMetadataCurrentV1(value: unknown): Readonly<{ width: number; height: number }> {
	const { plan } = sourceMetadata(value);
	return Object.freeze({ width: plan.descriptor.width, height: plan.descriptor.height });
}

/** Full local Apply validation uses the same native Clone/Heal kernels as the
 * Current render pipeline. The borrowed Original, captured Float32 source,
 * destination and exact serial repair scratch are charged together. */
export async function validateImageRepairSpotsCurrentV1(frame: Readonly<PixelFrameV1>, repairs: unknown, signalValue?: AbortSignal): Promise<void> {
	const signal = captureRepairSignalV1(signalValue), { plan, input } = sourceMetadata(frame);
	if (plan.descriptor.sampleFormat === 'unorm8') {
		await withRepairSpotsPixelFrameV1({ frame, repairs, signal }, () => { checkRepairSignalV1(signal); },
			{ limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.source }); return;
	}
	const descriptor = { ...plan.descriptor, sampleFormat: 'float32' as const };
	const prepared = prepareLinearRepairsV1(repairs, descriptor, PHOTO_DEVELOP_LINEAR_LIMITS_V1.render);
	if (plan.byteLength + prepared.frameBytes * 2 + prepared.scratchBytes + AUTHORING_DISPLAY_BYTES > WORKING_BYTES) {
		throw new RangeError('Current repair authoring exceeds its 768 MiB working byte budget.');
	}
	const source = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(input, 'pixels', 'Current repair Original frame') }, PHOTO_DEVELOP_LINEAR_LIMITS_V1.source);
	const borrowedBytes = physicalBytes(source);
	if (borrowedBytes + prepared.frameBytes * 2 + prepared.scratchBytes + AUTHORING_DISPLAY_BYTES > WORKING_BYTES) {
		throw new RangeError('Current repair authoring physical backing exceeds its 768 MiB working byte budget.');
	}
	await withImageDevelopLinearFrameV1({ frame: source, develop: defaultImageDevelopStateV2(), signal }, output => {
		const owner = new LinearDevelopOwnerV1(borrowedBytes + prepared.frameBytes + AUTHORING_DISPLAY_BYTES, WORKING_BYTES);
		return owner.run(async () => {
			const target = owner.floats(prepared.frameBytes / 4), scratch = owner.bytes(prepared.scratchBytes);
			await writeLinearRepairsV1(prepared, output.pixels, target, scratch, signal);
		});
	}, PHOTO_DEVELOP_LINEAR_LIMITS_V1);
	checkRepairSignalV1(signal);
}

/** Presentation only: display encoding never feeds local repair validation.
 * Native edge diagnostics read linear source luma before any byte conversion. */
export async function withImageRepairSpotsDisplayCurrentV1<Result>(value: unknown,
	consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>): Promise<Result> {
	const signalData = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalData && !Object.hasOwn(signalData, 'value')) throw new TypeError('Current repair display signal must be own data.');
	const signal = captureRepairSignalV1(signalData?.value), check = () => { checkRepairSignalV1(signal); };
	const prepared = (() => { try {
		const input = record(value, 'Current repair display', ['frame', 'visualize', 'threshold', 'signal'], ['frame', 'visualize', 'threshold']);
		if (typeof consume !== 'function') throw new TypeError('Current repair display requires a joined consumer.');
		const visualize = field(input, 'visualize', 'Current repair display'), threshold = field(input, 'threshold', 'Current repair display');
		if (typeof visualize !== 'boolean') throw new TypeError('Current repair visualization must be boolean.');
		if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new RangeError('Edge threshold must be in [0,1].');
		const frame = field(input, 'frame', 'Current repair display') as Readonly<PixelFrameV1>;
		const metadata = sourceMetadata(frame); check(); return { frame, visualize, threshold, ...metadata };
	} catch (error) { check(); throw error; } })();
	if (prepared.plan.descriptor.sampleFormat === 'unorm8') {
		if (prepared.visualize) return withRepairSpotsVisualizePixelFrameV1({ frame: prepared.frame, threshold: prepared.threshold, signal }, consume,
			{ limits: PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.source });
		check(); const result = await consume(prepared.frame); check(); return result;
	}
	const frame = readPixelFrameV1({ descriptor: prepared.plan.descriptor,
		pixels: field(prepared.input, 'pixels', 'Current repair Original frame') }, PHOTO_DEVELOP_LINEAR_LIMITS_V1.source);
	if (!(frame.pixels instanceof Uint16Array || frame.pixels instanceof Float32Array)) throw new TypeError('Current repair diagnostics require native words or floats.');
	const { width, height } = prepared.plan.descriptor, byteLength = width * height * 4;
	const borrowedBytes = physicalBytes(frame), snapshotBytes = prepared.visualize ? prepared.plan.byteLength : 0;
	if (borrowedBytes + snapshotBytes + byteLength + AUTHORING_DISPLAY_BYTES > WORKING_BYTES) throw new RangeError('Current repair display physical backing exceeds its 768 MiB working byte budget.');
	if (!prepared.visualize) return withLinearPixelFrameDisplayV1({ frame, signal }, consume, 'full');
	const source = frame.pixels, isWord = source instanceof Uint16Array;
	return withRepairPixelFrameLifetimeV1(async owner => {
		const snapshot = owner.copy(new Uint8Array(source.buffer, source.byteOffset, source.byteLength), prepared.plan.byteLength);
		const samples = isWord ? new Uint16Array(snapshot.buffer) : new Float32Array(snapshot.buffer), scale = isWord ? 1 / 65535 : 1;
		const pixels = owner.bytes(byteLength), budget = new RepairTaskBudgetV1(check);
		const luma = (offset: number) => (.2126 * samples[offset]! + .7152 * samples[offset + 1]! + .0722 * samples[offset + 2]!) * scale;
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const offset = (y * width + x) * 4; let contrast = 0;
			if (samples[offset + 3] !== 0) {
				const center = luma(offset);
				for (let direction = 0; direction < 4; direction++) {
					const nx = x + (direction === 0 ? -1 : direction === 1 ? 1 : 0), ny = y + (direction === 2 ? -1 : direction === 3 ? 1 : 0);
					if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
					const neighbor = (ny * width + nx) * 4;
					if (samples[neighbor + 3] !== 0) contrast = Math.max(contrast, Math.abs(center - luma(neighbor)));
				}
			}
			const intensity = Math.round(255 * Math.max(0, Math.min(1, 4 * (contrast - prepared.threshold))));
			pixels[offset] = intensity; pixels[offset + 1] = intensity; pixels[offset + 2] = intensity; pixels[offset + 3] = 255;
			if (budget.visit()) await budget.yield();
		}
		await budget.yield(); check();
		const result = await consume(Object.freeze({ descriptor: Object.freeze({ schemaVersion: 1 as const, width, height,
			sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const }), pixels }));
		check(); return result;
	});
}
