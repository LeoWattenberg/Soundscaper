/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { readPixelFrameV1 } from './pixel-frame-contract-v1.ts';
import type { LinearWorkingPixelFrameV1 } from './image-develop-linear-frame-v1.ts';
import type { ImageDevelopFrameProfile } from './image-develop-frame-core.ts';
import type { ImageDevelopFrameOptionsV3 } from './image-develop-frame-v3.ts';
import { prepareLinearDevelopCurrentV1, CURRENT_LINEAR_WORKING_BYTES_V1 } from './image-develop-linear-plan-v1.ts';
import { LinearDevelopOwnerV1 } from './image-develop-linear-owner-v1.ts';
import { writeLinearColorChannelsV1 } from './pixel-frame-linear-color-v1.ts';
import { writeLinearGeometryV1 } from './pixel-frame-linear-geometry-v1.ts';
import { writeLinearSpatialEffectV1 } from './pixel-frame-linear-spatial-v1.ts';
import { writeLinearRepairsV1 } from './pixel-frame-linear-repair-v1.ts';
import { writeLinearLensDistortionV1 } from './pixel-frame-linear-lens-distortion-v1.ts';
import { writeLinearChromaticAberrationV1 } from './pixel-frame-linear-chromatic-aberration-v1.ts';
import { writeLinearDefringeV1 } from './pixel-frame-linear-defringe-v1.ts';
import { writeLinearLutStageV1 } from './image-develop-linear-lut-stage-v1.ts';
import { withLinearMaskCoverageV1, blendLinearMaskCoverageV1 } from './pixel-frame-linear-mask-v1.ts';
import { withMaskRasterSourceScopeV1, type MaskRasterSourceScopeV1 } from './mask-raster-source-scope-v1.ts';
import type { ImageDevelopMaskOverlayViewV1 } from './image-develop-mask-overlay-v1.ts';
import { withProjectedImageDevelopMaskCoverageCurrentV1 } from './image-develop-mask-overlay-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1, RepairTaskBudgetV1 } from './pixel-frame-repair-lifetime-v1.ts';

const TYPED_BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')!.get!;
const BACKING_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;

/** Current native-depth multistage owner. Original capture finishes before the
 * first await. Repairs borrow that stable capture before geometry/effects;
 * stages replace and retire Float32 planes without an encoded intermediate. */
export async function withImageDevelopLinearCurrentV1<Result>(value: unknown,
	consume: (frame: Readonly<LinearWorkingPixelFrameV1>, maskOverlay?: Readonly<ImageDevelopMaskOverlayViewV1>) => Result | Promise<Result>,
	profile: ImageDevelopFrameProfile, options: ImageDevelopFrameOptionsV3 = {}): Promise<Result> {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Linear Develop signal must be an own data property.');
	const signal = captureRepairSignalV1(signalField?.value), check = () => { checkRepairSignalV1(signal); };
	const prepared = (() => { try {
		check(); if (typeof consume !== 'function') throw new TypeError('Current linear Develop requires a scoped consumer.');
		const prepared = prepareLinearDevelopCurrentV1(value, profile, options); check(); return prepared;
	} catch (error) { check(); throw error; } })();
	const source = (() => { try {
		const raw = record(prepared.raw, 'Current linear source', ['descriptor', 'pixels']);
		const frame = readPixelFrameV1({ descriptor: prepared.sourcePlan.descriptor, pixels: field(raw, 'pixels', 'Current linear source') }, prepared.profile.source);
		if (!(frame.pixels instanceof Float32Array || frame.pixels instanceof Uint16Array)) throw new TypeError('Current linear source requires native words or floats.');
		check(); return frame;
	} catch (error) { check(); throw error; } })();
	const borrowedBytes = Number(Reflect.apply(BACKING_SIZE, Reflect.apply(TYPED_BUFFER, source.pixels, []), []));
	const physicalPeak = prepared.peakWorkingBytes + borrowedBytes - prepared.sourcePlan.byteLength;
	if (physicalPeak > CURRENT_LINEAR_WORKING_BYTES_V1) throw new RangeError('Current linear Develop exceeds its 768 MiB physical backing budget.');
	check(); const owner = new LinearDevelopOwnerV1(borrowedBytes, physicalPeak);
	return owner.run(async () => {
		const initial = owner.floats(prepared.descriptor.width * prepared.descriptor.height * 4);
		if (source.pixels instanceof Float32Array) Float32Array.prototype.set.call(initial, source.pixels);
		else for (let index = 0; index < initial.length; index++) initial[index] = source.pixels[index]! / 65535;
		let current: Readonly<LinearWorkingPixelFrameV1> = Object.freeze({ descriptor: prepared.descriptor, pixels: initial });
		let currentBacking = initial.buffer, overlay: Readonly<ImageDevelopMaskOverlayViewV1> | undefined;
		const replace = (pixels: Float32Array<ArrayBuffer>, descriptor = current.descriptor) => {
			owner.retire(currentBacking); currentBacking = pixels.buffer; current = Object.freeze({ descriptor, pixels });
		};
		check();
		if (prepared.repairs) {
			const next = owner.floats(current.pixels.length), scratch = owner.bytes(prepared.repairs.scratchBytes), backing = scratch.buffer;
			await writeLinearRepairsV1(prepared.repairs, current.pixels, next, scratch, signal);
			owner.retire(backing); replace(next);
		}
		const render = async (scope?: Readonly<MaskRasterSourceScopeV1>): Promise<Result> => {
			const observe = async (id: string, work?: () => Promise<Float32Array<ArrayBuffer>>,
				copiedChannels?: Readonly<{ red: boolean; blue: boolean }> | 'unchanged') => {
				const binding = prepared.masks.plan.bindings.find(binding => binding.effectId === id);
				const next = work ? await work() : undefined;
				if (binding && (next || binding === prepared.selectedBinding)) await withLinearMaskCoverageV1(binding, current, async coverage => {
					if (next) {
						if (copiedChannels === 'unchanged') await blendDefringeMaskCurrentV1(current, next, coverage, signal);
						else await blendLinearMaskCoverageV1(current, next, coverage, signal);
						// CA's reference channels are literal copies. Fractional blend
						// arithmetic must not turn their negative zero into positive zero.
						if (copiedChannels && copiedChannels !== 'unchanged') {
							const budget = new RepairTaskBudgetV1(check);
							for (let offset = 0; offset < next.length; offset += 4) {
								next[offset + 1] = current.pixels[offset + 1]!;
								if (copiedChannels.red) next[offset] = current.pixels[offset]!;
								if (copiedChannels.blue) next[offset + 2] = current.pixels[offset + 2]!;
								if (budget.visit()) await budget.yield();
							}
							check();
						}
					}
					if (binding === prepared.selectedBinding) await withProjectedImageDevelopMaskCoverageCurrentV1(binding, coverage, view => {
						const copy = owner.bytes(view.coverage.length); Uint8Array.prototype.set.call(copy, view.coverage);
						overlay = Object.freeze({ ...view, coverage: copy });
					}, prepared.profile, signal);
				}, signal, scope);
				if (next) replace(next);
			};
			for (const stage of prepared.stages) {
				check();
				if (stage.kind === 'lens-distortion') {
					const next = owner.floats(stage.plan.sampleCount); await writeLinearLensDistortionV1(stage.plan, current, next, signal); replace(next);
				} else if (stage.kind === 'geometry') {
					const next = owner.floats(stage.plan.sampleCount); await writeLinearGeometryV1(stage.plan, current, next, signal); replace(next, stage.plan.descriptor);
				} else if (stage.kind === 'chromatic-aberration') await observe(stage.id, async () => {
					const next = owner.floats(stage.plan.sampleCount); await writeLinearChromaticAberrationV1(stage.plan, current, next, signal); return next;
				}, { red: stage.red === 0, blue: stage.blue === 0 });
				else if (stage.kind === 'defringe') await observe(stage.id, async () => {
					const next = owner.floats(stage.plan.sampleCount); await writeLinearDefringeV1(stage.plan, current, next, signal); return next;
				}, 'unchanged');
				else if (stage.kind === 'spatial') await observe(stage.id, async () => {
					const next = owner.floats(current.pixels.length), scratch = owner.bytes(stage.plan.scratchBytes), backing = scratch.buffer;
					await writeLinearSpatialEffectV1(stage.plan, current.pixels, next, scratch, signal); owner.retire(backing); return next;
				});
				else if (stage.kind === 'lut') await observe(stage.id, async () => {
					if (!prepared.source) throw new TypeError('Native LUT requires its captured resource source.');
					const next = owner.floats(current.pixels.length); await writeLinearLutStageV1(stage, prepared.source, current, next, signal); return next;
				});
				else if (stage.kind === 'noop' || !stage.effects.length) await observe(stage.id);
				else {
					const binding = prepared.masks.plan.bindings.some(binding => binding.effectId === stage.id);
					const color = async () => {
						const pixels = binding ? owner.floats(current.pixels.length) : current.pixels;
						if (binding) Float32Array.prototype.set.call(pixels, current.pixels);
						const budget = new RepairTaskBudgetV1(check), rgb = { red: 0, green: 0, blue: 0 };
						for (const effect of stage.effects) for (let offset = 0; offset < pixels.length; offset += 4) {
							writeLinearColorChannelsV1(effect, pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!, rgb);
							const red = Math.fround(rgb.red), green = Math.fround(rgb.green), blue = Math.fround(rgb.blue);
							if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) throw new RangeError('Current linear Develop exceeds finite Float32 range.');
							pixels[offset] = red; pixels[offset + 1] = green; pixels[offset + 2] = blue;
							if (budget.visit()) await budget.yield();
						}
						return pixels;
					};
					if (binding) await observe(stage.id, color); else await color();
				}
			}
			check(); const result = await consume(current, overlay); check(); return result;
		};
		return prepared.maskSource ? withMaskRasterSourceScopeV1(prepared.masks.references, prepared.masks.retainedStorageKeys, prepared.maskSource, render, signal) : render();
	});
}

/** Current defringe alone retains exact gate-zero/unchanged component bits.
 * Compare the staged value before interpolation; the permanent shared blend
 * retains its original arithmetic. No plane or image-sized scratch is made. */
async function blendDefringeMaskCurrentV1(source: Readonly<LinearWorkingPixelFrameV1>, target: Float32Array<ArrayBuffer>,
	coverage: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<void> {
	if (target.length !== source.pixels.length || coverage.length * 4 !== target.length) throw new RangeError('Current defringe mask geometry changed.');
	const backings = [source.pixels, target, coverage].map(view => {
		const buffer = Reflect.apply(TYPED_BUFFER, view, []) as ArrayBuffer;
		return { buffer, length: Number(Reflect.apply(BACKING_SIZE, buffer, [])) };
	});
	const check = () => {
		checkRepairSignalV1(signal);
		if (backings.some(({ buffer, length }) => length === 0 || Reflect.apply(BACKING_SIZE, buffer, []) !== length)) {
			throw new TypeError('Current defringe mask storage was detached or changed.');
		}
	};
	const budget = new RepairTaskBudgetV1(check); check();
	for (let offset = 0; offset < target.length; offset += 4) {
		const amount = coverage[offset / 4]!;
		for (let channel = 0; channel < 3; channel++) {
			const before = source.pixels[offset + channel]!, after = target[offset + channel]!;
			const value = before === after || amount === 0 ? before : amount === 255 ? after : Math.fround(before + amount / 255 * (after - before));
			if (!Number.isFinite(value)) throw new RangeError('Current defringe mask exceeds finite Float32 range.');
			target[offset + channel] = value;
		}
		target[offset + 3] = source.pixels[offset + 3]!;
		if (budget.visit()) await budget.yield();
	}
	check();
}
