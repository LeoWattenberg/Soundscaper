/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../photo-library-develop-full-resolution-port-v1.ts';
import { preparePhotoDevelopMaskDisplayModeV1 } from '../photo-develop-mask-display-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameV1 } from './pixel-frame-contract-v1.ts';
import { fitPixelSizeV1 } from './pixel-frame-resize-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1, withRepairPixelFrameLifetimeV1 } from './pixel-frame-repair-lifetime-v1.ts';

export interface PhotoDevelopDisplayFrameV1 { readonly frame: Readonly<PixelFrameV1>; readonly overlay?: Readonly<PixelFrameV1>; }
const DISPLAY = Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16_777_216 });
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

/** Display-only nearest fitting. The full renderer and its observed coverage
 * remain borrowed until this scope settles. Proxy owns at most two 16 MiB RGBA
 * planes; full keeps natural extents and owns only the optional overlay plane.
 * Before's protective full copy is separately retired before repair rendering. */
export async function withPhotoDevelopDisplayFrameV1<Result>(value: unknown,
	consume: (view: Readonly<PhotoDevelopDisplayFrameV1>) => Result | Promise<Result>, resolution: 'proxy' | 'full'): Promise<Result> {
	const input = record(value, 'Photo display frame', ['frame', 'maskOverlay', 'maskOverlayMode', 'signal'], ['frame']);
	const signal = captureRepairSignalV1(Object.hasOwn(input, 'signal') ? field(input, 'signal', 'Photo display frame') : undefined);
	const check = () => { checkRepairSignalV1(signal); }; check();
	if (resolution !== 'proxy' && resolution !== 'full') throw new RangeError('Unknown Photo display resolution.');
	if (typeof consume !== 'function') throw new TypeError('Photo display requires a scoped consumer.');
	const limits = PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render;
	const raw = record(field(input, 'frame', 'Photo display frame'), 'Photo display source', ['descriptor', 'pixels']);
	const plan = admitPixelFrameV1(field(raw, 'descriptor', 'Photo display source'), { limits });
	const frame = readPixelFrameV1({ descriptor: plan.descriptor, pixels: field(raw, 'pixels', 'Photo display source') }, limits);
	const sourcePixels = frame.pixels;
	if (frame.descriptor.sampleFormat !== 'unorm8' || !(sourcePixels instanceof Uint8Array || sourcePixels instanceof Uint8ClampedArray)) throw new TypeError('Photo display requires RGBA8 pixels.');
	const { width, height } = frame.descriptor, size = resolution === 'proxy' ? fitPixelSizeV1(width, height, DISPLAY.maximumSidePixels, DISPLAY.maximumSidePixels) : { width, height };
	const displayPlan = admitPixelFrameV1({ ...frame.descriptor, ...size }, { limits: resolution === 'proxy' ? DISPLAY : limits });
	const mode = preparePhotoDevelopMaskDisplayModeV1(Object.hasOwn(input, 'maskOverlayMode') ? field(input, 'maskOverlayMode', 'Photo display frame') : undefined);
	const observed = Object.hasOwn(input, 'maskOverlay') ? record(field(input, 'maskOverlay', 'Photo display frame'), 'Photo observed coverage', ['maskId', 'effectId', 'width', 'height', 'coverage']) : undefined;
	const coverage = observed ? field(observed, 'coverage', 'Photo observed coverage') : undefined;
	if (observed && (field(observed, 'width', 'Photo observed coverage') !== width || field(observed, 'height', 'Photo observed coverage') !== height
		|| !(coverage instanceof Uint8Array) || Object.getPrototypeOf(coverage) !== Uint8Array.prototype
		|| ['buffer', 'byteLength', 'byteOffset', 'length'].some(key => Object.hasOwn(coverage, key))
		|| !(coverage.buffer instanceof ArrayBuffer) || (RESIZABLE && Reflect.apply(RESIZABLE, coverage.buffer, []) === true) || coverage.length !== width * height)) {
		throw new RangeError('Photo coverage does not match the full After extent.');
	}
	check();
	return withRepairPixelFrameLifetimeV1(async owner => {
		const pixels = resolution === 'proxy' ? owner.bytes(displayPlan.byteLength) : sourcePixels;
		const overlay = observed ? owner.bytes(displayPlan.byteLength) : undefined, budget = new RepairTaskBudgetV1(check);
		if (resolution === 'proxy' || overlay) for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
			const sample = Math.floor(y * height / size.height) * width + Math.floor(x * width / size.width), offset = (y * size.width + x) * 4;
			if (resolution === 'proxy') for (let channel = 0; channel < 4; channel++) pixels[offset + channel] = sourcePixels[sample * 4 + channel]!;
			if (overlay && coverage instanceof Uint8Array) {
				const c = coverage[sample]!; overlay[offset] = mode === 'grayscale' ? c : 255; overlay[offset + 1] = mode === 'grayscale' ? c : 48;
				overlay[offset + 2] = mode === 'grayscale' ? c : 48; overlay[offset + 3] = mode === 'grayscale' ? 255 : c;
			}
			if (budget.visit()) await budget.yield();
		}
		check(); const descriptor = Object.freeze({ ...frame.descriptor, ...size, sampleFormat: 'unorm8' as const });
		const result = await consume(Object.freeze({ frame: Object.freeze({ descriptor, pixels }), ...(overlay ? { overlay: Object.freeze({ descriptor, pixels: overlay }) } : {}) }));
		check(); return result;
	});
}
