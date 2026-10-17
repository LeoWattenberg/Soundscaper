/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../closed-domain-value.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from './pixel-frame-repair-lifetime-v1.ts';
import { readPixelFrameWebGl2MaskContextCurrentV1 } from './pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { readImageDevelopGpuMaskPhasePlanCurrentV1 } from './image-develop-gpu-mask-phase-plan-current-v1.ts';
import { assertMaskRasterSourceScopeV1, withMaskRasterSourceScopeWorkV1 } from './mask-raster-source-scope-v1.ts';
import { withMaskNativeCurrentV1 } from './pixel-frame-webgl2-mask-context-native-current-v1.ts';
import { createMaskProgramsCurrentV1 } from './pixel-frame-webgl2-mask-context-programs-current-v1.ts';
import { executeMaskGraphCurrentV1 } from './pixel-frame-webgl2-mask-context-execute-current-v1.ts';
import { probeMaskContextCurrentV1 } from './pixel-frame-webgl2-mask-context-probe-current-v1.ts';

export interface PixelFrameWebGl2MaskImageCurrentV1 { readonly texture: WebGLTexture; readonly width: number; readonly height: number; }
export interface PixelFrameWebGl2MaskSelectedTextureCurrentV1 extends PixelFrameWebGl2MaskImageCurrentV1 {
	readonly gl: WebGL2RenderingContext; readonly checkpoint: unknown;
}
const SELECTED = new WeakMap<object, Readonly<{ view: Readonly<PixelFrameWebGl2MaskSelectedTextureCurrentV1>; check: () => void }>>();
/** Exact selected graph output, enrolled only during its joined withTexture
 * callback. Native texture shape/liveness or matching scalar IDs are no proof. */
export function readPixelFrameWebGl2MaskSelectedTextureCurrentV1(textureValue: unknown, glValue: unknown,
	checkpointValue: unknown): Readonly<PixelFrameWebGl2MaskSelectedTextureCurrentV1> {
	const state = textureValue !== null && typeof textureValue === 'object' ? SELECTED.get(textureValue) : undefined;
	if (!state || state.view.gl !== glValue || state.view.checkpoint !== checkpointValue) throw new TypeError('Selected mask texture requires its live exact checkpoint borrow.');
	state.check(); return state.view;
}
export function assertPixelFrameWebGl2MaskSelectedTextureCurrentV1(textureValue: unknown, glValue: unknown, checkpointValue: unknown): void {
	readPixelFrameWebGl2MaskSelectedTextureCurrentV1(textureValue, glValue, checkpointValue);
}
export interface PixelFrameWebGl2MaskCoverageCurrentV1 {
	readonly width: number; readonly height: number;
	readStripe(top: number, rows: number, target: Uint8Array<ArrayBuffer>): void;
	blend(candidate: Readonly<PixelFrameWebGl2MaskImageCurrentV1>, destination: Readonly<PixelFrameWebGl2MaskImageCurrentV1>): void;
	withTexture<Result>(consume: (texture: WebGLTexture) => Result | Promise<Result>): Promise<Result>;
}
export interface PixelFrameWebGl2MaskExecutorCurrentV1 {
	withCoverage<Result>(checkpoint: unknown, incoming: Readonly<PixelFrameWebGl2MaskImageCurrentV1>,
		consume: (coverage: Readonly<PixelFrameWebGl2MaskCoverageCurrentV1>) => Result | Promise<Result>): Promise<Result>;
}
export interface PixelFrameWebGl2MaskContextRequestCurrentV1 {
	readonly gl: WebGL2RenderingContext; readonly prepared: unknown; readonly scope?: unknown; readonly phasePlan?: unknown;
	readonly signal?: AbortSignal; readonly checkCurrent: () => void; readonly unavailable: (reason: string) => never;
}
const TYPED = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!, BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const OFFSET = Object.getOwnPropertyDescriptor(TYPED, 'byteOffset')!.get!, LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'length')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;

/** Called only inside Root's native GL/context borrow. This owner never creates
 * Original/resource authority, fetches bodies, or admits a CPU coverage upload.
 * Captured callbacks run with their original request receiver, before awaits. */
export async function withPixelFrameWebGl2MaskContextCurrentV1<Result>(value: Readonly<PixelFrameWebGl2MaskContextRequestCurrentV1>,
	consume: (executor: Readonly<PixelFrameWebGl2MaskExecutorCurrentV1>) => Result | Promise<Result>): Promise<Result> {
	const input = record(value, 'native mask context', ['gl', 'prepared', 'scope', 'signal', 'checkCurrent', 'unavailable', 'phasePlan'], ['gl', 'prepared', 'checkCurrent', 'unavailable']);
	const signal = captureRepairSignalV1(Object.hasOwn(input, 'signal') ? field(input, 'signal', 'mask context') : undefined); checkRepairSignalV1(signal);
	const prepared = field(input, 'prepared', 'mask context'), plan = readPixelFrameWebGl2MaskContextCurrentV1(prepared);
	const phaseValue = Object.hasOwn(input, 'phasePlan') ? field(input, 'phasePlan', 'mask context') : undefined;
	const phase = phaseValue === undefined ? undefined : readImageDevelopGpuMaskPhasePlanCurrentV1(phaseValue);
	if (phase && phase.contextPlan !== prepared) throw new TypeError('Mask context lost its exact complete phase authority.');
	const gl = field(input, 'gl', 'mask context') as WebGL2RenderingContext, scope = Object.hasOwn(input, 'scope') ? field(input, 'scope', 'mask context') : undefined;
	const checkMethod = field(input, 'checkCurrent', 'mask context'), unavailableMethod = field(input, 'unavailable', 'mask context');
	if (typeof checkMethod !== 'function' || typeof unavailableMethod !== 'function' || typeof consume !== 'function') throw new TypeError('Mask context requires captured synchronous callbacks and a joined consumer.');
	const check = () => { checkRepairSignalV1(signal); if (Reflect.apply(checkMethod, value, []) !== undefined) throw new TypeError('Mask currentness check must be synchronous void.'); };
	const unavailable = (reason: string): never => { Reflect.apply(unavailableMethod, value, [reason]); throw new TypeError('Mask unavailability callback must throw.'); };
	check(); const references = plan.checkpointPlan.metadata.masks.references;
	if (references.length || scope !== undefined) assertMaskRasterSourceScopeV1(scope, references);
	// Standalone component calls keep conservative admission. The actual full
	// coordinator may replace that sum only with its exact private complete ledger.
	if (!(phase?.eligible ?? plan.eligible)) unavailable('mask-working-set');
	let live = true, busy = false, next = 0;
	const pending = new Set<Promise<void>>(), failures: unknown[] = [];
	const fail = (reason: unknown) => { if (!failures.some(previous => Object.is(previous, reason))) failures.push(reason); };
	const refused = () => { check(); if (failures.length === 1) throw failures[0]; if (failures.length > 1) throw new AggregateError(failures, 'Mask executor work failed.', { cause: failures[0] }); };
	return withMaskNativeCurrentV1(gl, check, unavailable, async master => {
		const programs = plan.entries.length ? createMaskProgramsCurrentV1(master) : undefined;
		if (programs) await probeMaskContextCurrentV1(master, programs);
		const image = (raw: unknown, width: number, height: number) => {
			const data = record(raw, 'native mask image', ['texture', 'width', 'height']);
			if (field(data, 'width', 'mask image') !== width || field(data, 'height', 'mask image') !== height) throw new RangeError('Mask image extent differs from its incoming checkpoint.');
			const texture = field(data, 'texture', 'mask image') as WebGLTexture;
			if (!gl.isTexture(texture)) throw new TypeError('Mask input requires a live native texture.');
			return Object.freeze({ texture, width, height, format: 'float' as const, allocated: true });
		};
		const executor: Readonly<PixelFrameWebGl2MaskExecutorCurrentV1> = Object.freeze({
			withCoverage<Output>(checkpointValue: unknown, incomingValue: Readonly<PixelFrameWebGl2MaskImageCurrentV1>, callback: (coverage: Readonly<PixelFrameWebGl2MaskCoverageCurrentV1>) => Output | Promise<Output>): Promise<Output> {
				let claimed = false;
				const work = (async (): Promise<Output> => {
					try {
						refused(); if (!live || busy) throw new TypeError('Mask execution is closed or concurrent.');
						const entry = plan.entries[next]; if (!entry || checkpointValue !== entry.checkpoint) throw new TypeError('Mask checkpoint identity/order changed.');
						const checkpoint = entry.checkpoint, incoming = image(incomingValue, checkpoint.width, checkpoint.height);
						if (typeof callback !== 'function') throw new TypeError('Mask coverage requires a scoped consumer.');
						busy = true; claimed = true;
						const run = () => withMaskNativeCurrentV1<Output>(gl, check, unavailable, async owner => {
							const output = await executeMaskGraphCurrentV1(entry.graph, incoming.texture, scope, owner, programs!, phaseValue);
							const scratch = owner.uints(16_384); let lent = true, admitting = true, projectionClaimed = false;
							const children = new Set<Promise<void>>(), localFailures: unknown[] = [];
							const localFail = (reason: unknown) => { if (!localFailures.some(previous => Object.is(previous, reason))) localFailures.push(reason); };
							const active = () => { if (!lent) throw new TypeError('Mask coverage borrow retired.'); if (localFailures.length) throw localFailures[0]; owner.check(); };
							const view: Readonly<PixelFrameWebGl2MaskCoverageCurrentV1> = Object.freeze({ width: checkpoint.width, height: checkpoint.height,
								readStripe(top: number, rows: number, target: Uint8Array<ArrayBuffer>) {
									try {
										active(); const count = checkpoint.width * rows;
										if (!Number.isInteger(top) || !Number.isInteger(rows) || top < 0 || rows < 1 || top + rows > checkpoint.height || count > 65_536) throw new RangeError('Mask receipt stripe exceeds its logical extent.');
										if (Reflect.apply(TAG, target, []) !== 'Uint8Array' || Reflect.apply(OFFSET, target, []) !== 0 || Reflect.apply(LENGTH, target, []) !== count) throw new TypeError('Mask receipt requires its exact canonical byte stripe.');
										const backing = Reflect.apply(BUFFER, target, []) as ArrayBuffer;
										if (Reflect.apply(RESIZABLE, backing, []) || Number(Reflect.apply(SIZE, backing, [])) > 65_536) throw new RangeError('Mask canonical stripe has oversized physical backing.');
										owner.attach(output); let offset = 0;
										for (let y = top; y < top + rows; y++) for (let x = 0; x < checkpoint.width; x += 4096) {
											active(); const width = Math.min(4096, checkpoint.width - x); scratch.fill(0);
											let primary: unknown, failed = false;
											try { gl.readPixels(x, y, width, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, scratch.subarray(0, width * 4)); owner.check();
												for (let pixel = 0; pixel < width; pixel++) { const byte = scratch[pixel * 4]!; if (byte > 255) throw new TypeError('Mask R8UI readback is outside canonical byte range.'); target[offset++] = byte; }
											} catch (error) { primary = error; failed = true; }
											let retirement: Readonly<{ error: unknown }> | undefined;
											try { scratch.fill(0); } catch (error) { retirement = { error }; }
											if (retirement) {
												if (failed && !Object.is(retirement.error, primary)) throw new AggregateError([primary, retirement.error], 'Mask readback and scratch retirement failed.', { cause: primary });
												throw retirement.error;
											}
											if (failed) throw primary;
										} active();
									} catch (error) { localFail(error); throw error; }
								},
								blend(candidateValue: Readonly<PixelFrameWebGl2MaskImageCurrentV1>, destinationValue: Readonly<PixelFrameWebGl2MaskImageCurrentV1>) {
									try { active(); if (checkpoint.mode !== 'blend') throw new TypeError('Observe-only coverage has no image candidate.');
										const candidate = image(candidateValue, checkpoint.width, checkpoint.height), destination = image(destinationValue, checkpoint.width, checkpoint.height);
										programs!.blend(destination, incoming.texture, candidate.texture, output.texture, checkpoint.blend); active();
									} catch (error) { localFail(error); throw error; }
								},
								withTexture<Projection>(projection: (texture: WebGLTexture) => Projection | Promise<Projection>): Promise<Projection> {
									const task = (async (): Promise<Projection> => { try { active(); if (!admitting || projectionClaimed || !checkpoint.selected || typeof projection !== 'function') throw new TypeError('Projection requires selected live coverage.');
										projectionClaimed = true;
										const view = Object.freeze({ gl, texture: output.texture, checkpoint, width: checkpoint.width, height: checkpoint.height });
										SELECTED.set(output.texture, Object.freeze({ view, check: active }));
										try { const result = await projection(output.texture); active(); return result; }
										finally { SELECTED.delete(output.texture); }
									} catch (error) { localFail(error); throw error; } })();
									const joined = task.then(() => undefined, () => undefined); children.add(joined); void joined.then(() => { children.delete(joined); }); return task;
								},
							});
							let result!: Output;
							try { result = await callback(view); } catch (error) { localFail(error); }
							admitting = false; while (children.size) await Promise.all(children);
							try { active(); } catch (error) { localFail(error); } lent = false;
							if (localFailures.length === 1) throw localFailures[0];
							if (localFailures.length > 1) throw new AggregateError(localFailures, 'Mask coverage consumer failed.', { cause: localFailures[0] });
							return result;
						});
						const result = await (scope === undefined ? run() : withMaskRasterSourceScopeWorkV1(scope, run)); next++; return result;
					} catch (error) { fail(error); throw error; } finally { if (claimed) busy = false; }
				})();
				const joined = work.then(() => undefined, () => undefined); pending.add(joined); void joined.then(() => { pending.delete(joined); }); return work;
			},
		});
		let result!: Result; try { result = await consume(executor); } catch (error) { fail(error); }
		live = false; while (pending.size) await Promise.all(pending);
		if (!failures.length && next !== plan.entries.length) fail(new TypeError('Mask executor omitted a planned checkpoint.'));
		refused(); return result;
	});
}
