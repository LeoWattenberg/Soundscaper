/* SPDX-License-Identifier: AGPL-3.0-only */
// Genuine native graph/program/readback; this component does not qualify the high broker.
import { prepareLinearDevelopMetadataCurrentV1 } from '../../../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskOverlayCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-overlay-plan-current-v1.ts';
import { withPixelFrameWebGl2MaskOverlayCurrentV1, assertPixelFrameWebGl2MaskOverlayStorageCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-overlay-current-v1.ts';
import { preparePixelFrameWebGl2MaskContextCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { withPixelFrameWebGl2MaskContextCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-context-current-v1.ts';
import { withMaskNativeCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-context-native-current-v1.ts';
import { withLinearMaskCoverageV1 } from '../../../src/common/editor/imaging/pixel-frame-linear-mask-v1.ts';
import { withProjectedImageDevelopMaskCoverageCurrentV1 } from '../../../src/common/editor/imaging/image-develop-mask-overlay-current-v1.ts';
import { withPixelFrameWebGl2MaskReceiptsCurrentV1, capturePixelFrameWebGl2MaskCheckpointCurrentV1,
	capturePixelFrameWebGl2MaskOverlayCurrentV1, sealPixelFrameWebGl2MaskCheckpointsCurrentV1,
	verifyPixelFrameWebGl2MaskCheckpointCurrentV1, verifyPixelFrameWebGl2MaskOverlayCurrentV1,
	finishPixelFrameWebGl2MaskCheckpointsCurrentV1 } from '../../../src/common/editor/imaging/pixel-frame-webgl2-mask-checkpoint-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../../../src/common/editor/photo-library-develop-linear-port-v1.ts';

interface Request {
	readonly width: number; readonly height: number; readonly effects: readonly unknown[]; readonly enabled?: boolean; readonly legacyCrop?: boolean;
	readonly node?: unknown; readonly fault?: 'preabort' | 'held-abort' | 'held-loss' | 'held-delivery' | 'opaque' | 'detach-opaque' | 'ignored-project' | 'repeat-project' | 'foreign-texture' | 'expired-texture' | 'detach-readback-opaque'
		| 'proof-inflight' | 'proof-malformed' | 'proof-abort' | 'proof-after-delivery' | 'proof-expired' | 'guard-after-project';
}
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const retired = (buffer: ArrayBuffer) => Reflect.apply(SIZE, buffer, []) === 0 || new Uint8Array(buffer).every(value => value === 0);
const outcome = <T>(task: Promise<T>) => task.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };

export async function qualifyNativeGpuMaskOverlayCurrentV1(request: Request) {
	if (![request.width, request.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 64)) throw new RangeError('Overlay component is bounded64x64.');
	const pixels = new Float32Array(request.width * request.height * 4);
	for (let index = 3; index < pixels.length; index += 4) pixels[index] = 1;
	const frame = { descriptor: { schemaVersion: 1 as const, width: request.width, height: request.height,
		sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
	const develop = { ...defaultImageDevelopStateV2(), ...(request.legacyCrop ? { geometry: { ...defaultImageDevelopStateV2().geometry, crop: { x: 0, y: 0, width: .5, height: 1 } } } : {}),
		effects: [{ id: 'selected', type: 'tone-ladder-v1', enabled: request.enabled ?? false, params: {} }, ...request.effects],
		masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [request.node ?? { id: 'ramp', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'ramp' }],
		maskBindings: [{ effectId: 'selected', maskId: 'local' }] };
	const metadata = prepareLinearDevelopMetadataCurrentV1({ frame, develop, maskOverlay: { maskId: 'local', effectId: 'selected' } }, PROFILE, {});
	const checkpointPlan = preparePixelFrameWebGl2MaskPlanCurrentV1(metadata), plan = preparePixelFrameWebGl2MaskOverlayCurrentV1(checkpointPlan);
	const selected = plan.checkpoint, context = preparePixelFrameWebGl2MaskContextCurrentV1(checkpointPlan);
	// Constant black/unit-alpha is invariant under the fixture's legacy crop.
	// This is the actual incoming native image extent, not Original coordinates.
	const incomingPixels = new Float32Array(selected.width * selected.height * 4);
	for (let index = 3; index < incomingPixels.length; index += 4) incomingPixels[index] = 1;
	const incomingFrame = { descriptor: { ...frame.descriptor, width: selected.width, height: selected.height }, pixels: incomingPixels };
	const expected = await withLinearMaskCoverageV1(selected.binding, incomingFrame, coverage => withProjectedImageDevelopMaskCoverageCurrentV1(selected.binding, coverage,
		view => ({ width: view.width, height: view.height, coverage: [...view.coverage] }), PROFILE));
	const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
	const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false });
	if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('Mandatory overlay component native context unavailable.');
	const debug = gl.getExtension('WEBGL_debug_renderer_info');
	const renderer = String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER));
	const textures: WebGLTexture[] = [], nativeBackings: ArrayBuffer[] = [], programKinds = new Map<WebGLProgram, number>();
	const locations = new Map<WebGLUniformLocation, { program: WebGLProgram; name: string }>(), restores: (() => void)[] = [];
	let overlayDraws = 0, integerReads = 0, integerClears = 0, projectionDrawn = false;
	const reason = Proxy.revocable({}, {}); reason.revoke();
	const observe = (name: string, after: (args: unknown[], result: unknown) => void) => {
		const method = Reflect.get(gl, name) as (...args: unknown[]) => unknown, own = Object.getOwnPropertyDescriptor(gl, name);
		Object.defineProperty(gl, name, { configurable: true, value: (...args: unknown[]) => { const result = Reflect.apply(method, gl, args); after(args, result); return result; } });
		restores.push(() => { if (own) Object.defineProperty(gl, name, own); else Reflect.deleteProperty(gl, name); });
	};
	observe('createTexture', (_args, result) => { if (result) textures.push(result as WebGLTexture); });
	observe('getUniformLocation', (args, result) => { if (result) locations.set(result as WebGLUniformLocation, { program: args[0] as WebGLProgram, name: String(args[1]) }); });
	observe('uniform1i', args => { const location = locations.get(args[0] as WebGLUniformLocation); if (location?.name === 'uOverlayKind') programKinds.set(location.program, Number(args[1])); });
	observe('drawArrays', () => { const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null; if (program && programKinds.has(program)) { overlayDraws++; projectionDrawn = true; } });
	observe('clearBufferuiv', () => { integerClears++; });
	observe('readPixels', args => { if (args[4] === gl.RGBA_INTEGER && args[5] === gl.UNSIGNED_INT) {
		integerReads++; const output = args[6]; if (output instanceof Uint32Array) nativeBackings.push(output.buffer as ArrayBuffer);
		if (request.fault === 'detach-readback-opaque' && projectionDrawn && output instanceof Uint32Array) { structuredClone(output.buffer, { transfer: [output.buffer] }); throw reason.proxy; }
	} });
	const stop = new AbortController();
	const entered = deferred(), release = deferred(); let callbacks = 0, host: ArrayBuffer | undefined, pending = false, heldLive = false, loss = false, settled = false;
	const proofStripeBackings: ArrayBuffer[] = [];
	const observedCoverage: number[] = []; let byteProofMatched: boolean | undefined;
	let proofReads = 0, proofBeforeDelivery = true, proofScopesRetired = false, proofRejected = false, guardRejected = false;
	const proofReaders: ((top: number, rows: number, target: Uint8Array<ArrayBuffer>) => void)[] = [];
	const checkCurrent = () => { stop.signal.throwIfAborted(); if (gl.isContextLost()) throw new TypeError('Native overlay context lost.'); };
	const unavailable = (why: string): never => { throw new Error(`Native overlay capability refused: ${why}`); };
	try {
		if (request.fault === 'preabort') stop.abort(reason.proxy);
		const task = outcome(withPixelFrameWebGl2MaskOverlayCurrentV1(plan, async storage => {
			assertPixelFrameWebGl2MaskOverlayStorageCurrentV1(storage, plan);
			proofReaders.push(storage.readStripe);
			await withPixelFrameWebGl2MaskReceiptsCurrentV1(checkpointPlan, async receipts => {
				await withMaskNativeCurrentV1(gl, checkCurrent, unavailable, async imageOwner => {
					const image = imageOwner.texture('float', selected.width, selected.height, incomingPixels);
					await withPixelFrameWebGl2MaskContextCurrentV1({ gl, prepared: context, signal: stop.signal, checkCurrent, unavailable }, executor =>
						executor.withCoverage(selected, { texture: image.texture, width: selected.width, height: selected.height }, async coverage => {
							await capturePixelFrameWebGl2MaskCheckpointCurrentV1(receipts, selected, { width: coverage.width, height: coverage.height }, coverage.readStripe);
							if (request.fault === 'expired-texture') {
								let expired: WebGLTexture | undefined;
								await coverage.withTexture(texture => { expired = texture; });
								if (!expired || !gl.isTexture(expired)) throw new Error('Expired-capability fixture requires a still-live native graph texture.');
								await storage.project({ gl, texture: expired, width: coverage.width, height: coverage.height, checkCurrent, unavailable }); return;
							}
							await coverage.withTexture(async texture => {
								const actual = request.fault === 'foreign-texture' ? imageOwner.texture('byte', coverage.width, coverage.height).texture : texture;
								const projection = { gl, texture: actual, width: coverage.width, height: coverage.height, checkCurrent, unavailable };
								if (request.fault === 'ignored-project') { void storage.project({ ...projection, width: 0 }).catch(() => {}); return; }
								const project = storage.project(projection);
								if (request.fault === 'proof-inflight') {
									try { storage.readStripe(0, 1, new Uint8Array(plan.finalExtent.width)); } catch (error) { if (error instanceof TypeError) proofRejected = true; else throw error; }
								}
								await project;
								if (request.fault === 'guard-after-project') {
									try { assertPixelFrameWebGl2MaskOverlayStorageCurrentV1(storage, plan); } catch (error) { if (error instanceof TypeError) guardRejected = true; else throw error; }
								}
								if (request.fault === 'repeat-project') await storage.project(projection).catch(() => {});
							});
						}));
				});
				if (request.fault === 'proof-malformed') storage.readStripe(0, 0, new Uint8Array());
				if (request.fault === 'proof-abort') { stop.abort(reason.proxy); storage.readStripe(0, 1, new Uint8Array(plan.finalExtent.width)); }
				await capturePixelFrameWebGl2MaskOverlayCurrentV1(receipts, selected, plan.finalExtent, (top, rows, target) => {
					storage.readStripe(top, rows, target); proofReads++; proofBeforeDelivery &&= callbacks === 0; proofStripeBackings.push(target.buffer);
					observedCoverage.push(...target);
				});
				sealPixelFrameWebGl2MaskCheckpointsCurrentV1(receipts);
				await withLinearMaskCoverageV1(selected.binding, incomingFrame, async coverage => {
					await verifyPixelFrameWebGl2MaskCheckpointCurrentV1(receipts, selected, coverage);
					await withProjectedImageDevelopMaskCoverageCurrentV1(selected.binding, coverage, projected =>
						verifyPixelFrameWebGl2MaskOverlayCurrentV1(receipts, selected, projected.coverage), PROFILE, stop.signal);
				}, stop.signal);
				byteProofMatched = finishPixelFrameWebGl2MaskCheckpointsCurrentV1(receipts);
				if (!byteProofMatched) throw new RangeError('Component GPU coverage/overlay byte proof differs from Current CPU.');
			}, stop.signal);
			proofScopesRetired = true;
			return storage.withCoverage(async view => {
				callbacks++; host = view.coverage.buffer;
				const result = { width: view.width, height: view.height, coverage: [...view.coverage], banksRetiredBeforeDelivery: textures.every(texture => !gl.isTexture(texture)),
					nativeRetiredBeforeDelivery: nativeBackings.every(retired), receiptsRetiredBeforeDelivery: proofScopesRetired && proofStripeBackings.every(retired) };
				if (request.fault === 'proof-after-delivery') {
					try { storage.readStripe(0, 1, new Uint8Array(plan.finalExtent.width)); } catch (error) { if (error instanceof TypeError) proofRejected = true; else throw error; }
				}
				if (request.fault === 'opaque') throw reason.proxy;
				if (request.fault === 'detach-opaque') { structuredClone(host, { transfer: [host] }); throw reason.proxy; }
				if (request.fault === 'held-abort' || request.fault === 'held-loss' || request.fault === 'held-delivery') { entered.resolve(); await release.promise; }
				return result;
			});
		}, stop.signal));
		void task.then(() => { settled = true; });
		if (request.fault === 'held-abort' || request.fault === 'held-loss' || request.fault === 'held-delivery') {
			await Promise.race([entered.promise, task.then(result => { if (!result.ok) throw result.error; throw new Error('Overlay scope settled before held view.'); })]);
			if (request.fault === 'held-abort') stop.abort(reason.proxy);
			else if (request.fault === 'held-loss') {
				const extension = gl.getExtension('WEBGL_lose_context'); if (!extension) throw new Error('Native context-loss seam unavailable.');
				const lost = new Promise<void>(resolve => { canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); resolve(); }, { once: true }); });
				extension.loseContext(); await lost; loss = true;
			}
			await Promise.resolve(); pending = !settled; heldLive = host !== undefined && !retired(host); release.resolve();
		}
		const contains = (error: unknown, predicate: (member: unknown) => boolean): boolean => predicate(error)
			|| !Object.is(error, reason.proxy) && error instanceof AggregateError && error.errors.some((member: unknown) => contains(member, predicate));
		const result = await task;
		let expiredProofRejected = false, expiredTargetUntouched = false;
		if (request.fault === 'proof-expired') {
			const target = new Uint8Array(plan.finalExtent.width); target.fill(199);
			const expiredProof = proofReaders[0];
			if (!expiredProof) throw new Error('Expired proof fixture omitted the captured method.');
			try { expiredProof(0, 1, target); } catch (error) { if (error instanceof TypeError) expiredProofRejected = true; else throw error; }
			expiredTargetUntouched = target.every(value => value === 199); target.fill(0);
		}
		return { ...(result.ok ? result.value : {}), rejected: !result.ok, exactReason: !result.ok && Object.is(result.error, reason.proxy),
			primaryRetained: !result.ok && contains(result.error, error => Object.is(error, reason.proxy)),
			cleanupRetained: !result.ok && contains(result.error, error => !Object.is(error, reason.proxy) && error instanceof TypeError),
			renderer, callbacks, expected, observedCoverage, byteProofMatched, proofStripesRetired: proofStripeBackings.every(retired),
			mode: selected.mode, overlayDraws, integerReads, integerClears, pending, heldLive, loss,
			proofReads, proofBeforeDelivery, proofScopesRetired, proofRejected, expiredProofRejected, expiredTargetUntouched, guardRejected,
			hostRetired: host !== undefined && retired(host), allTexturesRetired: textures.every(texture => !gl.isTexture(texture)), nativeRetired: nativeBackings.every(retired) };
	} finally { release.resolve(); for (const restore of restores.reverse()) restore(); pixels.fill(0); incomingPixels.fill(0); canvas.width = 0; canvas.height = 0; }
}
