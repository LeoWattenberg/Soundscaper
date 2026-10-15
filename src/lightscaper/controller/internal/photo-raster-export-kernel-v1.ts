/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoRasterExportSidecarKernelV1 } from './photo-raster-export-sidecar-kernel-v1.ts';
import type { PhotoRasterSidecarReceipt } from '../photo-raster-export-sidecar.ts';
import { capturePhotoRasterExportOutput, PhotoRasterExportMetadataRefusal, isPhotoRasterExportMetadataRefusal, type PhotoRasterExportRequest, type PhotoRasterExportRequestCurrentV1, type PhotoRasterExportProfileV1, type PhotoRasterExportReceipt, type ReadPhotoExportMetadata } from '../photo-raster-export-contract-v1.ts';
import type { ReadPhotoExportSidecar } from '../../../common/editor/photo-library-session-port-v2.ts';
import type { BrowserSavedFile, PreparedBrowserSave } from '../../../common/editor/browser-file-save-service.ts';
import { sanitizeSuggestedSaveName } from '../../../common/editor/browser-file-save-service.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { capturePhotoDevelopExecutionContextV2, capturePhotoLibraryDevelopPortV2, detachPhotoLibraryDevelopSettingsV2 } from '../../../common/editor/controller/shared/photo-library-develop-command-v2.ts';
import type { PreparedDirectSave, DirectSavedFile } from '../../../common/editor/file-save-stream.ts';
import type { PixelFrameV1 } from '../../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { readPixelFrameV1 } from '../../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { withExportResizedPixelFrameV1 } from '../../../common/editor/imaging/pixel-frame-export-resize-v1.ts';
import { withDetailSharpenPixelFrameV1 } from '../../../common/editor/imaging/pixel-frame-sharpen-v1.ts';
import { DETAIL_SHARPEN_EFFECT_TYPE_V1 } from '../../../common/editor/video-sharpen-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 as LIMITS } from '../../../common/editor/photo-library-develop-full-resolution-port-v1.ts';
import type { PhotoDevelopExecutionContextV2 } from '../../../common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import type { PhotoDevelopExecutionContextCurrentV1 } from '../../../common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import { capturePhotoDevelopExecutionContextCurrentV1, capturePhotoLibraryDevelopPortCurrentV1, detachPhotoLibraryDevelopSettingsCurrentV1 } from '../../../common/editor/controller/shared/photo-library-develop-command-current-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV2 } from '../../../common/editor/photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibraryDevelopProxyRuntimeCurrentV1 } from '../../../common/editor/photo-library-develop-proxy-port-current-v1.ts';
import { capturePhotoRasterExportSourceCurrentV1, preparePhotoRasterNativeRetainedBytesCurrentV1 } from './photo-raster-export-source-current-v1.ts';

import { normalizeImageMetadataV1 } from '../../../common/editor/imaging/image-metadata-normalizer-v1.ts';
import { withImageExifContainerV1 } from '../../../common/editor/imaging/image-exif-container-v1.ts';
import type { ImageExifMetadataV1 } from '../../../common/editor/imaging/image-metadata-model-v1.ts';
import { captureImageExportGraphicRequest, imageExportGraphicPlacement } from '../../../common/editor/image-export-graphic-request.ts';
import type { withImageExportGraphicFrameV1 } from '../../../common/editor/imaging/image-export-graphic-source-v1.ts';
import type { withImageExportTextFrameV1 } from '../../../common/editor/imaging/image-export-text-frame-v1.ts';
import { capturePhotoRasterExportOutputCurrentV1, type PhotoRasterExportOutputCurrentV1 } from '../photo-raster-export-output-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../../common/editor/photo-library-develop-linear-port-v1.ts';
import { withPhotoRasterLinearOriginalCurrentV1, withPhotoRasterLinearOutputCurrentV1 } from './photo-raster-export-linear-current-v1.ts';

const MAXIMUM_OUTPUT_BYTES = 268_435_456;
const CHECK = AbortSignal.prototype.throwIfAborted;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')!.get!;
const SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const WIPE = Uint8Array.prototype.fill;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
interface ActiveExport { readonly stop: AbortController; readonly joined: Promise<void>; committing: boolean; }

/** A destination lifetime independent of the selected library generation. No frame escapes its borrowed scope. */
export class PhotoRasterExportKernelV1 {
	readonly #profile: PhotoRasterExportProfileV1;
	readonly #format: 'png' | 'jpeg';
	get extension(): '.png' | '.jpg' { return this.#format === 'png' ? '.png' : '.jpg'; }
	get mimeType(): 'image/png' | 'image/jpeg' { return this.#format === 'png' ? 'image/png' : 'image/jpeg'; }
	constructor(profile: PhotoRasterExportProfileV1, format: 'png' | 'jpeg') {
		if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported photo raster profile.');
		this.#profile = profile;
		if (format !== 'png' && format !== 'jpeg') throw new TypeError('Unsupported photo raster export.');
		this.#format = format;
	}
	#active: ActiveExport | null = null;
	#retry: { request: Request; sidecar: PhotoRasterExportSidecarKernelV1; receipt: Exclude<PhotoRasterExportReceipt, { status: 'cancelled' }> } | null = null;
	isPending(): boolean { return this.#active !== null; }

	/** Non-async so the native picker runs in the original Save gesture. */
	start(value: Request): Promise<PhotoRasterExportReceipt> {
		if (this.#active) return Promise.reject(new Error('A photo raster export is already pending.'));
		let request: Request, sidecar: PhotoRasterExportSidecarKernelV1 | null;
		try { request = admitRequest(value, this.extension, this.#profile, this.#format); sidecar = request.sidecar ? new PhotoRasterExportSidecarKernelV1(this.#profile, request.sidecar, request.saveFile) : null; } catch (error) { return Promise.reject(error); }
		let settled!: () => void;
		const active: ActiveExport = { stop: new AbortController(), committing: false,
			joined: new Promise<void>(resolve => { settled = resolve; }) };
		this.#active = active; this.#retry = null;
		const onAbort = () => { if (!active.committing && request.signal) active.stop.abort(Reflect.apply(REASON, request.signal, [])); };
		if (request.signal) Reflect.apply(ADD, request.signal, ['abort', onAbort, { once: true }]);
		let preparation: PreparedBrowserSave | PromiseLike<PreparedBrowserSave>;
		try { preparation = request.prepareSave({ purpose: 'media', suggestedName: request.fileName, mimeType: this.mimeType,
			types: [{ description: request.fileTypeDescription, accept: { [this.mimeType]: [this.extension] } }],
			useFileSystemAccess: true, signal: active.stop.signal }); }
		catch (error) { preparation = Promise.reject(error); }
		return this.#run(request, active, preparation, sidecar).finally(() => {
			if (request.signal) Reflect.apply(REMOVE, request.signal, ['abort', onAbort]);
			if (this.#active === active) this.#active = null;
			settled();
		});
	}

	/** Retry only the explicit JSON download, within the original captured generation and facts. */
	retrySidecar(): Promise<PhotoRasterExportReceipt> {
		const retry = this.#retry;
		if (this.#active || !retry) return Promise.reject(new Error('No completed raster with a retryable sidecar is available.'));
		let settled!: () => void;
		const active: ActiveExport = { stop: new AbortController(), committing: false, joined: new Promise<void>(resolve => { settled = resolve; }) };
		this.#active = active;
		return (async () => {
			let result: PhotoRasterSidecarReceipt | null = null;
			try {
				await execute(retry.request, async context => {
					const signal = AbortSignal.any([active.stop.signal, context.signal, ...(retry.request.signal ? [retry.request.signal] : [])]);
					const scope = captureScope(this.#profile, context, signal);
					const current = () => { check(signal); if (!scope.isCurrent()) throw new Error('Photo sidecar export generation is stale.'); };
					try { current(); await retry.sidecar.verify(signal); current(); result = await retry.sidecar.deliver(retry.receipt.fileName, signal); }
					catch (error) { result = retry.sidecar.failure(retry.receipt.fileName, signal, error); }
				}, active.stop.signal);
			} catch (error) { result ??= retry.sidecar.failure(retry.receipt.fileName, active.stop.signal, error); }
			result ??= retry.sidecar.failure(retry.receipt.fileName, active.stop.signal, new Error('Photo sidecar retry did not enter its selected generation.'));
			const receipt = Object.freeze({ ...retry.receipt, sidecar: result });
			this.#retry = result.status === 'download-started' ? null : { ...retry, receipt }; return receipt;
		})().finally(() => { if (this.#active === active) this.#active = null; settled(); });
	}

	/** Retirement joins picker/read/render/encode/write and destination cleanup, including failed cleanup. */
	cancelAndJoin(reason?: unknown): Promise<void> {
		const active = this.#active;
		if (!active) return Promise.resolve();
		if (!active.committing) active.stop.abort(reason);
		return active.joined;
	}

	async #run(request: Request, active: ActiveExport,
		preparation: PreparedBrowserSave | PromiseLike<PreparedBrowserSave>, sidecar: PhotoRasterExportSidecarKernelV1 | null): Promise<PhotoRasterExportReceipt> {
		let direct: PreparedDirectSave | null = null, bytes: Uint8Array<ArrayBuffer> | null = null;
		const outcome: { completed: PhotoRasterExportReceipt | null; failure: { value: unknown } | null } = { completed: null, failure: null };
		try {
			const prepared = readPrepared(await preparation);
			if (prepared.mode === 'stream') direct = prepared;
			check(active.stop.signal);
			if (prepared.mode === 'cancelled') return Object.freeze({ status: 'cancelled' });
			await execute(request, async context => {
				let contextAbort: (() => void) | null = null;
				try {
					check(context.signal);
					contextAbort = () => { if (!active.committing) active.stop.abort(Reflect.apply(REASON, context.signal, [])); };
					Reflect.apply(ADD, context.signal, ['abort', contextAbort, { once: true }]);
					const signal = AbortSignal.any([active.stop.signal, context.signal]);
					const scope = captureScope(this.#profile, context, signal);
					const current = () => { check(signal); if (!scope.isCurrent()) throw new Error('Photo raster export generation is stale.'); check(signal); };
					current();
					const acquired = await scope.acquire(); current();
					const port = this.#profile === 'current3' ? capturePhotoLibraryDevelopPortCurrentV1(acquired as Parameters<typeof capturePhotoLibraryDevelopPortCurrentV1>[0])
						: capturePhotoLibraryDevelopPortV2(acquired as Parameters<typeof capturePhotoLibraryDevelopPortV2>[0]); current();
					const read = async () => {
						current(); const snapshot: unknown = await Reflect.apply(port.read, port, [{ schemaVersion: this.#profile === 'current3' ? 3 : 2, photoId: request.photoId, versionId: request.versionId }, { signal }]);
						current(); return readSnapshot(snapshot, request, this.#profile);
					};
					const initial = await read(), develop = this.#profile === 'current3' ? detachPhotoLibraryDevelopSettingsCurrentV1(initial.develop) : detachPhotoLibraryDevelopSettingsV2(initial.develop);
					const withSource = this.#profile === 'current3' ? capturePhotoRasterExportSourceCurrentV1(request, develop) : request.withOriginalFrame;
					if (sidecar) await sidecar.capture({ catalogId: initial.catalogId, photoId: request.photoId, versionId: request.versionId, expectedRevision: request.expectedRevision }, develop, signal); current();
					let exif: Readonly<ImageExifMetadataV1> | null = null;
					if (request.output?.metadataScope === 'capture') {
						try {
							const metadata = await request.readMetadata!(request.photoId, request.expectedRevision, { signal }); current();
							exif = readCaptureMetadata(metadata, request, initial.catalogId);
						} catch (error) { current(); throw new PhotoRasterExportMetadataRefusal(error); }
					}
					const runtime = await request.loadRenderer(); current();
					const render = pin<PhotoLibraryDevelopProxyRuntimeV2['withFullResolution'] | PhotoLibraryDevelopProxyRuntimeCurrentV1['withFullResolution']>(runtime.withFullResolution, runtime);
					let width = 0, height = 0;
					const renderWithSource = (admittedGraphic?: Readonly<PixelFrameV1> | null) => withSource({ schemaVersion: 1, photoId: request.photoId, expectedRevision: request.expectedRevision }, async original => {
						current();
						const originalView = record(original, 'Photo raster original', ['photoId', 'revision', 'frame']);
						if (field(originalView, 'photoId', 'Photo raster original') !== request.photoId
							|| field(originalView, 'revision', 'Photo raster original') !== request.expectedRevision) throw new Error('Photo raster original revision or identity changed.');
						const source = readPixelFrameV1(field(originalView, 'frame', 'Photo raster original'), this.#profile === 'current3' ? PHOTO_DEVELOP_LINEAR_LIMITS_V1.source : LIMITS.source);
						const bitDepth = request.output && 'bitDepth' in request.output ? request.output.bitDepth : 8;
						const renderOriginal = async (graphic: Readonly<PixelFrameV1> | null) => {
							const text = request.output?.textWatermark;
							const mark = graphic || text?.opacity ? (await import('../../../common/editor/imaging/pixel-frame-graphic-watermark-v1.ts')).withGraphicWatermarkPixelFrameV1 : null;
							current();
							const retainedSourceBytes = this.#profile === 'current3' && (source.descriptor.sampleFormat !== 'unorm8' || bitDepth === 16)
								? preparePhotoRasterNativeRetainedBytesCurrentV1(source, graphic, graphic ? request.graphicWatermark?.body : undefined) : 0;
							const renderInput = async (input: Readonly<PixelFrameV1>) => { await Reflect.apply(render, undefined, [{ frame: input, develop, signal }, async (output: unknown) => {
								current(); const view = record(output, 'Photo raster render', ['frame', 'histogram'], ['frame']);
								const frame = readPixelFrameV1(field(view, 'frame', 'Photo raster render'), this.#profile === 'current3' ? PHOTO_DEVELOP_LINEAR_LIMITS_V1.render : LIMITS.render);
								if (this.#profile === 'current3' && (frame.descriptor.sampleFormat === 'float32' || bitDepth === 16)) {
									await withPhotoRasterLinearOutputCurrentV1({ frame, originals: [source, input], output: request.output, bitDepth,
										graphic, graphicWatermark: request.graphicWatermark, withTextFrame: request.withTextFrame, retainedSourceBytes, signal, current },
									async (final, limits, maximumOutputBytes, borrowed) => {
										current(); const encoded = await request.encode(final, { signal, limits, maximumOutputBytes, ...(bitDepth === 16 ? { bitDepth } : {}) });
										bytes = readEncoded(encoded, maximumOutputBytes, ...borrowed); width = final.descriptor.width; height = final.descriptor.height; current();
									});
									return;
								}
								const encode = async (delivery: Readonly<PixelFrameV1>, resized: Readonly<PixelFrameV1>) => {
									const encodeOutput = async (marked: Readonly<PixelFrameV1>) => {
										const finish = async (final: Readonly<PixelFrameV1>, glyph: Readonly<PixelFrameV1> | null) => {
											current(); const encoded = await request.encode(final, { signal, limits: LIMITS.render, maximumOutputBytes: MAXIMUM_OUTPUT_BYTES });
											bytes = readEncoded(encoded, MAXIMUM_OUTPUT_BYTES, source, frame, resized, delivery, marked, final, ...(graphic ? [graphic] : []), ...(glyph ? [glyph] : []));
											width = final.descriptor.width; height = final.descriptor.height; current();
										};
										if (text?.opacity && mark) {
											const readText = request.withTextFrame ?? (await import('../../../common/editor/imaging/image-export-text-frame-v1.ts')).withImageExportTextFrameV1;
											current(); await readText({ text, width: marked.descriptor.width, height: marked.descriptor.height, signal }, async glyph => {
												if (!glyph) throw new Error('Enabled text export did not produce its glyph plane.');
												await mark({ frame: marked, graphic: glyph, placement: imageExportGraphicPlacement(text, marked.descriptor.width, marked.descriptor.height), signal },
													output => finish(readPixelFrameV1(output, LIMITS.render), glyph), { limits: LIMITS.render,
														maximumWorkingBytes: MAXIMUM_OUTPUT_BYTES - glyph.pixels.byteLength - (graphic?.pixels.byteLength ?? 0) });
											});
										} else await finish(marked, null);
									};
									if (graphic && mark && request.graphicWatermark) await mark({ frame: delivery, graphic,
										placement: imageExportGraphicPlacement(request.graphicWatermark, delivery.descriptor.width, delivery.descriptor.height), signal },
										output => encodeOutput(readPixelFrameV1(output, LIMITS.render)), { limits: LIMITS.render, maximumWorkingBytes: MAXIMUM_OUTPUT_BYTES - graphic.pixels.byteLength });
									else await encodeOutput(delivery);
								};
								const deliver = async (resized: Readonly<PixelFrameV1>) => {
									current(); const sharpen = request.output?.sharpen;
									if (sharpen && sharpen.amount !== 0) {
										await withDetailSharpenPixelFrameV1({ frame: resized, signal, effect: { id: 'photo-output-sharpen',
											type: DETAIL_SHARPEN_EFFECT_TYPE_V1, enabled: true, params: sharpen } }, output => encode(readPixelFrameV1(output, LIMITS.render), resized), { limits: LIMITS.render });
									} else await encode(resized, resized);
								};
								if (request.output && request.output.sizing.kind !== 'original') {
									await withExportResizedPixelFrameV1({ frame, sizing: request.output.sizing, quality: request.output.quality, signal }, deliver, { limits: LIMITS.render });
								} else await deliver(frame);
								current();
							}]); };
							if (this.#profile === 'current3') await withPhotoRasterLinearOriginalCurrentV1(source, bitDepth, renderInput, signal);
							else await renderInput(source);
							current();
						};
						if (admittedGraphic !== undefined) await renderOriginal(admittedGraphic);
						else if (request.graphicWatermark && request.graphicWatermark.opacity !== 0) {
							const withGraphic = request.withGraphicFrame ?? (await import('../../../common/editor/imaging/image-export-graphic-source-v1.ts')).withImageExportGraphicFrameV1;
							current(); await withGraphic({ body: request.graphicWatermark.body, signal }, graphic => renderOriginal(graphic));
						} else await renderOriginal(null);
					}, { signal });
					if (this.#profile === 'legacy2' && request.graphicWatermark && request.graphicWatermark.opacity !== 0) {
						const withGraphic = request.withGraphicFrame ?? (await import('../../../common/editor/imaging/image-export-graphic-source-v1.ts')).withImageExportGraphicFrameV1;
						current(); await withGraphic({ body: request.graphicWatermark.body, signal }, graphic => renderWithSource(graphic));
					} else await renderWithSource();
					// Both renderer and original owner have completed their late checks and cleanup.
					current();
					if (!bytes) throw new Error('Photo raster renderer did not complete its frame consumer.');
					const publish = async (output: Uint8Array<ArrayBuffer>) => {
						current(); const byteLength = output.byteLength;
						if (prepared.mode === 'stream') {
							const writable = await prepared.createWritable(byteLength, 'exact'); current();
							const writer = writable.getWriter();
							try { await writer.write(output); current(); await writer.close(); }
							finally { writer.releaseLock(); }
							if (prepared.bytesWritten() !== byteLength) throw new Error('Photo raster staged byte length differs from its encoded output.');
						}
						const final = await read();
						if (final.catalogId !== initial.catalogId) throw new Error('Photo raster export catalog changed.');
						if (sidecar) await sidecar.verify(signal);
						current(); active.committing = true;
						const saved = prepared.mode === 'stream' ? await prepared.commit()
							: await request.saveFile({ purpose: 'media', suggestedName: prepared.fileName, mimeType: this.mimeType,
								target: prepared.target, blob: new Blob([output], { type: this.mimeType }), useFileSystemAccess: false, signal: active.stop.signal });
						const delivery = readSaved(saved, byteLength, prepared.mode === 'stream');
						direct = null;
						outcome.completed = Object.freeze({ status: delivery.method === 'download' ? 'download-started' : 'saved',
							photoId: request.photoId, versionId: request.versionId, revision: request.expectedRevision,
							width, height, byteLength, ...delivery });
						if (sidecar) {
							active.committing = false;
							const receipt = outcome.completed;
							const extra = await sidecar.deliver(receipt.fileName, signal);
							outcome.completed = Object.freeze({ ...receipt, sidecar: extra });
							if (extra.status !== 'download-started') this.#retry = { request, sidecar, receipt: outcome.completed };
						}
					};
					if (request.output?.metadataScope === 'capture') {
						let entered = false;
						try {
							const compose = this.#profile === 'current3'
								? (await import('../../../common/editor/imaging/image-exif-container-current-v1.ts')).withImageExifContainerCurrentV1 : withImageExifContainerV1;
							current(); await compose({ format: this.#format, bytes, exif, width, height, scope: 'capture' }, async output => {
								entered = true;
								try { await publish(output); } catch (error) {
									// Keep composed bytes alive through the exact destination's abort/drain.
									if (direct) { const retiring = direct; direct = null; await abortDestination(retiring, error); }
									throw error;
								}
							}, { signal, maximumOutputBytes: MAXIMUM_OUTPUT_BYTES });
						} catch (error) { if (!entered) { current(); throw new PhotoRasterExportMetadataRefusal(error); } throw error; }
					} else await publish(bytes);
				} catch (error) {
					outcome.failure = { value: error };
					if (isPhotoRasterExportMetadataRefusal(error)) {
						if (direct) {
							const retiring = direct; direct = null;
							try { await abortDestination(retiring, error); } catch (cleanup) { outcome.failure = { value: cleanup }; throw cleanup; }
						}
						return; // Recoverable metadata refusal must not poison the workflow's presentation error.
					}
					throw error;
				}
				finally { if (contextAbort) Reflect.apply(REMOVE, context.signal, ['abort', contextAbort]); }
			}, active.stop.signal);
			if (outcome.completed) return outcome.completed;
			if (outcome.failure) throw outcome.failure.value;
			check(active.stop.signal);
			throw new Error('Photo raster export did not execute in its current library generation.');
		} catch (primary) {
			// A completed irreversible ACK survives a late borrowed workflow failure.
			if (outcome.completed) return outcome.completed;
			const error = outcome.failure ? outcome.failure.value : primary;
			if (direct) await abortDestination(direct, error);
			throw error;
		} finally { if (bytes) Reflect.apply(WIPE, bytes, [0]); }
	}
}

function readCaptureMetadata(value: unknown, request: Request, catalogId: string): Readonly<ImageExifMetadataV1> | null {
	const envelope = record(value, 'Photo export metadata', ['catalogId', 'snapshot']);
	if (field(envelope, 'catalogId', 'Photo export metadata') !== catalogId) throw new Error('Photo export metadata catalog changed.');
	const snapshot = record(field(envelope, 'snapshot', 'Photo export metadata'), 'Photo export metadata snapshot',
		['photoId', 'revision', 'metadata', 'extracted', 'originalFileName', 'originalSha256']);
	if (field(snapshot, 'photoId', 'Photo export metadata snapshot') !== request.photoId
		|| field(snapshot, 'revision', 'Photo export metadata snapshot') !== request.expectedRevision) throw new Error('Photo export metadata revision or identity changed.');
	const extracted = field(snapshot, 'extracted', 'Photo export metadata snapshot');
	return extracted === null ? null : normalizeImageMetadataV1(extracted).exif;
}

async function abortDestination(direct: PreparedDirectSave, primary: unknown): Promise<void> {
	let failure: { value: unknown } | null = null;
	try { await direct.abort(primary); } catch (value) { failure = { value }; }
	if (failure && !Object.is(primary, failure.value)) {
		throw new AggregateError([primary, failure.value], 'Photo raster export and destination cleanup failed.', { cause: primary });
	}
}

function readSnapshot(value: unknown, request: Request, profile: PhotoRasterExportProfileV1) {
	const input = record(value, 'Photo raster snapshot', ['schemaVersion', 'catalogId', 'photoId', 'revision', 'activeVersionId', 'versionId', 'versions', 'develop', 'history', 'snapshots']);
	if (field(input, 'schemaVersion', 'Photo raster snapshot') !== (profile === 'current3' ? 3 : 2) || field(input, 'photoId', 'Photo raster snapshot') !== request.photoId
		|| field(input, 'versionId', 'Photo raster snapshot') !== request.versionId || field(input, 'revision', 'Photo raster snapshot') !== request.expectedRevision) {
		throw new Error('Photo raster export snapshot revision, schema or identity changed.');
	}
	if (request.sidecar && field(input, 'activeVersionId', 'Photo raster snapshot') !== request.versionId) throw new Error('Photo sidecar active saved version changed.');
	return { catalogId: text(field(input, 'catalogId', 'Photo raster snapshot'), 128), develop: field(input, 'develop', 'Photo raster snapshot') };
}

function readEncoded(value: unknown, maximumBytes: number, ...frames: Readonly<PixelFrameV1>[]): Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype
		|| ['buffer', 'byteLength', 'length', 'byteOffset'].some(key => Object.hasOwn(value, key))) throw new TypeError('Photo raster encoder requires independent intrinsic bytes.');
	const buffer = value.buffer;
	if (!(buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, buffer, []) || value.byteOffset !== 0 || value.byteLength !== Reflect.apply(SIZE, buffer, [])
		|| frames.some(frame => buffer === Reflect.apply(BUFFER, frame.pixels, []))) throw new TypeError('Photo raster bytes must own a fixed independent buffer.');
	if (value.byteLength < 1 || value.byteLength > maximumBytes) {
		Reflect.apply(WIPE, value, [0]); throw new RangeError('Photo raster output exceeds its admitted byte bound.');
	}
	return value as Uint8Array<ArrayBuffer>;
}

function readPrepared(value: unknown): PreparedBrowserSave {
	const name = 'Photo raster destination', input = record(value, name,
		['mode', 'cancelled', 'fileName', 'target', 'createWritable', 'patchFinalPrefix', 'bytesWritten', 'commit', 'abort', 'savedFile'], ['mode']);
	const mode = field(input, 'mode', name);
	if (mode === 'stream') {
		record(value, name, ['mode', 'createWritable', 'patchFinalPrefix', 'bytesWritten', 'commit', 'abort', 'savedFile']);
		const method = <Key extends Exclude<keyof PreparedDirectSave, 'mode'>>(key: Key): PreparedDirectSave[Key] => pin(field(input, key, name), value);
		return Object.freeze({ mode, createWritable: method('createWritable'), patchFinalPrefix: method('patchFinalPrefix'),
			bytesWritten: method('bytesWritten'), commit: method('commit'), abort: method('abort'), savedFile: method('savedFile') });
	}
	if (mode === 'cancelled') {
		record(value, name, ['mode', 'cancelled', 'fileName']);
		if (field(input, 'cancelled', name) !== true) throw new TypeError('Photo raster picker dismissal requires its acknowledgment.');
		return Object.freeze({ mode, cancelled: true, fileName: text(field(input, 'fileName', name), 512) });
	}
	if (mode === 'blob') {
		record(value, name, ['mode', 'target', 'fileName']);
		const target = field(input, 'target', name);
		if (!target || typeof target !== 'object') throw new TypeError('Photo raster delivery requires its selected target.');
		return Object.freeze({ mode, fileName: text(field(input, 'fileName', name), 512), target: target as Extract<PreparedBrowserSave, { mode: 'blob' }>['target'] });
	}
	throw new TypeError('Unsupported Photo raster destination.');
}

function readSaved(value: BrowserSavedFile | DirectSavedFile, expectedBytes: number, stream: boolean) {
	const input = record(value, 'Photo raster delivery', ['cancelled', 'method', 'fileName', 'size', 'blob'], ['method', 'fileName', 'size']);
	const method = field(input, 'method', 'Photo raster delivery');
	if (Object.hasOwn(input, 'cancelled') || field(input, 'size', 'Photo raster delivery') !== expectedBytes
		|| (stream ? method !== 'desktop' && method !== 'file-system-access' : method !== 'download')) throw new Error('Photo raster delivery did not acknowledge its exact saved bytes.');
	return { fileName: text(field(input, 'fileName', 'Photo raster delivery'), 512), method: method as 'desktop' | 'file-system-access' | 'download' };
}

function admitRequest(value: unknown, extension: '.png' | '.jpg', profile: PhotoRasterExportProfileV1, format: 'png' | 'jpeg'): Request {
	const name = 'Photo raster request', methods = ['prepareSave', 'saveFile', 'execute', 'withOriginalFrame', 'loadRenderer', 'encode'] as const;
	const required = ['photoId', 'versionId', 'expectedRevision', 'fileName', 'fileTypeDescription', ...methods];
	const input = record(value, name, [...required, 'signal', 'output', 'readMetadata', 'sidecar', 'graphicWatermark', 'withGraphicFrame', 'withTextFrame', ...(profile === 'current3' ? ['withDerivedFrame'] : [])], required);
	const withDerivedFrame = Object.hasOwn(input, 'withDerivedFrame') ? pin<NonNullable<PhotoRasterExportRequestCurrentV1['withDerivedFrame']>>(field(input, 'withDerivedFrame', name), value) : undefined;
	const output = Object.hasOwn(input, 'output') ? profile === 'current3' ? capturePhotoRasterExportOutputCurrentV1(field(input, 'output', name), format) : capturePhotoRasterExportOutput(field(input, 'output', name)) : undefined;
	const graphicWatermark = Object.hasOwn(input, 'graphicWatermark') ? captureImageExportGraphicRequest(field(input, 'graphicWatermark', name)) : undefined;
	const withGraphicFrame = Object.hasOwn(input, 'withGraphicFrame') ? pin<typeof withImageExportGraphicFrameV1>(field(input, 'withGraphicFrame', name), value) : undefined;
	const withTextFrame = Object.hasOwn(input, 'withTextFrame') ? pin<typeof withImageExportTextFrameV1>(field(input, 'withTextFrame', name), value) : undefined;
	const sidecar = Object.hasOwn(input, 'sidecar') ? record(field(input, 'sidecar', name), 'Photo sidecar export', ['read']) : undefined;
	const capturedSidecar = sidecar ? Object.freeze({ read: pin<ReadPhotoExportSidecar>(field(sidecar, 'read', 'Photo sidecar export'), sidecar) }) : undefined;
	const metadataRead = Object.hasOwn(input, 'readMetadata') ? pin<ReadPhotoExportMetadata>(field(input, 'readMetadata', name), value) : undefined;
	if (output?.metadataScope === 'capture' && !metadataRead) throw new TypeError('Capture export requires its selected metadata reader.');
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', name) : undefined;
	if (signal !== undefined) {
		if (!(signal instanceof AbortSignal)) throw new TypeError('Photo raster export requires native cancellation.');
		check(signal);
	}
	const revision = field(input, 'expectedRevision', name);
	if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new RangeError('Photo raster revision must be a nonnegative integer.');
	let fileName = sanitizeSuggestedSaveName(text(field(input, 'fileName', name), 512));
	if (!fileName.toLowerCase().endsWith(extension)) fileName += extension;
	text(fileName, 512);
	const method = <Key extends typeof methods[number]>(key: Key): Request[Key] => pin(field(input, key, name), value);
	return Object.freeze({ photoId: stableId(field(input, 'photoId', name)), versionId: stableId(field(input, 'versionId', name)),
		expectedRevision: revision, fileName, fileTypeDescription: text(field(input, 'fileTypeDescription', name), 256), signal: signal as AbortSignal | undefined,
		prepareSave: method('prepareSave'), saveFile: method('saveFile'), execute: method('execute'), withOriginalFrame: method('withOriginalFrame'),
		loadRenderer: method('loadRenderer'), encode: method('encode'), output, readMetadata: metadataRead, sidecar: capturedSidecar, graphicWatermark, withGraphicFrame, withTextFrame, ...(withDerivedFrame ? { withDerivedFrame } : {}) });
}
function pin<Method>(value: unknown, receiver: unknown): Method {
	if (typeof value !== 'function') throw new TypeError('Photo raster export requires its captured methods.');
	return ((...args: unknown[]): unknown => Reflect.apply(value, receiver, args)) as Method;
}
function check(signal: AbortSignal): void {
	Reflect.apply(CHECK, signal, []);
	if (Object.getPrototypeOf(signal) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) throw new TypeError('Photo raster export requires an unmodified native cancellation signal.');
}
function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || !value.length || value.length > maximum) throw new TypeError('Photo raster text exceeds its scalar bound.');
	return value;
}
function stableId(value: unknown): string {
	const id = text(value, 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) throw new TypeError('Photo raster requires stable photo/version identity.');
	return id;
}

interface Request extends Omit<PhotoRasterExportRequest, 'execute' | 'loadRenderer' | 'output' | 'encode'> {
	readonly execute: PhotoRasterExportRequest['execute'] | PhotoRasterExportRequestCurrentV1['execute'];
	readonly loadRenderer: PhotoRasterExportRequest['loadRenderer'] | PhotoRasterExportRequestCurrentV1['loadRenderer'];
	readonly output?: PhotoRasterExportOutputCurrentV1;
	readonly encode: PhotoRasterExportRequestCurrentV1['encode'];
	readonly withDerivedFrame?: PhotoRasterExportRequestCurrentV1['withDerivedFrame'];
}
type Context = PhotoDevelopExecutionContextV2 | PhotoDevelopExecutionContextCurrentV1;
function execute(request: Request, run: (context: Context) => Promise<void>, signal: AbortSignal): ReturnType<PhotoRasterExportRequest['execute']> {
	return Reflect.apply(request.execute, undefined, [run, signal]) as ReturnType<PhotoRasterExportRequest['execute']>;
}
function captureScope(profile: PhotoRasterExportProfileV1, context: Context, signal: AbortSignal): Readonly<Context> {
	return profile === 'current3' ? capturePhotoDevelopExecutionContextCurrentV1(context as PhotoDevelopExecutionContextCurrentV1, signal)
		: capturePhotoDevelopExecutionContextV2(context as PhotoDevelopExecutionContextV2, signal);
}
