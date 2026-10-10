/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrowserFileSaveRequest, BrowserSavedFile, PreparedBrowserSave } from '../../common/editor/browser-file-save-service.ts';
import { sanitizeSuggestedSaveName } from '../../common/editor/browser-file-save-service.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { capturePhotoDevelopExecutionContextV2, capturePhotoLibraryDevelopPortV2, detachPhotoLibraryDevelopSettingsV2 } from '../../common/editor/controller/shared/photo-library-develop-command-v2.ts';
import type { ExecutePhotoDevelopV2 } from '../../common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import type { PreparedDirectSave, DirectSavedFile } from '../../common/editor/file-save-stream.ts';
import type { PixelFrameLimitsV1, PixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { readPixelFrameV1 } from '../../common/editor/imaging/pixel-frame-contract-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 as LIMITS } from '../../common/editor/photo-library-develop-full-resolution-port-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../common/editor/photo-library-develop-original-port-v1.ts';
import type { PhotoLibraryDevelopSnapshotV2 } from '../../common/editor/photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopProxyRuntimeV2 } from '../../common/editor/photo-library-develop-proxy-port-v2.ts';

export interface PhotoPngExportRequestV1 {
	readonly photoId: string;
	readonly versionId: string;
	readonly expectedRevision: number;
	readonly fileName: string;
	readonly fileTypeDescription: string;
	readonly signal?: AbortSignal;
	readonly prepareSave: (request: BrowserFileSaveRequest) => PreparedBrowserSave | PromiseLike<PreparedBrowserSave>;
	readonly saveFile: (request: BrowserFileSaveRequest) => BrowserSavedFile | PromiseLike<BrowserSavedFile>;
	readonly execute: ExecutePhotoDevelopV2;
	readonly withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'];
	readonly loadRenderer: () => Promise<Pick<PhotoLibraryDevelopProxyRuntimeV2, 'withFullResolution'>>;
	readonly encode: (frame: Readonly<PixelFrameV1>, options: Readonly<{
		signal: AbortSignal; limits: PixelFrameLimitsV1; maximumOutputBytes: number;
	}>) => Promise<Uint8Array<ArrayBuffer>>;
}

export type PhotoPngExportReceiptV1 = Readonly<{ status: 'cancelled' }> | Readonly<{
	status: 'saved' | 'download-started'; photoId: string; versionId: string; revision: number;
	width: number; height: number; byteLength: number; fileName: string;
	method: 'desktop' | 'file-system-access' | 'download';
}>;

const MAXIMUM_OUTPUT_BYTES = 268_435_456;
const CHECK = AbortSignal.prototype.throwIfAborted;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')!.get!;
const WIPE = Uint8Array.prototype.fill;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
interface ActiveExport { readonly stop: AbortController; readonly joined: Promise<void>; committing: boolean; }

/** A destination lifetime independent of the selected library generation. No frame escapes its borrowed scope. */
export class PhotoPngExportV1 {
	#active: ActiveExport | null = null;
	isPending(): boolean { return this.#active !== null; }

	/** Non-async so the native picker runs in the original Save gesture. */
	start(value: PhotoPngExportRequestV1): Promise<PhotoPngExportReceiptV1> {
		if (this.#active) return Promise.reject(new Error('A photo PNG export is already pending.'));
		let request: PhotoPngExportRequestV1;
		try { request = admitRequest(value); } catch (error) { return Promise.reject(error); }
		let settled!: () => void;
		const active: ActiveExport = { stop: new AbortController(), committing: false,
			joined: new Promise<void>(resolve => { settled = resolve; }) };
		this.#active = active;
		const onAbort = () => { if (!active.committing && request.signal) active.stop.abort(Reflect.apply(REASON, request.signal, [])); };
		if (request.signal) Reflect.apply(ADD, request.signal, ['abort', onAbort, { once: true }]);
		let preparation: PreparedBrowserSave | PromiseLike<PreparedBrowserSave>;
		try { preparation = request.prepareSave({ purpose: 'media', suggestedName: request.fileName, mimeType: 'image/png',
			types: [{ description: request.fileTypeDescription, accept: { 'image/png': ['.png'] } }],
			useFileSystemAccess: true, signal: active.stop.signal }); }
		catch (error) { preparation = Promise.reject(error); }
		return this.#run(request, active, preparation).finally(() => {
			if (request.signal) Reflect.apply(REMOVE, request.signal, ['abort', onAbort]);
			if (this.#active === active) this.#active = null;
			settled();
		});
	}

	/** Retirement joins picker/read/render/encode/write and destination cleanup, including failed cleanup. */
	cancelAndJoin(reason?: unknown): Promise<void> {
		const active = this.#active;
		if (!active) return Promise.resolve();
		if (!active.committing) active.stop.abort(reason);
		return active.joined;
	}

	async #run(request: PhotoPngExportRequestV1, active: ActiveExport,
		preparation: PreparedBrowserSave | PromiseLike<PreparedBrowserSave>): Promise<PhotoPngExportReceiptV1> {
		let direct: PreparedDirectSave | null = null, bytes: Uint8Array<ArrayBuffer> | null = null;
		const outcome: { completed: PhotoPngExportReceiptV1 | null; failure: { value: unknown } | null } = { completed: null, failure: null };
		try {
			const prepared = readPrepared(await preparation);
			if (prepared.mode === 'stream') direct = prepared;
			check(active.stop.signal);
			if (prepared.mode === 'cancelled') return Object.freeze({ status: 'cancelled' });
			await request.execute(async context => {
				let contextAbort: (() => void) | null = null;
				try {
					check(context.signal);
					contextAbort = () => { if (!active.committing) active.stop.abort(Reflect.apply(REASON, context.signal, [])); };
					Reflect.apply(ADD, context.signal, ['abort', contextAbort, { once: true }]);
					const signal = AbortSignal.any([active.stop.signal, context.signal]);
					const scope = capturePhotoDevelopExecutionContextV2(context, signal);
					const current = () => { check(signal); if (!scope.isCurrent()) throw new Error('Photo PNG export generation is stale.'); check(signal); };
					current();
					const port = capturePhotoLibraryDevelopPortV2(await scope.acquire()); current();
					const read = async () => {
						current(); const snapshot = await port.read({ schemaVersion: 2, photoId: request.photoId, versionId: request.versionId }, { signal });
						current(); return readSnapshot(snapshot, request);
					};
					const initial = await read(), develop = detachPhotoLibraryDevelopSettingsV2(initial.develop);
					const runtime = await request.loadRenderer(); current();
					const render = pin<PhotoLibraryDevelopProxyRuntimeV2['withFullResolution']>(runtime.withFullResolution, runtime);
					let width = 0, height = 0;
					await request.withOriginalFrame({ schemaVersion: 1, photoId: request.photoId, expectedRevision: request.expectedRevision }, async original => {
						current();
						const originalView = record(original, 'Photo PNG original', ['photoId', 'revision', 'frame']);
						if (field(originalView, 'photoId', 'Photo PNG original') !== request.photoId
							|| field(originalView, 'revision', 'Photo PNG original') !== request.expectedRevision) throw new Error('Photo PNG original revision or identity changed.');
						const source = readPixelFrameV1(field(originalView, 'frame', 'Photo PNG original'), LIMITS.source);
						await render({ frame: source, develop, signal }, async output => {
							current(); const view = record(output, 'Photo PNG render', ['frame', 'histogram'], ['frame']);
							const frame = readPixelFrameV1(field(view, 'frame', 'Photo PNG render'), LIMITS.render);
							const encoded = await request.encode(frame, { signal, limits: LIMITS.render, maximumOutputBytes: MAXIMUM_OUTPUT_BYTES });
							bytes = readEncoded(encoded, source, frame); width = frame.descriptor.width; height = frame.descriptor.height;
							current();
						});
						current();
					}, { signal });
					// Both renderer and original owner have completed their late checks and cleanup.
					current();
					if (!bytes) throw new Error('Photo PNG renderer did not complete its frame consumer.');
					const png: Uint8Array<ArrayBuffer> = bytes, byteLength = png.byteLength;
					if (prepared.mode === 'stream') {
						const writable = await prepared.createWritable(byteLength, 'exact'); current();
						const writer = writable.getWriter();
						try { await writer.write(png); current(); await writer.close(); }
						finally { writer.releaseLock(); }
						if (prepared.bytesWritten() !== byteLength) throw new Error('Photo PNG staged byte length differs from its encoded output.');
					}
					const final = await read();
					if (final.catalogId !== initial.catalogId) throw new Error('Photo PNG export catalog changed.');
					current(); active.committing = true;
					const saved = prepared.mode === 'stream' ? await prepared.commit()
						: await request.saveFile({ purpose: 'media', suggestedName: prepared.fileName, mimeType: 'image/png',
							target: prepared.target, blob: new Blob([png], { type: 'image/png' }), useFileSystemAccess: false, signal: active.stop.signal });
					const delivery = readSaved(saved, byteLength, prepared.mode === 'stream');
					direct = null;
					outcome.completed = Object.freeze({ status: delivery.method === 'download' ? 'download-started' : 'saved',
						photoId: request.photoId, versionId: request.versionId, revision: request.expectedRevision,
						width, height, byteLength, ...delivery });
				} catch (error) { outcome.failure = { value: error }; throw error; }
				finally { if (contextAbort) Reflect.apply(REMOVE, context.signal, ['abort', contextAbort]); }
			}, active.stop.signal);
			if (outcome.completed) return outcome.completed;
			if (outcome.failure) throw outcome.failure.value;
			check(active.stop.signal);
			throw new Error('Photo PNG export did not execute in its current library generation.');
		} catch (primary) {
			// A completed irreversible ACK survives a late borrowed workflow failure.
			if (outcome.completed) return outcome.completed;
			const error = outcome.failure ? outcome.failure.value : primary;
			if (direct) await abortDestination(direct, error);
			throw error;
		} finally { if (bytes) Reflect.apply(WIPE, bytes, [0]); }
	}
}

async function abortDestination(direct: PreparedDirectSave, primary: unknown): Promise<void> {
	let failure: { value: unknown } | null = null;
	try { await direct.abort(primary); } catch (value) { failure = { value }; }
	if (failure && !Object.is(primary, failure.value)) {
		throw new AggregateError([primary, failure.value], 'Photo PNG export and destination cleanup failed.', { cause: primary });
	}
}

function readSnapshot(value: PhotoLibraryDevelopSnapshotV2, request: PhotoPngExportRequestV1) {
	const input = record(value, 'Photo PNG snapshot', ['schemaVersion', 'catalogId', 'photoId', 'revision', 'activeVersionId', 'versionId', 'versions', 'develop', 'history', 'snapshots']);
	if (field(input, 'schemaVersion', 'Photo PNG snapshot') !== 2 || field(input, 'photoId', 'Photo PNG snapshot') !== request.photoId
		|| field(input, 'versionId', 'Photo PNG snapshot') !== request.versionId || field(input, 'revision', 'Photo PNG snapshot') !== request.expectedRevision) {
		throw new Error('Photo PNG export snapshot revision, schema or identity changed.');
	}
	return { catalogId: text(field(input, 'catalogId', 'Photo PNG snapshot'), 128), develop: field(input, 'develop', 'Photo PNG snapshot') };
}

function readEncoded(value: unknown, source: PixelFrameV1, output: PixelFrameV1): Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype
		|| ['buffer', 'byteLength', 'length', 'byteOffset'].some(key => Object.hasOwn(value, key))) throw new TypeError('Photo PNG encoder requires independent intrinsic bytes.');
	const buffer = value.buffer;
	if (!(buffer instanceof ArrayBuffer) || Reflect.apply(RESIZABLE, buffer, []) || value.byteOffset !== 0 || value.byteLength !== buffer.byteLength
		|| buffer === source.pixels.buffer || buffer === output.pixels.buffer) throw new TypeError('Photo PNG bytes must own a fixed independent buffer.');
	if (value.byteLength < 1 || value.byteLength > MAXIMUM_OUTPUT_BYTES) {
		Reflect.apply(WIPE, value, [0]); throw new RangeError('Photo PNG output exceeds its admitted byte bound.');
	}
	return value as Uint8Array<ArrayBuffer>;
}

function readPrepared(value: unknown): PreparedBrowserSave {
	const name = 'Photo PNG destination', input = record(value, name,
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
		if (field(input, 'cancelled', name) !== true) throw new TypeError('Photo PNG picker dismissal requires its acknowledgment.');
		return Object.freeze({ mode, cancelled: true, fileName: text(field(input, 'fileName', name), 512) });
	}
	if (mode === 'blob') {
		record(value, name, ['mode', 'target', 'fileName']);
		const target = field(input, 'target', name);
		if (!target || typeof target !== 'object') throw new TypeError('Photo PNG delivery requires its selected target.');
		return Object.freeze({ mode, fileName: text(field(input, 'fileName', name), 512), target: target as Extract<PreparedBrowserSave, { mode: 'blob' }>['target'] });
	}
	throw new TypeError('Unsupported Photo PNG destination.');
}

function readSaved(value: BrowserSavedFile | DirectSavedFile, expectedBytes: number, stream: boolean) {
	const input = record(value, 'Photo PNG delivery', ['cancelled', 'method', 'fileName', 'size', 'blob'], ['method', 'fileName', 'size']);
	const method = field(input, 'method', 'Photo PNG delivery');
	if (Object.hasOwn(input, 'cancelled') || field(input, 'size', 'Photo PNG delivery') !== expectedBytes
		|| (stream ? method !== 'desktop' && method !== 'file-system-access' : method !== 'download')) throw new Error('Photo PNG delivery did not acknowledge its exact saved bytes.');
	return { fileName: text(field(input, 'fileName', 'Photo PNG delivery'), 512), method: method as 'desktop' | 'file-system-access' | 'download' };
}

function admitRequest(value: unknown): PhotoPngExportRequestV1 {
	const name = 'Photo PNG request', methods = ['prepareSave', 'saveFile', 'execute', 'withOriginalFrame', 'loadRenderer', 'encode'] as const;
	const required = ['photoId', 'versionId', 'expectedRevision', 'fileName', 'fileTypeDescription', ...methods];
	const input = record(value, name, [...required, 'signal'], required);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', name) : undefined;
	if (signal !== undefined) {
		if (!(signal instanceof AbortSignal)) throw new TypeError('Photo PNG export requires native cancellation.');
		check(signal);
	}
	const revision = field(input, 'expectedRevision', name);
	if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) throw new RangeError('Photo PNG revision must be a nonnegative integer.');
	let fileName = sanitizeSuggestedSaveName(text(field(input, 'fileName', name), 512));
	if (!/\.png$/iu.test(fileName)) fileName += '.png';
	text(fileName, 512);
	const method = <Key extends typeof methods[number]>(key: Key): PhotoPngExportRequestV1[Key] => pin(field(input, key, name), value);
	return Object.freeze({ photoId: stableId(field(input, 'photoId', name)), versionId: stableId(field(input, 'versionId', name)),
		expectedRevision: revision, fileName, fileTypeDescription: text(field(input, 'fileTypeDescription', name), 256), signal: signal as AbortSignal | undefined,
		prepareSave: method('prepareSave'), saveFile: method('saveFile'), execute: method('execute'), withOriginalFrame: method('withOriginalFrame'),
		loadRenderer: method('loadRenderer'), encode: method('encode') });
}
function pin<Method>(value: unknown, receiver: unknown): Method {
	if (typeof value !== 'function') throw new TypeError('Photo PNG export requires its captured methods.');
	return Reflect.apply(Function.prototype.bind, value, [receiver]) as Method;
}
function check(signal: AbortSignal): void {
	Reflect.apply(CHECK, signal, []);
	if (Object.getPrototypeOf(signal) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) throw new TypeError('Photo PNG export requires an unmodified native cancellation signal.');
}
function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || !value.length || value.length > maximum) throw new TypeError('Photo PNG text exceeds its scalar bound.');
	return value;
}
function stableId(value: unknown): string {
	const id = text(value, 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(id)) throw new TypeError('Photo PNG requires stable photo/version identity.');
	return id;
}
