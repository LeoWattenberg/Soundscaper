/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { withVideoMaskMatteRgbaV1, withVideoMaskMatteBrushScopeV1 } from '../video-mask-matte-rgba-v13.ts';
import { captureVideoMaskLuminanceFrameV1, videoMaskMatteUsesCurrentFrameV1 } from '../video-mask-luminance-range-v1.ts';
import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import type { ImageDevelopFrameProfile } from './image-develop-frame-core.ts';
import { planImageGeometryV1 } from './image-geometry-plan-v1.ts';
import { IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1, planImageDevelopMasksV1, type ImageDevelopMaskBindingPlanV1 } from './image-develop-mask-plan-v1.ts';
import { withGeometryPixelFrameV1 } from './pixel-frame-geometry-v1.ts';
import type { PixelFrameDescriptorV1 } from './pixel-frame-contract-v1.ts';
import type { MaskRasterSourcePortV1 } from './mask-raster-source-port-v1.ts';
import { captureMaskRasterSourceV1, withMaskRasterSourceScopeV1 } from './mask-raster-source-scope-v1.ts';
import { admitImageDevelopBrushMaskAuthorityV1, prepareImageDevelopBrushMasksV1 } from './image-develop-brush-mask-v1.ts';

export interface ImageDevelopMaskOverlaySelectionV1 { readonly maskId: string; readonly effectId: string }
export interface ImageDevelopMaskOverlayOptionsV1 { readonly maskSource?: MaskRasterSourcePortV1 }
export interface ImageDevelopMaskOverlayViewV1 extends ImageDevelopMaskOverlaySelectionV1 {
	readonly maskId: string;
	readonly effectId: string;
	readonly width: number;
	readonly height: number;
	readonly coverage: Uint8Array<ArrayBuffer>;
}
const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const FILL = Uint8Array.prototype.fill;
const CHUNK_PIXELS = 65_536;

export function prepareImageDevelopMaskOverlaySelectionV1(value: unknown): Readonly<ImageDevelopMaskOverlaySelectionV1> {
	const input = record(value, 'mask overlay selection', ['maskId', 'effectId']);
	const maskId = field(input, 'maskId', 'mask overlay selection'), effectId = field(input, 'effectId', 'mask overlay selection');
	if (typeof maskId !== 'string' || typeof effectId !== 'string' || !maskId || !effectId || maskId.length > 128 || effectId.length > 128) {
		throw new TypeError('Mask overlay requires bounded retained mask/effect IDs.');
	}
	return Object.freeze({ maskId, effectId });
}

/** Account projection scratch plus any plane retained by the joined renderer. */
export function assertImageDevelopMaskOverlayBudgetV1(binding: Readonly<ImageDevelopMaskBindingPlanV1>, retainedBytes = 0): void {
	let width = binding.width, height = binding.height, largest = BigInt(width) * BigInt(height);
	for (const geometry of binding.suffixGeometry) {
		const next = planImageGeometryV1(geometry, width, height); width = next.width; height = next.height;
		const count = BigInt(width) * BigInt(height); if (count > largest) largest = count;
	}
	const scratch = binding.suffixGeometry.length ? largest * 13n : 0n;
	if (BigInt(binding.workingBytes) + scratch + BigInt(retainedBytes) > BigInt(IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1)) {
		throw new RangeError('Mask overlay projection exceeds its working byte budget.');
	}
}

/** Evaluate at the explicitly selected effect's input extent, then project
 * through its real geometry suffix. The geometry kernel filters alpha with
 * bilinear sampling, crop-edge extension and transparent rotated apertures.
 * Every coverage/RGBA plane is owned here and borrowed only until settlement. */
export async function withImageDevelopMaskOverlayV1<Result>(value: unknown,
	consume: (view: Readonly<ImageDevelopMaskOverlayViewV1>) => Result | Promise<Result>,
	profile: ImageDevelopFrameProfile, optionsValue: ImageDevelopMaskOverlayOptionsV1 = {}): Promise<Result> {
	const request = record(value, 'Develop mask overlay', ['develop', 'source', 'maskId', 'effectId', 'signal', 'currentFrame'], ['develop', 'source', 'maskId', 'effectId']);
	const signal = Object.hasOwn(request, 'signal') ? field(request, 'signal', 'Develop mask overlay') : undefined;
	if (signal !== undefined) {
		if (typeof signal !== 'object' || signal === null) throw new TypeError('Mask overlay requires a native cancellation signal.');
		Reflect.apply(CHECK, signal, []);
		if (Object.getPrototypeOf(signal) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) {
			throw new TypeError('Mask overlay requires native cancellation behavior without overrides.');
		}
	}
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); if (typeof consume !== 'function') throw new TypeError('Mask overlay requires a scoped consumer.');
	const options = record(optionsValue, 'mask overlay resource options', ['maskSource'], []);
	const rawMaskSource = Object.hasOwn(options, 'maskSource') ? field(options, 'maskSource', 'mask overlay resource options') : undefined;
	const developValue = field(request, 'develop', 'Develop mask overlay');
	const develop = rawMaskSource === undefined ? developValue : admitImageDevelopBrushMaskAuthorityV1(developValue);
	const source = record(field(request, 'source', 'Develop mask overlay'), 'mask overlay source extent', ['width', 'height']);
	const original = admitPixelFrameV1({ schemaVersion: 1, width: field(source, 'width', 'mask overlay source extent'), height: field(source, 'height', 'mask overlay source extent'),
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, { limits: profile.source });
	const maskId = field(request, 'maskId', 'Develop mask overlay'), effectId = field(request, 'effectId', 'Develop mask overlay');
	const selection = prepareImageDevelopMaskOverlaySelectionV1({ maskId, effectId });
	const brushPlan = rawMaskSource === undefined ? undefined : prepareImageDevelopBrushMasksV1(develop, original.descriptor.width, original.descriptor.height, profile.render, selection);
	const plan = brushPlan?.plan ?? planImageDevelopMasksV1(develop, original.descriptor.width, original.descriptor.height, profile.render);
	const binding = plan.bindings.find(candidate => candidate.maskId === maskId && candidate.effectId === effectId);
	if (!binding) throw new RangeError('Mask overlay requires one retained mask/effect binding.');
	assertImageDevelopMaskOverlayBudgetV1(binding);
	const currentFrame = Object.hasOwn(request, 'currentFrame') ? field(request, 'currentFrame', 'Develop mask overlay') : undefined;
	const requestValue = { graph: binding.graph, width: binding.width, height: binding.height, signal, currentFrame };
	const project = (coverage: Uint8Array<ArrayBuffer>) => withProjectedImageDevelopMaskCoverageV1(binding, coverage, consume, profile, signal as AbortSignal | undefined);
	if (!brushPlan) return withVideoMaskMatteRgbaV1(requestValue, project);
	const usesCurrentFrame = videoMaskMatteUsesCurrentFrameV1(binding.graph);
	// This standalone owner retains a pre-await snapshot while the evaluator
	// owns its independent current-frame copy. Charge their actual overlap.
	const snapshotBytes = usesCurrentFrame ? BigInt(binding.width) * BigInt(binding.height) * 4n : 0n;
	if (BigInt(brushPlan.peakWorkingBytes) + snapshotBytes > BigInt(IMAGE_DEVELOP_MASK_WORKING_LIMIT_V1)) {
		throw new RangeError('Brush overlay snapshots exceed their 64 MiB working budget.');
	}
	const maskSource = captureMaskRasterSourceV1(rawMaskSource);
	const captured = usesCurrentFrame ? captureVideoMaskLuminanceFrameV1(currentFrame, binding.width, binding.height) : undefined;
	try {
		const snapshot = captured ? { descriptor: { schemaVersion: 1, width: binding.width, height: binding.height,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: captured.transfer }, pixels: captured.pixels } : undefined;
		return await withMaskRasterSourceScopeV1(brushPlan.references, brushPlan.retainedStorageKeys, maskSource, scope =>
			withVideoMaskMatteBrushScopeV1({ ...requestValue, currentFrame: snapshot }, project, scope), signal as AbortSignal | undefined);
	} finally { if (captured) wipe(captured.pixels); }
}

/** Project the exact coverage already used by a selected adjustment. */
export async function withProjectedImageDevelopMaskCoverageV1<Result>(binding: Readonly<ImageDevelopMaskBindingPlanV1>, coverage: Uint8Array<ArrayBuffer>,
	consume: (view: Readonly<ImageDevelopMaskOverlayViewV1>) => Result | Promise<Result>, profile: ImageDevelopFrameProfile, signal?: AbortSignal): Promise<Result> {
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check(); assertImageDevelopMaskOverlayBudgetV1(binding);
	if (coverage.length !== binding.width * binding.height) throw new RangeError('Mask coverage does not match the selected effect input.');
	if (!binding.suffixGeometry.length) {
		const result = await consume(Object.freeze({ maskId: binding.maskId, effectId: binding.effectId, width: binding.width, height: binding.height, coverage })); check(); return result;
	}
	let pixels = new Uint8Array(coverage.length * 4);
	let descriptor: Readonly<PixelFrameDescriptorV1> = Object.freeze({ schemaVersion: 1, width: binding.width, height: binding.height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
	let projected: Uint8Array<ArrayBuffer> | undefined;
	let projectedBacking: ArrayBuffer | undefined;
	try {
		await copyAlpha(coverage, pixels, false, check);
		for (const geometry of binding.suffixGeometry) {
			let staged: Uint8Array<ArrayBuffer> | undefined;
			try {
				await withGeometryPixelFrameV1({ frame: { descriptor, pixels }, geometry, signal }, frame => {
					staged = new Uint8Array(frame.pixels); descriptor = frame.descriptor;
				}, { limits: profile.render });
				if (!staged) throw new Error('Mask overlay geometry produced no coverage.');
				wipe(pixels); pixels = staged;
			} catch (error) { if (staged) wipe(staged); throw error; }
		}
		projected = new Uint8Array(descriptor.width * descriptor.height); projectedBacking = projected.buffer;
		await copyAlpha(pixels, projected, true, check); check();
		const result = await consume(Object.freeze({ maskId: binding.maskId, effectId: binding.effectId, width: descriptor.width, height: descriptor.height, coverage: projected })); check(); return result;
	} finally { wipe(pixels); if (projectedBacking) wipeBacking(projectedBacking); }
}

async function copyAlpha(source: Uint8Array, target: Uint8Array, extract: boolean, check: () => void): Promise<void> {
	const count = extract ? target.length : source.length;
	for (let start = 0; start < count; start += CHUNK_PIXELS) {
		check(); const end = Math.min(count, start + CHUNK_PIXELS);
		for (let index = start; index < end; index++) {
			if (extract) target[index] = source[index * 4 + 3]!; else target[index * 4 + 3] = source[index]!;
		}
		if (end < count) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check(); }
	}
}
function wipe(bytes: Uint8Array): void { if (Number(Reflect.apply(BUFFER_SIZE, bytes.buffer, []))) Reflect.apply(FILL, bytes, [0]); }
function wipeBacking(backing: ArrayBuffer): void { if (Number(Reflect.apply(BUFFER_SIZE, backing, []))) Reflect.apply(FILL, new Uint8Array(backing), [0]); }
