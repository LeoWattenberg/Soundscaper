/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord as record, readClosedDomainField as field } from '../closed-domain-value.ts';
import { readPixelFrameWebGl2MaskOverlayCurrentV1, type PixelFrameWebGl2MaskOverlayStepCurrentV1 as Step } from './pixel-frame-webgl2-mask-overlay-plan-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_MASK_OVERLAY_FRAGMENT_CURRENT_V1 as FRAGMENT } from './pixel-frame-webgl2-mask-overlay-glsl-current-v1.ts';
import { withMaskNativeCurrentV1, type MaskTextureCurrentV1 } from './pixel-frame-webgl2-mask-context-native-current-v1.ts';
import { readPixelFrameWebGl2MaskSelectedTextureCurrentV1 } from './pixel-frame-webgl2-mask-context-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';

interface Projection {
	readonly gl: WebGL2RenderingContext; readonly texture: WebGLTexture;
	readonly width: number; readonly height: number;
	readonly checkCurrent: () => void; readonly unavailable: (reason: string) => never;
}
export interface PixelFrameWebGl2MaskOverlayCoverageCurrentV1 {
	readonly width: number; readonly height: number;
	/** Private GPU-readback bytes. Borrow only; never a CPU projection result. */
	readonly coverage: Uint8Array<ArrayBuffer>;
	readStripe(top: number, rows: number, target: Uint8Array<ArrayBuffer>): void;
}
export interface PixelFrameWebGl2MaskOverlayStorageCurrentV1 {
	project(value: Readonly<Projection>): Promise<void>;
	/** Private proof transport only: after project joins, before delivery. */
	readStripe(top: number, rows: number, target: Uint8Array<ArrayBuffer>): void;
	withCoverage<Result>(consume: (view: Readonly<PixelFrameWebGl2MaskOverlayCoverageCurrentV1>) => Result | Promise<Result>): Promise<Result>;
}
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!, TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const SET = Uint8Array.prototype.set, FILL = Uint8Array.prototype.fill;
const STORAGES = new WeakMap<object, Readonly<{ plan: unknown; checkEntry: () => void; fail: (reason: unknown) => void }>>();

/** Independent execution options may carry only this exact private empty
 * owner/plan. A's token separately checks captured source currentness before
 * GL exists; project later installs its GL fence for subsequent checks. */
export function assertPixelFrameWebGl2MaskOverlayStorageCurrentV1(value: unknown, planValue: unknown): void {
	const owned = typeof value === 'object' && value !== null ? STORAGES.get(value) : undefined;
	if (!owned) throw new TypeError('GPU overlay storage requires a live private owner.');
	try {
		owned.checkEntry();
		if (planValue !== owned.plan) throw new TypeError('GPU overlay storage differs from its original selected plan.');
	} catch (error) { owned.fail(error); throw error; }
}

/** One retained private host plane wraps GPU execution, complete CPU receipt
 * proof and final presentation. Nested native projection scratch/banks are
 * retired BEFORE project resolves. All failed/ignored children latch fatal;
 * no CPU-produced coverage or postfailure delivery is accepted. */
export async function withPixelFrameWebGl2MaskOverlayCurrentV1<Result>(planValue: unknown,
	consume: (storage: Readonly<PixelFrameWebGl2MaskOverlayStorageCurrentV1>) => Result | Promise<Result>, signalValue?: AbortSignal): Promise<Result> {
	const signal = captureRepairSignalV1(signalValue); checkRepairSignalV1(signal);
	const plan = readPixelFrameWebGl2MaskOverlayCurrentV1(planValue);
	if (typeof consume !== 'function') throw new TypeError('GPU overlay requires a joined retained-host scope.');
	const coverage = new Uint8Array(plan.retainedHostBytes), backing = coverage.buffer;
	const failures: unknown[] = [], pending = new Set<Promise<void>>();
	const state: { phase: 'empty' | 'projecting' | 'ready' | 'retired' } = { phase: 'empty' };
	let admitting = true, reading = false, delivered = false, current: (() => void) | undefined;
	const fail = (reason: unknown) => { if (!failures.some(previous => Object.is(previous, reason))) failures.push(reason); };
	const check = () => {
		checkRepairSignalV1(signal); current?.();
		if (Reflect.apply(SIZE, backing, []) !== plan.retainedHostBytes) throw new TypeError('GPU overlay host backing detached before retirement.');
		if (state.phase === 'retired') throw new TypeError('GPU overlay host scope retired.');
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'GPU overlay work failed.', { cause: failures[0] });
	};
	const join = <Output>(task: Promise<Output>): Promise<Output> => {
		const child = task.then(() => undefined, () => undefined); pending.add(child); void child.then(() => { pending.delete(child); }); return task;
	};
	const copyStripe = (top: number, rows: number, target: Uint8Array<ArrayBuffer>): void => {
		check(); const width = plan.finalExtent.width, count = width * rows;
		if (!Number.isSafeInteger(top) || !Number.isSafeInteger(rows) || top < 0 || rows < 1 || top + rows > plan.finalExtent.height || count > 65536) throw new RangeError('GPU overlay canonical stripe has invalid extent.');
		if (Reflect.apply(TAG, target, []) !== 'Uint8Array' || Reflect.apply(OFFSET, target, []) !== 0 || Reflect.apply(LENGTH, target, []) !== count) throw new TypeError('GPU overlay requires exact canonical stripe storage.');
		const targetBacking = Reflect.apply(BUFFER, target, []) as ArrayBuffer;
		if (Reflect.apply(RESIZABLE, targetBacking, []) || Reflect.apply(SIZE, targetBacking, []) > 65536) throw new RangeError('GPU overlay canonical stripe backing exceeds64KiB.');
		Reflect.apply(SET, target, [new Uint8Array(backing, top * width, count)]); check();
	};
	const storage: Readonly<PixelFrameWebGl2MaskOverlayStorageCurrentV1> = Object.freeze({
		project(value: Readonly<Projection>) {
			return join((async () => {
				try {
					check(); if (!admitting || state.phase !== 'empty') throw new TypeError('GPU overlay projection is repeated or closed.');
					state.phase = 'projecting';
					const input = record(value, 'selected GPU coverage', ['gl', 'texture', 'width', 'height', 'checkCurrent', 'unavailable']);
					if (field(input, 'width', 'selected coverage') !== plan.sourceExtent.width || field(input, 'height', 'selected coverage') !== plan.sourceExtent.height) {
						throw new RangeError('Selected GPU coverage extent differs from its checkpoint.');
					}
					const gl = field(input, 'gl', 'selected coverage') as WebGL2RenderingContext, texture = field(input, 'texture', 'selected coverage') as WebGLTexture;
					const checkMethod = field(input, 'checkCurrent', 'selected coverage'), unavailableMethod = field(input, 'unavailable', 'selected coverage');
					if (typeof checkMethod !== 'function' || typeof unavailableMethod !== 'function') throw new TypeError('GPU overlay requires pinned synchronous callbacks.');
					current = () => { if (Reflect.apply(checkMethod, value, []) !== undefined) throw new TypeError('GPU overlay currentness must be synchronous void.'); };
					const unavailable = (reason: string): never => { Reflect.apply(unavailableMethod, value, [reason]); throw new TypeError('GPU overlay unavailability callback must throw.'); };
					check(); if (!gl.isTexture(texture)) throw new TypeError('GPU overlay requires selected live graph texture.');
					const checkProjection = () => { check(); readPixelFrameWebGl2MaskSelectedTextureCurrentV1(texture, gl, plan.checkpoint); };
					checkProjection();
					if (!plan.supported) unavailable('mask-overlay-numeric-range');
					await withMaskNativeCurrentV1(gl, checkProjection, unavailable, async owner => {
						const program = plan.steps.length ? owner.program(FRAGMENT) : undefined;
						const uniforms = owner.floats(32), scratch = owner.uints(plan.nativeReadbackBytes / 4);
						const banks = plan.steps.length ? [owner.texture('byte', 1, 1), owner.texture('byte', 1, 1)] : [];
						let source: MaskTextureCurrentV1 = { texture, format: 'byte', width: plan.sourceExtent.width, height: plan.sourceExtent.height, allocated: true };
						for (const [index, step] of plan.steps.entries()) {
							check(); const destination = banks[index % 2]!;
							owner.resize(destination, step.output.width, step.output.height);
							const incoming = source;
							owner.draw(program!, destination, () => {
								gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, incoming.texture);
								gl.uniform1i(gl.getUniformLocation(program!, 'uCoverage'), 0);
								upload(gl, program!, step, uniforms);
							}); source = destination; await owner.wait(); check();
						}
						owner.attach(source);
						for (let y = 0; y < plan.finalExtent.height; y++) for (let x = 0; x < plan.finalExtent.width; x += 4096) {
							check(); const width = Math.min(4096, plan.finalExtent.width - x); scratch.fill(0);
							let primary: Readonly<{ error: unknown }> | undefined;
							try {
								gl.readPixels(x, y, width, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, scratch.subarray(0, width * 4)); owner.check();
								for (let pixel = 0; pixel < width; pixel++) { const byte = scratch[pixel * 4]!;
									if (byte > 255) throw new TypeError('GPU overlay R8UI produced a non-byte readback.'); coverage[y * plan.finalExtent.width + x + pixel] = byte;
								}
							} catch (error) { primary = { error }; }
							let retirement: Readonly<{ error: unknown }> | undefined;
							try { scratch.fill(0); } catch (error) { retirement = { error }; }
							if (retirement) {
								if (primary) throw new AggregateError([primary.error, retirement.error], 'GPU overlay native read and scratch retirement failed.', { cause: primary.error });
								throw retirement.error;
							}
							if (primary) throw primary.error;
							await new Promise<void>(resolve => { setTimeout(resolve, 0); }); check();
						}
						uniforms.fill(0);
					});
					// Only fully joined successful native cleanup can authorize reads.
					check(); state.phase = 'ready';
				} catch (error) { fail(error); throw error; }
			})());
		},
		readStripe(top: number, rows: number, target: Uint8Array<ArrayBuffer>) {
			try {
				check(); if (!admitting || state.phase !== 'ready' || delivered || reading) throw new TypeError('GPU overlay proof stripes require joined projection before external delivery.');
				copyStripe(top, rows, target);
			} catch (error) { fail(error); throw error; }
		},
		withCoverage<Output>(callback: (view: Readonly<PixelFrameWebGl2MaskOverlayCoverageCurrentV1>) => Output | Promise<Output>): Promise<Output> {
			return join((async () => {
				let claimed = false, lent = true;
				try {
					check(); if (!admitting || state.phase !== 'ready' || reading || delivered || typeof callback !== 'function') throw new TypeError('GPU overlay delivery requires joined projection and one scoped consumer.');
					reading = true; delivered = true; claimed = true;
					const view = Object.freeze({ width: plan.finalExtent.width, height: plan.finalExtent.height, coverage,
						readStripe(top: number, rows: number, target: Uint8Array<ArrayBuffer>) {
							try {
								check(); if (!reading || !lent) throw new TypeError('GPU overlay coverage borrow retired.');
								copyStripe(top, rows, target);
							} catch (error) { fail(error); throw error; }
						} });
					const result = await callback(view); check(); return result;
				} catch (error) { fail(error); throw error; } finally { lent = false; if (claimed) reading = false; }
			})());
		},
	});
	STORAGES.set(storage, Object.freeze({ plan, fail, checkEntry() {
		check(); if (!admitting || state.phase !== 'empty' || pending.size || reading || delivered) throw new TypeError('GPU overlay entry requires an empty joined private owner.');
	} }));
	let result!: Result;
	try { result = await consume(storage); } catch (error) { fail(error); }
	admitting = false; while (pending.size) await Promise.all(pending);
	try { check(); if (state.phase !== 'ready' || !delivered) throw new TypeError('GPU overlay scope omitted successful projection or its joined host consumer.'); } catch (error) { fail(error); }
	STORAGES.delete(storage);
	state.phase = 'retired';
	try {
		if (Reflect.apply(SIZE, backing, []) !== plan.retainedHostBytes) throw new TypeError('GPU overlay backing detached before physical retirement.');
		Reflect.apply(FILL, new Uint8Array(backing), [0]);
	} catch (error) { fail(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'GPU overlay work and retirement failed.', { cause: failures[0] });
	return result;
}

function upload(gl: WebGL2RenderingContext, program: WebGLProgram, step: Step, scratch: Float32Array<ArrayBuffer>): void {
	gl.uniform1i(gl.getUniformLocation(program, 'uOverlayKind'), step.kind === 'geometry' ? 1 : 2);
	gl.uniform2i(gl.getUniformLocation(program, 'uSourceExtent'), step.source.width, step.source.height);
	if (step.kind === 'lens-distortion') { gl.uniform1f(gl.getUniformLocation(program, 'uLensCoefficient'), step.lens.coefficient); return; }
	const geometry = step.geometry, mapping = geometry.mapping; scratch.fill(0);
	scratch.set(mapping.outputToAperture, 0); scratch.set(mapping.apertureToSource, 6);
	gl.uniform3fv(gl.getUniformLocation(program, 'uOutputToAperture[0]'), scratch.subarray(0, 6));
	gl.uniform3fv(gl.getUniformLocation(program, 'uApertureToSource[0]'), scratch.subarray(6, 15));
	gl.uniform4i(gl.getUniformLocation(program, 'uCropBounds'), ...geometry.bounds);
	gl.uniform1i(gl.getUniformLocation(program, 'uIntegerPermutation'), geometry.integerPermutation ? 1 : 0);
	const integer = geometry.integerTransform;
	if (integer) {
		gl.uniform3i(gl.getUniformLocation(program, 'uIntegerToSource[0]'), integer[0], integer[1], integer[2]);
		gl.uniform3i(gl.getUniformLocation(program, 'uIntegerToSource[1]'), integer[3], integer[4], integer[5]);
	}
}
