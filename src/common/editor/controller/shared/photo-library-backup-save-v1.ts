/* SPDX-License-Identifier: AGPL-3.0-only */

import { withProjectFileExtension } from '../../../project-file-extensions.ts';
import type { BrowserFileSaveRequest, BrowserSavedFile, PreparedBrowserSave } from '../../browser-file-save-service.ts';
import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord } from '../../closed-domain-value.ts';
import type { DirectSavedFile, PreparedDirectSave } from '../../file-save-stream.ts';
import type { PhotoLibraryBackupOptionsV1, PhotoLibraryBackupResultV1 } from '../../photo-library-backup-port-v1.ts';
import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from '../../scape-blob-budget.ts';
import { SCAPE_MIME_TYPE } from '../../scape-project-format.ts';

export interface PhotoLibraryBackupSaveRequestV1 {
	readonly catalogName: string;
	readonly fileTypeDescription: string;
	readonly maximumStreamingBytes: number;
	readonly signal?: AbortSignal;
	readonly prepareSave: (request: BrowserFileSaveRequest) => PreparedBrowserSave | PromiseLike<PreparedBrowserSave>;
	readonly saveFile: (request: BrowserFileSaveRequest) => BrowserSavedFile | PromiseLike<BrowserSavedFile>;
	readonly backupCatalog: (options: PhotoLibraryBackupOptionsV1) => Promise<PhotoLibraryBackupResultV1>;
}

export type PhotoLibraryBackupSaveReceiptV1 = Readonly<{ status: 'cancelled' }> | Readonly<{
	status: 'saved' | 'download-started';
	catalogId: string;
	catalogName: string;
	photoCount: number;
	byteLength: number;
	fileName: string;
	method: 'desktop' | 'file-system-access' | 'download';
	notices: readonly 'cleanup-failed'[];
}>;

interface ActiveSave {
	readonly stop: AbortController;
	readonly joined: Promise<void>;
	committing: boolean;
}
const nativeAbort = AbortSignal.prototype.throwIfAborted;
const nativeAbortReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeBlobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const nativeAddListener = EventTarget.prototype.addEventListener;
const nativeRemoveListener = EventTarget.prototype.removeEventListener;

/** One destination owner for the whole application lifetime, independent of modal/session generations. */
export class PhotoLibraryBackupSaveV1 {
	#active: ActiveSave | null = null;

	isPending(): boolean { return this.#active !== null; }

	/** Deliberately non-async: the injected picker runs in the original Save click stack. */
	start(value: PhotoLibraryBackupSaveRequestV1): Promise<PhotoLibraryBackupSaveReceiptV1> {
		if (this.#active) return Promise.reject(new Error('A photo backup save is already pending.'));
		let request: PhotoLibraryBackupSaveRequestV1;
		try { request = admitRequest(value); } catch (error) { return Promise.reject(error); }
		let settled!: () => void;
		const active: ActiveSave = { stop: new AbortController(), committing: false,
			joined: new Promise<void>(resolve => { settled = resolve; }) };
		this.#active = active;
		const onAbort = () => {
			if (!active.committing && request.signal) active.stop.abort(Reflect.apply(nativeAbortReason, request.signal, []));
		};
		if (request.signal) Reflect.apply(nativeAddListener, request.signal, ['abort', onAbort, { once: true }]);
		let preparation: PreparedBrowserSave | PromiseLike<PreparedBrowserSave>;
		try {
			preparation = request.prepareSave(Object.freeze({ purpose: 'project',
				suggestedName: withProjectFileExtension(request.catalogName, '.liscape'), mimeType: SCAPE_MIME_TYPE,
				types: Object.freeze([{ description: request.fileTypeDescription,
					accept: Object.freeze({ [SCAPE_MIME_TYPE]: Object.freeze(['.liscape']) }) }]),
				useFileSystemAccess: true, signal: active.stop.signal }));
		} catch (error) { preparation = Promise.reject(error); }
		return this.#run(request, active, preparation).finally(() => {
			if (request.signal) Reflect.apply(nativeRemoveListener, request.signal, ['abort', onAbort]);
			if (this.#active === active) this.#active = null;
			settled();
		});
	}

	/** The start promise owns its error; this barrier joins success, cancellation and failed cleanup. */
	cancelAndJoin(reason?: unknown): Promise<void> {
		const active = this.#active;
		if (!active) return Promise.resolve();
		if (!active.committing) active.stop.abort(reason);
		return active.joined;
	}

	async #run(
		request: PhotoLibraryBackupSaveRequestV1, active: ActiveSave,
		preparation: PreparedBrowserSave | PromiseLike<PreparedBrowserSave>,
	): Promise<PhotoLibraryBackupSaveReceiptV1> {
		let direct: PreparedDirectSave | null = null;
		try {
			const prepared = readPrepared(await preparation);
			if (prepared.mode === 'stream') direct = prepared;
			checkSignal(active.stop.signal);
			if (prepared.mode === 'cancelled') return Object.freeze({ status: 'cancelled' });
			if (prepared.mode === 'stream') {
				const writable = await prepared.createWritable(request.maximumStreamingBytes, 'maximum');
				checkSignal(active.stop.signal);
				const archive = readArchiveResult(await request.backupCatalog({ writable, signal: active.stop.signal }), request.maximumStreamingBytes);
				checkSignal(active.stop.signal);
				if (archive.blob !== null || prepared.bytesWritten() !== archive.byteLength) {
					throw new TypeError('Photo backup stream byte length does not match its completed archive.');
				}
				// Archive staging has released its catalog lease. This owner still holds the destination.
				active.committing = true;
				const saved = readSavedFile(await prepared.commit(), archive.byteLength, true);
				direct = null;
				return receipt(archive, saved);
			}
			const archive = readArchiveResult(await request.backupCatalog({ signal: active.stop.signal,
				maximumBlobBytes: SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES }), SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES);
			checkSignal(active.stop.signal);
			if (archive.blob === null || blobSize(archive.blob) !== archive.byteLength) {
				throw new TypeError('Photo backup Blob byte length does not match its completed archive.');
			}
			// Delivery is the irreversible boundary; cancellation now joins its acknowledgment.
			active.committing = true;
			const saved = readSavedFile(await request.saveFile({ purpose: 'project', suggestedName: prepared.fileName,
				mimeType: SCAPE_MIME_TYPE, target: prepared.target, blob: archive.blob,
				useFileSystemAccess: false, signal: active.stop.signal }), archive.byteLength, false);
			return receipt(archive, saved);
		} catch (primary) {
			if (direct) {
				try { await direct.abort(primary); }
				catch (cleanup) { throw new AggregateError([primary, cleanup], 'Photo backup save and destination cleanup failed.', { cause: cleanup }); }
			}
			throw primary;
		}
	}
}

function readPrepared(value: unknown): PreparedBrowserSave {
	const name = 'Photo backup prepared destination';
	const source = readClosedDomainRecord(value, name,
		['mode', 'cancelled', 'fileName', 'target', 'createWritable', 'patchFinalPrefix', 'bytesWritten', 'commit', 'abort', 'savedFile'], ['mode']);
	const mode = field(source, 'mode', name);
	if (mode === 'stream') {
		readClosedDomainRecord(value, name, ['mode', 'createWritable', 'patchFinalPrefix', 'bytesWritten', 'commit', 'abort', 'savedFile']);
		const method = <Key extends Exclude<keyof PreparedDirectSave, 'mode'>>(key: Key): PreparedDirectSave[Key] => {
			const callback = field(source, key, name);
			if (typeof callback !== 'function') throw new TypeError('Photo backup destination requires its native save methods.');
			return Reflect.apply(Function.prototype.bind, callback, [value]) as PreparedDirectSave[Key];
		};
		return Object.freeze({ mode, createWritable: method('createWritable'), patchFinalPrefix: method('patchFinalPrefix'),
			bytesWritten: method('bytesWritten'), commit: method('commit'), abort: method('abort'), savedFile: method('savedFile') });
	}
	if (mode === 'cancelled') {
		readClosedDomainRecord(value, name, ['mode', 'cancelled', 'fileName']);
		if (field(source, 'cancelled', name) !== true) throw new TypeError('Photo backup dismissal requires a cancellation acknowledgment.');
		return Object.freeze({ mode, cancelled: true, fileName: text(field(source, 'fileName', name), 512) });
	}
	if (mode === 'blob') {
		readClosedDomainRecord(value, name, ['mode', 'target', 'fileName']);
		const target = field(source, 'target', name);
		if (!target || typeof target !== 'object') throw new TypeError('Photo backup Blob delivery requires its already selected target.');
		return Object.freeze({ mode, target: target as Extract<PreparedBrowserSave, { mode: 'blob' }>['target'],
			fileName: text(field(source, 'fileName', name), 512) });
	}
	throw new TypeError('Photo backup contains an unsupported destination mode.');
}

function admitRequest(value: unknown): PhotoLibraryBackupSaveRequestV1 {
	const name = 'Photo backup save request';
	const input = readClosedDomainRecord(value, name,
		['catalogName', 'fileTypeDescription', 'maximumStreamingBytes', 'signal', 'prepareSave', 'saveFile', 'backupCatalog'],
		['catalogName', 'fileTypeDescription', 'maximumStreamingBytes', 'prepareSave', 'saveFile', 'backupCatalog']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal', name) : undefined;
	if (signal !== undefined) {
		if (!(signal instanceof AbortSignal)) throw new TypeError('Photo backup save requires a native cancellation signal.');
		checkSignal(signal);
	}
	const prepareSave = field(input, 'prepareSave', name), saveFile = field(input, 'saveFile', name), backupCatalog = field(input, 'backupCatalog', name);
	if (typeof prepareSave !== 'function' || typeof saveFile !== 'function' || typeof backupCatalog !== 'function') {
		throw new TypeError('Photo backup save requires its prepared save and archive ports.');
	}
	return Object.freeze({ catalogName: text(field(input, 'catalogName', name), 256),
		fileTypeDescription: text(field(input, 'fileTypeDescription', name), 256),
		maximumStreamingBytes: integer(field(input, 'maximumStreamingBytes', name), 1), signal: signal as AbortSignal | undefined,
		prepareSave: prepareSave as PhotoLibraryBackupSaveRequestV1['prepareSave'],
		saveFile: saveFile as PhotoLibraryBackupSaveRequestV1['saveFile'],
		backupCatalog: backupCatalog as PhotoLibraryBackupSaveRequestV1['backupCatalog'] });
}

function checkSignal(signal: AbortSignal): void {
	Reflect.apply(nativeAbort, signal, []);
	if (Object.getPrototypeOf(signal) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) {
		throw new TypeError('Photo backup save requires an unmodified native cancellation signal.');
	}
}

function readArchiveResult(value: unknown, maximumBytes: number): PhotoLibraryBackupResultV1 {
	const name = 'Photo backup archive result';
	const input = readClosedDomainRecord(value, name, ['catalogId', 'catalogName', 'photoCount', 'byteLength', 'notices', 'blob']);
	const byteLength = integer(field(input, 'byteLength', name), 1);
	if (byteLength > maximumBytes) throw new RangeError('Photo backup archive exceeds its admitted output byte maximum.');
	const notices = readClosedDomainArray(field(input, 'notices', name), 'Photo backup notices', 0, 1).map(value => {
		if (value !== 'cleanup-failed') throw new TypeError('Photo backup contains an unsupported cleanup notice.');
		return 'cleanup-failed' as const;
	});
	const blob = field(input, 'blob', name);
	if (blob !== null) blobSize(blob);
	return Object.freeze({ catalogId: text(field(input, 'catalogId', name), 128), catalogName: text(field(input, 'catalogName', name), 256),
		photoCount: integer(field(input, 'photoCount', name), 0), byteLength, notices: Object.freeze(notices), blob: blob as Blob | null });
}

function readSavedFile(value: BrowserSavedFile | DirectSavedFile, expectedBytes: number, stream: boolean) {
	const name = 'Photo backup file delivery';
	const input = readClosedDomainRecord(value, name, ['cancelled', 'method', 'fileName', 'size', 'blob'], ['fileName', 'size']);
	const size = integer(field(input, 'size', name), 1);
	if (size !== expectedBytes) throw new TypeError('Photo backup delivered byte length does not match its archive.');
	if (Object.hasOwn(input, 'cancelled') || !Object.hasOwn(input, 'method')) throw new Error('Photo backup file delivery did not complete.');
	const method = field(input, 'method', name);
	if (method !== 'file-system-access' && method !== 'desktop' && method !== 'download') {
		throw new Error('Photo backup file delivery is unavailable.');
	}
	if (stream ? method === 'download' : method === 'desktop') throw new Error('Photo backup delivery method differs from its prepared destination.');
	return Object.freeze({ fileName: text(field(input, 'fileName', name), 512), method });
}

function receipt(archive: PhotoLibraryBackupResultV1, saved: ReturnType<typeof readSavedFile>): PhotoLibraryBackupSaveReceiptV1 {
	return Object.freeze({ status: saved.method === 'download' ? 'download-started' : 'saved',
		catalogId: archive.catalogId, catalogName: archive.catalogName, photoCount: archive.photoCount,
		byteLength: archive.byteLength, fileName: saved.fileName, method: saved.method, notices: archive.notices });
}
function blobSize(value: unknown): number {
	if (!(value instanceof Blob)) throw new TypeError('Photo backup requires a native completed Blob.');
	return Reflect.apply(nativeBlobSize, value, []) as number;
}
function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum) throw new TypeError('Photo backup text exceeds its scalar bound.');
	return value;
}
function integer(value: unknown, minimum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new RangeError('Photo backup requires a bounded non-negative integer.');
	return value;
}
