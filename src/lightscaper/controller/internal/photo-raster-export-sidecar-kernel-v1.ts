/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrowserFileSaveRequest, BrowserSavedFile } from '../../../common/editor/browser-file-save-service.ts';
import type { PhotoLibraryExportSidecarRequest, ReadPhotoExportSidecar } from '../../../common/editor/photo-library-session-port-v2.ts';
import type { ImageDevelopStateThroughV4 } from '../../../common/editor/imaging/image-develop-state-v4.ts';
import type { PhotoRasterExportProfileV1 } from '../photo-raster-export-contract-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { parsePhotoExportSidecarV1, serializePhotoExportSidecarV1, PHOTO_EXPORT_SIDECAR_SUFFIX_V1, PHOTO_EXPORT_SIDECAR_MIME_TYPE_V1 } from '../../catalog/photo-export-sidecar-v1.ts';
import { parsePhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1 } from '../../catalog/photo-export-sidecar-current-v1.ts';
import { canonicalPhotoDocumentJsonV1 } from '../../catalog/photo-document-json-v1.ts';

type SaveSidecar = (request: BrowserFileSaveRequest) => BrowserSavedFile | PromiseLike<BrowserSavedFile>;
export type PhotoRasterSidecarReceipt = Readonly<{ status: 'download-started'; fileName: string; byteLength: number }>
	| Readonly<{ status: 'failed' | 'cancelled'; fileName: string; byteLength: number; cause: unknown }>;
const CHECK = AbortSignal.prototype.throwIfAborted;
const ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Body-free explicit download authority is captured before the native raster picker.
 * The actual acknowledged raster name supplies the JSON name; no deferred picker is opened. */
export class PhotoRasterExportSidecarKernelV1 {
	readonly #profile: PhotoRasterExportProfileV1;
	readonly #read: ReadPhotoExportSidecar;
	readonly #save: SaveSidecar;
	readonly #target = Object.freeze({ browserDownload: true });
	#binding: Readonly<PhotoLibraryExportSidecarRequest> | null = null;
	#text: string | null = null;
	#developText: string | null = null;
	constructor(profile: PhotoRasterExportProfileV1, value: unknown, save: SaveSidecar) {
		if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported photo sidecar profile.');
		this.#profile = profile;
		const input = record(value, 'Photo sidecar export', ['read']), read = field(input, 'read', 'Photo sidecar export');
		if (typeof read !== 'function') throw new TypeError('Photo sidecar export requires its selected reader.');
		this.#read = Reflect.apply(Function.prototype.bind, read, [value]) as ReadPhotoExportSidecar;
		this.#save = save;
	}
	async capture(binding: Readonly<PhotoLibraryExportSidecarRequest>, develop: Readonly<ImageDevelopStateThroughV4>, signal: AbortSignal): Promise<void> {
		// The caller supplies the same detached, normalized recipe consumed by its renderer.
		this.#binding = Object.freeze({ ...binding }); this.#developText = canonicalPhotoDocumentJsonV1(develop);
		this.#text = await this.#readText(signal);
	}
	async verify(signal: AbortSignal): Promise<void> {
		if (this.#text === null || await this.#readText(signal) !== this.#text) throw new Error('Photo sidecar complete saved facts changed.');
	}
	async #readText(signal: AbortSignal): Promise<string> {
		Reflect.apply(CHECK, signal, []); const binding = this.#binding;
		if (!binding) throw new Error('Photo sidecar has no captured saved version.');
		const text = await this.#read(binding, { signal }); Reflect.apply(CHECK, signal, []);
		const sidecar = this.#profile === 'current3' ? parsePhotoExportSidecarCurrentV1(text) : parsePhotoExportSidecarV1(text);
		if (sidecar.binding.activeVersionId !== binding.versionId) throw new Error('Photo sidecar active saved version changed.');
		if (canonicalPhotoDocumentJsonV1(sidecar.version.develop) !== this.#developText) throw new Error('Photo sidecar saved recipe differs from its rendered Develop state.');
		if (sidecar.binding.catalogId !== binding.catalogId || sidecar.binding.photoId !== binding.photoId
			|| sidecar.binding.revision !== binding.expectedRevision || sidecar.version.id !== binding.versionId
			|| (this.#profile === 'current3' ? serializePhotoExportSidecarCurrentV1(sidecar) : serializePhotoExportSidecarV1(sidecar)) !== text) throw new Error('Photo sidecar complete source identity, revision or canonical facts changed.');
		return text;
	}
	failure(fileName: string, signal: AbortSignal, cause: unknown): PhotoRasterSidecarReceipt {
		const cancelled = Reflect.apply(ABORTED, signal, []) === true;
		return Object.freeze({ status: cancelled ? 'cancelled' : 'failed', fileName: name(fileName), byteLength: this.#text === null ? 0 : new TextEncoder().encode(this.#text).byteLength,
			cause: cancelled ? Reflect.apply(REASON, signal, []) : cause });
	}
	async deliver(rasterFileName: string, signal: AbortSignal): Promise<PhotoRasterSidecarReceipt> {
		try {
			Reflect.apply(CHECK, signal, []); if (this.#text === null) throw new Error('Photo sidecar has no captured saved version.');
			const fileName = name(rasterFileName);
			if (fileName.length > 512) throw new RangeError('Photo sidecar filename exceeds its bound.');
			const blob = new Blob([this.#text], { type: PHOTO_EXPORT_SIDECAR_MIME_TYPE_V1 });
			const value = await this.#save({ purpose: 'media', suggestedName: fileName, mimeType: PHOTO_EXPORT_SIDECAR_MIME_TYPE_V1,
				target: Object.freeze({ ...this.#target, name: fileName }), blob, useFileSystemAccess: false, signal });
			const saved = record(value, 'Photo sidecar saved result', ['fileName', 'method', 'size', 'written'], ['fileName', 'method', 'size']);
			if (field(saved, 'fileName', 'Photo sidecar saved result') !== fileName || field(saved, 'method', 'Photo sidecar saved result') !== 'download'
				|| field(saved, 'size', 'Photo sidecar saved result') !== blob.size) throw new Error('Photo sidecar download acknowledgment changed.');
			// A real irreversible ACK survives a late caller cancellation.
			return Object.freeze({ status: 'download-started', fileName, byteLength: blob.size });
		} catch (cause) { return this.failure(rasterFileName, signal, cause); }
	}
}
function name(raster: string): string {
	return raster + PHOTO_EXPORT_SIDECAR_SUFFIX_V1;
}
