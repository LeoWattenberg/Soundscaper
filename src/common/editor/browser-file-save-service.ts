/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFileSystemPreparedSave, type PreparedDirectSave } from './file-save-stream.ts';
import { releaseDownloadObjectUrl } from './object-url-revoke.ts';

type FileSystemSaveTarget = Parameters<typeof createFileSystemPreparedSave>[0]['target'];
type FileSystemSaveWriter = Awaited<ReturnType<FileSystemSaveTarget['createWritable']>>;
type BrowserSaveWriter = Omit<FileSystemSaveWriter, 'write'> & {
	write(value: Blob | Parameters<FileSystemSaveWriter['write']>[0]): ReturnType<FileSystemSaveWriter['write']>;
};
export interface BrowserSaveTarget {
	readonly name?: string;
	readonly originalOverwrite?: boolean;
	readonly browserDownload?: boolean;
	readonly createWritable?: () => PromiseLike<BrowserSaveWriter>;
}
export interface BrowserSavePickerType {
	readonly description?: string;
	readonly accept: Readonly<Record<string, readonly string[]>>;
}
export interface BrowserFileSaveRequest {
	readonly purpose?: string;
	readonly suggestedName?: unknown;
	readonly fileName?: unknown;
	readonly mimeType?: string;
	readonly types?: readonly BrowserSavePickerType[];
	readonly useFileSystemAccess?: boolean;
	readonly signal?: AbortSignal;
	readonly target?: BrowserSaveTarget | null;
	readonly blob?: Blob;
	readonly bytes?: BlobPart;
	readonly text?: string;
}
export type PreparedBrowserSave = PreparedDirectSave
	| Readonly<{ mode: 'cancelled'; cancelled: true; fileName: string }>
	| Readonly<{ mode: 'blob'; target: BrowserSaveTarget; fileName: string }>;
export type BrowserSavedFile = Readonly<{ cancelled: true; fileName: string; size: number }>
	| Readonly<{ method: 'download' | 'blob' | 'file-system-access'; fileName: string; size: number; blob?: Blob }>;
interface DownloadAnchor {
	href: string;
	download: string;
	hidden: boolean;
	click(): void;
	remove?(): void;
}
interface DownloadDocument {
	createElement(tag: 'a'): DownloadAnchor;
	readonly body?: { append(anchor: DownloadAnchor | Node | string): unknown } | null;
}
interface SaveUrlApi {
	createObjectURL(blob: Blob): string;
	revokeObjectURL?(url: string): void;
}
interface BrowserSaveScope {
	readonly document?: DownloadDocument;
	readonly URL?: SaveUrlApi;
	readonly setTimeout?: (callback: () => void, delay: number) => unknown;
	readonly showSaveFilePicker?: (request: Readonly<{ suggestedName: string;
		types?: readonly BrowserSavePickerType[]; excludeAcceptAllOption: false }>) => PromiseLike<BrowserSaveTarget>;
}
export interface BrowserFileSaveServiceOptions {
	readonly scope?: BrowserSaveScope;
	readonly document?: DownloadDocument | null;
	readonly urlApi?: SaveUrlApi;
	readonly setTimeout?: (callback: () => void, delay: number) => unknown;
}

/** Shared browser delivery without audio/video read, codec or desktop composition. */
export function createBrowserFileSaveService(options: BrowserFileSaveServiceOptions = {}) {
	// Native document creates a native anchor; injected hosts may use a smaller
	// anchor/document pair without implementing the entire DOM surface.
	const scope: BrowserSaveScope = options.scope ?? globalThis;
	const document = options.document === undefined ? scope.document : options.document;
	const urlApi = options.urlApi ?? scope.URL;
	const setTimer = options.setTimeout ?? scope.setTimeout?.bind(scope);

	async function chooseSaveTarget(request: BrowserFileSaveRequest = {}): Promise<BrowserSaveTarget> {
		assertSavePurpose(request.purpose);
		const suggestedName = sanitizeSuggestedSaveName(request.suggestedName || request.fileName);
		if (request.useFileSystemAccess && typeof scope.showSaveFilePicker === 'function') {
			return scope.showSaveFilePicker({ suggestedName,
				...(Array.isArray(request.types) ? { types: request.types } : {}), excludeAcceptAllOption: false });
		}
		return Object.freeze({ browserDownload: true, name: suggestedName });
	}
	async function prepareSave(request: BrowserFileSaveRequest = {}): Promise<PreparedBrowserSave> {
		throwIfAborted(request.signal);
		const fileName = sanitizeSuggestedSaveName(request.target?.originalOverwrite ? request.target.name : request.suggestedName || request.fileName);
		let target = request.target;
		if (target === undefined) {
			try { target = await chooseSaveTarget({ ...request, suggestedName: fileName }); throwIfAborted(request.signal); }
			catch (error) {
				throwIfAborted(request.signal);
				if (isPickerDismissal(error)) return Object.freeze({ mode: 'cancelled', cancelled: true, fileName });
				throw error;
			}
		}
		if (!target) return Object.freeze({ mode: 'cancelled', cancelled: true, fileName });
		return isWritableTarget(target) ? createFileSystemPreparedSave({ target, fileName, signal: request.signal })
			: Object.freeze({ mode: 'blob', target, fileName });
	}
	async function writeFile(target: BrowserSaveTarget | null | undefined, input: BlobPart, request: BrowserFileSaveRequest = {}): Promise<BrowserSavedFile> {
		throwIfAborted(request.signal);
		const blob = toBlob(input, request.mimeType);
		const fileName = sanitizeSuggestedSaveName(target?.originalOverwrite ? target.name : request.suggestedName || request.fileName || target?.name);
		if (!target) return { cancelled: true, fileName, size: blob.size };
		if (isWritableTarget(target)) {
			const writable = await target.createWritable();
			try { throwIfAborted(request.signal); await writable.write(blob); throwIfAborted(request.signal); await writable.close(); }
			catch (error) { await Promise.resolve(writable.abort?.()).catch(() => undefined); throw error; }
			return { method: 'file-system-access', fileName, size: blob.size };
		}
		if (!document?.createElement || !urlApi?.createObjectURL) return { method: 'blob', blob, fileName, size: blob.size };
		const url = urlApi.createObjectURL(blob);
		try {
			const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.hidden = true;
			document.body?.append(anchor); throwIfAborted(request.signal); anchor.click(); anchor.remove?.();
		} finally { releaseDownloadObjectUrl(url, { revoke: urlApi.revokeObjectURL ? value => urlApi.revokeObjectURL!(value) : null, setTimer }); }
		return { method: 'download', fileName, size: blob.size };
	}
	async function saveFile(request: BrowserFileSaveRequest = {}): Promise<BrowserSavedFile> {
		throwIfAborted(request.signal);
		const blob = toBlob(request.blob ?? request.bytes ?? request.text ?? '', request.mimeType);
		let target = request.target;
		if (target === undefined) {
			try { target = await chooseSaveTarget(request); throwIfAborted(request.signal); }
			catch (error) {
				throwIfAborted(request.signal);
				if (isPickerDismissal(error)) return { cancelled: true, fileName: String(request.suggestedName ?? ''), size: blob.size };
				throw error;
			}
		}
		return writeFile(target, blob, request);
	}
	async function createDownload(request: BrowserFileSaveRequest = {}) {
		const blob = toBlob(request.blob ?? request.bytes ?? request.text ?? '', request.mimeType);
		const fileName = sanitizeSuggestedSaveName(request.suggestedName || request.fileName);
		if (!urlApi?.createObjectURL) return { method: 'blob' as const, blob, fileName, size: blob.size, url: null, cleanup: async () => {} };
		const url = urlApi.createObjectURL(blob); let revoked = false;
		return { method: 'object-url' as const, blob, fileName, size: blob.size, url, cleanup: async () => {
			if (revoked) return; revoked = true; urlApi.revokeObjectURL?.(url);
		} };
	}
	return Object.freeze({ chooseSaveTarget, prepareSave, writeFile, saveFile, createDownload });
}

export function sanitizeSuggestedSaveName(value: unknown): string {
	// eslint-disable-next-line no-control-regex -- Save names replace C0 filesystem control bytes.
	return String(value || 'soundscaper-export').trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/[. ]+$/g, '') || 'soundscaper-export';
}
function assertSavePurpose(value: unknown): void {
	const purpose = String(value || '').trim().toLowerCase();
	if (!['project', 'project-copy', 'aup3', 'aup4', 'audio-pcm-mix', 'audio', 'video', 'media', 'labels', 'preset', 'macro', 'report', 'attribution-csv', 'interchange'].includes(purpose)) {
		throw new RangeError(`Unsupported file purpose: ${purpose || 'empty'}.`);
	}
}
function isWritableTarget(target: BrowserSaveTarget): target is BrowserSaveTarget & FileSystemSaveTarget { return typeof target.createWritable === 'function'; }
function isPickerDismissal(error: unknown): boolean { return error !== null && typeof error === 'object' && 'name' in error && error.name === 'AbortError'; }
function toBlob(input: BlobPart, mimeType?: string): Blob { return input instanceof Blob ? input : new Blob([input], { type: mimeType || 'application/octet-stream' }); }
function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The file operation was cancelled.', 'AbortError');
}
