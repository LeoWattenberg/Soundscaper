/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrowserFileSaveRequest, BrowserSavedFile, PreparedBrowserSave } from '../../common/editor/browser-file-save-service.ts';
import { sanitizeSuggestedSaveName } from '../../common/editor/browser-file-save-service.ts';
import type { PreparedDirectSave } from '../../common/editor/file-save-stream.ts';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../common/editor/closed-domain-value.ts';
import type { PhotoLibraryImageHandoffPortV1, PhotoLibraryImageHandoffRequestV1 } from '../../common/editor/photo-library-image-handoff-port-v1.ts';
import type { PhotoLibraryCollectionHandoffPortV1, PhotoLibraryCollectionHandoffRequestV1 } from '../../common/editor/photo-library-collection-handoff-port-v1.ts';
import { SCAPE_MIME_TYPE } from '../../common/editor/scape-project-format.ts';
import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from '../../common/editor/scape-blob-budget.ts';
import { id, integer } from '../catalog/value-validation.ts';
import type { PhotoFramescaperHandoffDownloadRequestCurrentV1 } from './photo-framescaper-handoff-download-current-v1.ts';
import { readPhotoFramescaperHandoffDownloadRequestForProfileV1 } from './photo-framescaper-handoff-download-request-kernel-v1.ts';
import type { PhotoFramescaperCollectionHandoffDownloadRequestCurrentV1 } from './photo-framescaper-collection-handoff-download-current-v1.ts';
import { readPhotoFramescaperCollectionDownloadRequestForProfileV1 } from './internal/photo-framescaper-collection-handoff-download-request-kernel-v1.ts';

export interface PhotoFramescaperHandoffTarget {
	readonly binding: Readonly<PhotoLibraryImageHandoffRequestV1>;
	readonly capture: Readonly<PhotoLibraryImageHandoffPortV1>;
	readonly checkCurrent: (signal: AbortSignal) => Promise<void>;
}
export type PreparePhotoFramescaperHandoff = (photoId: string, signal: AbortSignal) => Promise<Readonly<PhotoFramescaperHandoffTarget>>;
export interface PhotoFramescaperHandoffArchive { readonly blob: Blob; readonly fileName: string; readonly projectId: string; }
export type BuildPhotoFramescaperHandoffArchive = (request: Readonly<{ capture: Readonly<PhotoLibraryImageHandoffPortV1>;
	binding: Readonly<PhotoLibraryImageHandoffRequestV1>; signal: AbortSignal }>) => Promise<Readonly<PhotoFramescaperHandoffArchive>>;
export interface PhotoFramescaperHandoffDownloadRequest {
	readonly target: Readonly<PhotoFramescaperHandoffTarget>; readonly fileName: string; readonly fileTypeDescription: string;
	readonly signal?: AbortSignal; readonly buildArchive: BuildPhotoFramescaperHandoffArchive;
	readonly prepareSave: (request: BrowserFileSaveRequest) => PreparedBrowserSave | PromiseLike<PreparedBrowserSave>;
	readonly saveFile: (request: BrowserFileSaveRequest) => BrowserSavedFile | PromiseLike<BrowserSavedFile>;
}
export interface PhotoFramescaperCollectionHandoffTarget {
	readonly binding: Readonly<PhotoLibraryCollectionHandoffRequestV1>; readonly capture: Readonly<PhotoLibraryCollectionHandoffPortV1>;
	readonly checkCurrent: (signal: AbortSignal) => Promise<void>;
}
export interface PhotoFramescaperCollectionHandoffArchive extends PhotoFramescaperHandoffArchive { readonly sequenceId: string; readonly photoCount: number; }
export type BuildPhotoFramescaperCollectionHandoffArchive = (request: Readonly<{ capture: Readonly<PhotoLibraryCollectionHandoffPortV1>;
	binding: Readonly<PhotoLibraryCollectionHandoffRequestV1>; signal: AbortSignal }>) => Promise<Readonly<PhotoFramescaperCollectionHandoffArchive>>;
export interface PhotoFramescaperCollectionHandoffDownloadRequest extends Omit<PhotoFramescaperHandoffDownloadRequest, 'target' | 'buildArchive'> {
	readonly target: Readonly<PhotoFramescaperCollectionHandoffTarget>; readonly buildArchive: BuildPhotoFramescaperCollectionHandoffArchive;
}
type DownloadReceipt<Identity> = Readonly<{ status: 'cancelled' }> | Readonly<{ status: 'saved' | 'download-started'; fileName: string; byteLength: number } & Identity>;
export type PhotoFramescaperHandoffDownloadReceipt = DownloadReceipt<{ projectId: string }>;
export type PhotoFramescaperCollectionHandoffDownloadReceipt = DownloadReceipt<{ projectId: string; sequenceId: string; photoCount: number }>;
interface DeliveryRequest extends Pick<PhotoFramescaperHandoffDownloadRequest, 'fileName' | 'fileTypeDescription' | 'signal' | 'prepareSave' | 'saveFile'> {
	readonly checkCurrent: (signal: AbortSignal) => Promise<void>;
}
interface DeliveryArchive<Identity> { readonly blob: Blob; readonly byteLength: number; readonly identity: Identity; }
interface Active { readonly stop: AbortController; readonly joined: Promise<void>; committing: boolean; }
const blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const check = AbortSignal.prototype.throwIfAborted, reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;

/** Owns preparation and delivery, while the archive and file service retain their existing authority. */
export class PhotoFramescaperHandoffDownload {
	#active: Active | null = null;
	start(value: PhotoFramescaperHandoffDownloadRequest): Promise<PhotoFramescaperHandoffDownloadReceipt> {
		if (this.#active) return Promise.reject(new Error('An editable photo copy is already pending.'));
		let request: PhotoFramescaperHandoffDownloadRequest;
		try { request = admit(value); } catch (error) { return Promise.reject(error); }
		return this.#start({ ...request, checkCurrent: request.target.checkCurrent }, async signal =>
			readArchive(await request.buildArchive({ capture: request.target.capture, binding: request.target.binding, signal })));
	}
	startCurrent(value: PhotoFramescaperHandoffDownloadRequestCurrentV1): Promise<PhotoFramescaperHandoffDownloadReceipt> {
		if (this.#active) return Promise.reject(new Error('An editable photo copy is already pending.'));
		let request: PhotoFramescaperHandoffDownloadRequestCurrentV1;
		try { request = readPhotoFramescaperHandoffDownloadRequestForProfileV1('current2', value); } catch (error) { return Promise.reject(error); }
		return this.#start({ ...request, checkCurrent: request.target.checkCurrent }, async signal =>
			readArchive(await request.buildArchive({ capture: request.target.capture, binding: request.target.binding, signal })));
	}
	startCollection(value: PhotoFramescaperCollectionHandoffDownloadRequest): Promise<PhotoFramescaperCollectionHandoffDownloadReceipt> {
		if (this.#active) return Promise.reject(new Error('An editable photo copy is already pending.'));
		let request: PhotoFramescaperCollectionHandoffDownloadRequest;
		try { request = admitCollection(value); } catch (error) { return Promise.reject(error); }
		return this.#start({ ...request, checkCurrent: request.target.checkCurrent }, async signal =>
			readCollectionArchive(await request.buildArchive({ capture: request.target.capture, binding: request.target.binding, signal })));
	}
	startCollectionCurrent(value: PhotoFramescaperCollectionHandoffDownloadRequestCurrentV1): Promise<PhotoFramescaperCollectionHandoffDownloadReceipt> {
		if (this.#active) return Promise.reject(new Error('An editable photo copy is already pending.'));
		let request: PhotoFramescaperCollectionHandoffDownloadRequestCurrentV1;
		try { request = readPhotoFramescaperCollectionDownloadRequestForProfileV1('current2', value); } catch (error) { return Promise.reject(error); }
		return this.#start({ ...request, checkCurrent: request.target.checkCurrent }, async signal =>
			readCollectionArchive(await request.buildArchive({ capture: request.target.capture, binding: request.target.binding, signal })));
	}

	#start<Identity>(request: DeliveryRequest, buildArchive: (signal: AbortSignal) => Promise<DeliveryArchive<Identity>>): Promise<DownloadReceipt<Identity>> {
		if (this.#active) return Promise.reject(new Error('An editable photo copy is already pending.'));
		let settle!: () => void;
		const active: Active = { stop: new AbortController(), committing: false, joined: new Promise<void>(resolve => { settle = resolve; }) };
		this.#active = active;
		const cancel = () => { if (!active.committing && request.signal) active.stop.abort(Reflect.apply(reason, request.signal, [])); };
		if (request.signal) Reflect.apply(add, request.signal, ['abort', cancel, { once: true }]);
		let prepared: PreparedBrowserSave | PromiseLike<PreparedBrowserSave>;
		try {
			// The picker begins before any await, in the original Download gesture.
			prepared = request.prepareSave({ purpose: 'project-copy', suggestedName: copyName(request.fileName), mimeType: SCAPE_MIME_TYPE,
				types: [{ description: request.fileTypeDescription, accept: { [SCAPE_MIME_TYPE]: ['.fscape'] } }], useFileSystemAccess: true, signal: active.stop.signal });
		} catch (error) { prepared = Promise.reject(error); }
		return this.#run(request, active, prepared, buildArchive).finally(() => {
			if (request.signal) Reflect.apply(remove, request.signal, ['abort', cancel]);
			if (this.#active === active) this.#active = null;
			settle();
		});
	}
	cancelAndJoin(value?: unknown): Promise<void> {
		const active = this.#active;
		if (!active) return Promise.resolve();
		if (!active.committing) active.stop.abort(value);
		return active.joined;
	}
	async #run<Identity>(request: DeliveryRequest, active: Active, pending: PreparedBrowserSave | PromiseLike<PreparedBrowserSave>,
		buildArchive: (signal: AbortSignal) => Promise<DeliveryArchive<Identity>>): Promise<DownloadReceipt<Identity>> {
		let cleanup: ((primary: unknown) => Promise<void>) | null = null;
		try {
			// Direct acquired ports are captured in the original gesture, before caller substitution.
			const direct = pending !== null && typeof pending === 'object' && Object.hasOwn(pending, 'mode');
			const raw: unknown = direct ? pending : await pending;
			// Retain only a safe own cleanup before admitting the other acquired stream methods.
			if (raw !== null && typeof raw === 'object') {
				const mode = Object.getOwnPropertyDescriptor(raw, 'mode'), abort = Object.getOwnPropertyDescriptor(raw, 'abort');
				if (mode && 'value' in mode && mode.value === 'stream' && abort && 'value' in abort && typeof abort.value === 'function') {
					const method: unknown = abort.value; cleanup = async primary => { await Reflect.apply(method as (...args: unknown[]) => unknown, raw, [primary]); };
				}
			}
			const prepared = readPrepared(raw);
			if (direct) await Promise.resolve(); // Keep the existing asynchronous continuation after capturing the acquired ports.
			checked(active.stop.signal);
			if (prepared.mode === 'cancelled') return Object.freeze({ status: 'cancelled' as const });
			await request.checkCurrent(active.stop.signal); checked(active.stop.signal);
			const archive = await buildArchive(active.stop.signal);
			checked(active.stop.signal);
			let acknowledgment: unknown;
			if (prepared.mode === 'stream') {
				const writable = await prepared.createWritable(archive.byteLength, 'exact'); checked(active.stop.signal);
				await archive.blob.stream().pipeTo(writable, { signal: active.stop.signal }); checked(active.stop.signal);
				await request.checkCurrent(active.stop.signal); checked(active.stop.signal);
				active.committing = true; acknowledgment = await prepared.commit(); cleanup = null;
			} else {
				await request.checkCurrent(active.stop.signal); checked(active.stop.signal);
				active.committing = true;
				acknowledgment = await request.saveFile({ purpose: 'project-copy', suggestedName: prepared.fileName, target: prepared.target,
					mimeType: SCAPE_MIME_TYPE, blob: archive.blob, useFileSystemAccess: false, signal: active.stop.signal });
			}
			const saved = readSaved(acknowledgment, archive.byteLength, prepared.mode === 'stream');
			return Object.freeze({ status: saved.method === 'download' ? 'download-started' as const : 'saved' as const,
				fileName: saved.fileName, byteLength: archive.byteLength, ...archive.identity });
		} catch (primary) {
			if (cleanup) {
				const failures: unknown[] = [];
				try { await cleanup(primary); } catch (error) { failures.push(error); }
				if (failures.length) throw new AggregateError([primary, ...failures], 'Editable photo copy and destination cleanup failed.', { cause: primary });
			}
			throw primary;
		}
	}
}
function checked(signal: AbortSignal) { Reflect.apply(check, signal, []); }
function text(value: unknown): string { if (typeof value !== 'string' || value.length < 1 || value.length > 512) throw new TypeError('Editable photo copy requires bounded text.'); return value; }
function pin<T>(value: unknown, receiver: unknown): T { if (typeof value !== 'function') throw new TypeError('Editable photo copy capability is unavailable.'); return ((...args: unknown[]) => Reflect.apply(value, receiver, args) as unknown) as T; }
function copyName(name: string): string { return `${sanitizeSuggestedSaveName(name.replace(/\.[^.]*$/u, ''))}.fscape`; }
function admit(value: unknown): PhotoFramescaperHandoffDownloadRequest {
	return readPhotoFramescaperHandoffDownloadRequestForProfileV1('legacy1', value);
}
function admitCollection(value: unknown): PhotoFramescaperCollectionHandoffDownloadRequest {
	return readPhotoFramescaperCollectionDownloadRequestForProfileV1('legacy1', value);
}
function readPrepared(value: unknown): PreparedBrowserSave {
	const name = 'Editable photo copy destination', source = record(value, name, ['mode', 'cancelled', 'fileName', 'target', 'createWritable', 'patchFinalPrefix', 'bytesWritten', 'commit', 'abort', 'savedFile'], ['mode']);
	const mode = field(source, 'mode', name);
	if (mode === 'stream') {
		record(value, name, ['mode', 'createWritable', 'patchFinalPrefix', 'bytesWritten', 'commit', 'abort', 'savedFile']);
		const method = <Key extends Exclude<keyof PreparedDirectSave, 'mode'>>(key: Key): PreparedDirectSave[Key] => pin(field(source, key, name), value);
		return Object.freeze({ mode, createWritable: method('createWritable'), patchFinalPrefix: method('patchFinalPrefix'), bytesWritten: method('bytesWritten'), commit: method('commit'), abort: method('abort'), savedFile: method('savedFile') });
	}
	if (mode === 'cancelled') {
		record(value, name, ['mode', 'cancelled', 'fileName']);
		if (field(source, 'cancelled', name) !== true) throw new TypeError('Editable photo copy dismissal requires its acknowledgment.');
		return Object.freeze({ mode, cancelled: true, fileName: text(field(source, 'fileName', name)) });
	}
	if (mode !== 'blob') throw new TypeError('Editable photo copy has an unsupported destination.');
	record(value, name, ['mode', 'target', 'fileName']);
	const target = field(source, 'target', name); if (target === null || typeof target !== 'object') throw new TypeError('Editable photo copy requires its selected destination.');
	return Object.freeze({ mode, fileName: text(field(source, 'fileName', name)), target: target as Extract<PreparedBrowserSave, { mode: 'blob' }>['target'] });
}
function readArchive(value: unknown) {
	const name = 'Editable photo copy archive', source = record(value, name, ['blob', 'fileName', 'projectId']);
	return { ...readArchiveBody(source, name, SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES), identity: { projectId: text(field(source, 'projectId', name)) } };
}
function readCollectionArchive(value: unknown) {
	const name = 'Editable collection copy archive', source = record(value, name, ['blob', 'fileName', 'projectId', 'sequenceId', 'photoCount']);
	return { ...readArchiveBody(source, name, 256 * 1024 * 1024), identity: { projectId: id(field(source, 'projectId', name), 'collection project ID'),
		sequenceId: id(field(source, 'sequenceId', name), 'collection sequence ID'), photoCount: integer(field(source, 'photoCount', name), 1, 4_094, 'collection photo count') } };
}
function readArchiveBody(source: Readonly<Record<string, unknown>>, name: string, maximum: number) {
	const blob = field(source, 'blob', name), byteLength: unknown = Reflect.apply(blobSize, blob, []);
	if (typeof byteLength !== 'number' || byteLength < 1 || byteLength > maximum) throw new RangeError('Editable photo copy exceeds the admitted Blob budget.');
	if (!text(field(source, 'fileName', name)).endsWith('.fscape')) throw new TypeError('Editable photo copy requires its Framescaper filename.');
	return { blob: blob as Blob, byteLength };
}
function readSaved(value: unknown, size: number, stream: boolean) {
	const name = 'Editable photo copy acknowledgment', source = record(value, name, ['method', 'fileName', 'size', 'blob'], ['method', 'fileName', 'size']);
	const method = field(source, 'method', name);
	if (field(source, 'size', name) !== size || (stream ? method !== 'desktop' && method !== 'file-system-access' : method !== 'download')) throw new TypeError('Editable photo copy did not acknowledge its exact bytes.');
	return { method, fileName: text(field(source, 'fileName', name)) };
}
