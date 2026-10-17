/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../photo-library-develop-full-resolution-port-v1.ts';
import { preparePhotoDevelopMaskDisplayModeV1 } from '../photo-develop-mask-display-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1 } from './pixel-frame-contract-v1.ts';
import type { PhotoDevelopDisplayFrameV1 } from './photo-develop-display-frame-v1.ts';
import { prepareImageOutputColorProfileV1, writeImageOutputColorPixelV1 } from './image-output-color-profile-v1.ts';
import { fitPixelSizeV1 } from './pixel-frame-resize-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

const PROFILES = Object.freeze(['srgb', 'display-p3'].map(primaries => ({ sampleFormat: 'unorm8', primaries, transfer: 'srgb' })));
const DISPLAY = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 });
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const MAXIMUM = 512 * 1024 * 1024;

/** Current final-display policy, independent of the permanent sRGB widget.
 * Overlay colors are authored in sRGB and converted to the target primaries;
 * labeling unchanged red/48/48 codes as P3 would change their meaning. */
export async function withPhotoDevelopDisplayFrameCurrentV1<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopDisplayFrameV1>) => Result | Promise<Result>, resolution: 'proxy' | 'full'): Promise<Result> {
	const input = record(value, 'Current Photo display', ['frame', 'maskOverlay', 'maskOverlayMode', 'signal'], ['frame']);
	const signal = captureRepairSignalV1(Object.hasOwn(input, 'signal') ? field(input, 'signal', 'Current Photo display') : undefined);
	const check = () => { checkRepairSignalV1(signal); }; check();
	if (resolution !== 'proxy' && resolution !== 'full') throw new RangeError('Unknown Photo display resolution.');
	if (typeof consume !== 'function') throw new TypeError('Photo display requires a scoped consumer.');
	const limits = PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render, raw = field(input, 'frame', 'Current Photo display');
	if (typeof raw !== 'object' || raw === null) throw new TypeError('Current Photo display requires a frame.');
	const plan = admitPixelFrameV1(field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'Current Photo frame'), { profiles: PROFILES, limits });
	const admitted = record(raw, 'Current Photo frame', ['descriptor', 'pixels']);
	const frame = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(admitted, 'pixels', 'Current Photo frame') }, limits), source = frame.pixels;
	if (frame.descriptor.sampleFormat !== 'unorm8' || !(source instanceof Uint8Array || source instanceof Uint8ClampedArray)) throw new TypeError('Photo display requires encoded RGBA8.');
	const primaries = frame.descriptor.primaries;
	if (primaries !== 'srgb' && primaries !== 'display-p3') throw new RangeError('Unknown Photo display color profile.');
	const { width, height } = frame.descriptor, size = resolution === 'proxy' ? fitPixelSizeV1(width, height, 2048, 2048) : { width, height };
	const displayPlan = admitPixelFrameV1({ ...frame.descriptor, ...size }, { profiles: PROFILES, limits: resolution === 'proxy' ? DISPLAY : limits });
	const mode = preparePhotoDevelopMaskDisplayModeV1(Object.hasOwn(input, 'maskOverlayMode') ? field(input, 'maskOverlayMode', 'Current Photo display') : undefined);
	const observed = Object.hasOwn(input, 'maskOverlay') ? record(field(input, 'maskOverlay', 'Current Photo display'), 'Current Photo coverage', ['maskId', 'effectId', 'width', 'height', 'coverage']) : undefined;
	const coverage = observed ? field(observed, 'coverage', 'Current Photo coverage') : undefined;
	if (observed && (field(observed, 'width', 'Current Photo coverage') !== width || field(observed, 'height', 'Current Photo coverage') !== height
		|| !(coverage instanceof Uint8Array) || Object.getPrototypeOf(coverage) !== Uint8Array.prototype
		|| ['buffer', 'byteLength', 'byteOffset', 'length'].some(key => Object.hasOwn(coverage, key))
		|| !(coverage.buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, coverage.buffer, []) || coverage.length !== width * height)) {
		throw new RangeError('Photo coverage does not match the full After extent.');
	}
	const backing = source.buffer, sourceLength = Number(Reflect.apply(SIZE, backing, []));
	const coverageBacking = coverage instanceof Uint8Array ? coverage.buffer : undefined;
	const coverageLength = coverageBacking ? Number(Reflect.apply(SIZE, coverageBacking, [])) : 0;
	if (sourceLength + coverageLength + (resolution === 'proxy' ? displayPlan.byteLength : 0) + (observed ? displayPlan.byteLength : 0) + 4096 > MAXIMUM) {
		throw new RangeError('Current Photo display exceeds its512MiB physical budget.');
	}
	const current = () => { check(); if (Reflect.apply(SIZE, backing, []) !== sourceLength
		|| coverageBacking && Reflect.apply(SIZE, coverageBacking, []) !== coverageLength) throw new TypeError('Current Photo display source detached.'); };
	return withRepairPixelFrameLifetimeV1(async owner => {
		const pixels = resolution === 'proxy' ? owner.bytes(displayPlan.byteLength) : source;
		const overlay = observed ? owner.bytes(displayPlan.byteLength) : undefined, codes = observed ? new Float64Array(owner.bytes(32).buffer) : undefined;
		const color = observed ? prepareImageOutputColorProfileV1({ profile: primaries, bitDepth: 8, source: 'encoded-srgb8' }) : undefined;
		const budget = new RepairTaskBudgetV1(current);
		if (resolution === 'proxy' || overlay) for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
			const sample = Math.floor(y * height / size.height) * width + Math.floor(x * width / size.width), at = (y * size.width + x) * 4;
			if (resolution === 'proxy') for (let channel = 0; channel < 4; channel++) pixels[at + channel] = source[sample * 4 + channel]!;
			if (overlay && coverage instanceof Uint8Array && codes && color) {
				const c = coverage[sample]!; writeImageOutputColorPixelV1(color, mode === 'grayscale' ? c : 255,
					mode === 'grayscale' ? c : 48, mode === 'grayscale' ? c : 48, mode === 'grayscale' ? 255 : c, codes);
				for (let channel = 0; channel < 4; channel++) overlay[at + channel] = codes[channel]!;
			}
			if (budget.visit()) await budget.yield();
		}
		current(); const descriptor = Object.freeze({ ...frame.descriptor, ...size, sampleFormat: 'unorm8' as const });
		const result = await consume(Object.freeze({ frame: Object.freeze({ descriptor, pixels }), ...(overlay ? { overlay: Object.freeze({ descriptor, pixels: overlay }) } : {}) }));
		current(); return result;
	});
}
