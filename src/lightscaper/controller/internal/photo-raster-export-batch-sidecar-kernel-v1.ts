/* SPDX-License-Identifier: AGPL-3.0-only */
import type { BrowserFileSaveRequest, BrowserSavedFile } from '../../../common/editor/browser-file-save-service.ts';
import type { ExecutePhotoDevelopV2 } from '../../../common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import type { ReadPhotoExportSidecar } from '../../../common/editor/photo-library-session-port-v2.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import { canonicalJsonSha256 } from '../../../common/canonical-json-sha256.ts';
import { parsePhotoExportSidecarV1 } from '../../catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoRasterExportDownloadAckV1, normalizePhotoRasterExportBindingV1, type PhotoRasterExportJournalMemberV1 } from '../../storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterExportSidecarKernelV1, type PhotoRasterSidecarReceipt } from './photo-raster-export-sidecar-kernel-v1.ts';
import type { PhotoRasterExportProfileV1 } from '../photo-raster-export-contract-v1.ts';
import { parsePhotoExportSidecarCurrentV1 } from '../../catalog/photo-export-sidecar-current-v1.ts';
import type { ExecutePhotoDevelopCurrentV1, PhotoDevelopExecutionContextCurrentV1 } from '../../../common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { PhotoDevelopExecutionContextV2 } from '../../../common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import { detachPhotoLibraryDevelopSettingsCurrentV1, capturePhotoDevelopExecutionContextCurrentV1, capturePhotoLibraryDevelopPortCurrentV1 } from '../../../common/editor/controller/shared/photo-library-develop-command-current-v1.ts';
import { detachPhotoLibraryDevelopSettingsV2, capturePhotoDevelopExecutionContextV2, capturePhotoLibraryDevelopPortV2 } from '../../../common/editor/controller/shared/photo-library-develop-command-v2.ts';

interface Runtime { readonly execute: ExecutePhotoDevelopV2 | ExecutePhotoDevelopCurrentV1; readonly read: ReadPhotoExportSidecar;
	readonly save: (request: BrowserFileSaveRequest) => BrowserSavedFile | PromiseLike<BrowserSavedFile>; }
/** A retained image ACK has no persisted dimensions. Recovery reports its
 * actual scalar delivery and the separately acknowledged companion only. */
export interface PhotoRasterBatchSidecarRecoveryReceipt {
	readonly status: 'download-started'; readonly method: 'download'; readonly recoveredImage: true;
	readonly photoId: string; readonly versionId: string; readonly revision: number;
	readonly fileName: string; readonly byteLength: number; readonly sidecar: PhotoRasterSidecarReceipt;
}
/** Explicit JSON-only retry in the current selected generation. No image
 * borrow, render, encode or picker is acquired. Destinations retain resource
 * verification and durable intent immediately before actual JSON delivery. */
export class PhotoRasterBatchSidecarRecoveryKernelV1 {
	readonly #profile: PhotoRasterExportProfileV1;
	readonly #runtime: Runtime;
	readonly #stop = new AbortController();
	#work: Promise<Readonly<PhotoRasterBatchSidecarRecoveryReceipt>> | null = null;
	constructor(profile: PhotoRasterExportProfileV1, value: Runtime) {
		if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported photo companion profile.');
		this.#profile = profile;
		const input = record(value, 'Photo batch companion runtime', ['execute', 'read', 'save']);
		const pin = <Method>(key: string): Method => {
			const fn = field(input, key, 'companion'); if (typeof fn !== 'function') throw new TypeError('Photo companion requires own capabilities.');
			return ((...args: unknown[]) => Reflect.apply(fn, value, args) as unknown) as Method;
		};
		this.#runtime = Object.freeze({ execute: pin<Runtime['execute']>('execute'), read: pin<Runtime['read']>('read'), save: pin<Runtime['save']>('save') });
	}
	start(catalogId: string, member: Readonly<PhotoRasterExportJournalMemberV1>, external: AbortSignal): Promise<Readonly<PhotoRasterBatchSidecarRecoveryReceipt>> {
		if (this.#work) throw new Error('Photo companion recovery already started.');
		Reflect.apply(AbortSignal.prototype.throwIfAborted, external, []);
		if (Object.getPrototypeOf(external) !== AbortSignal.prototype || ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(external, key))) throw new TypeError('Photo companion requires unmodified native cancellation.');
		const input = record(member, 'Photo companion member', ['jobId', 'index', 'photoId', 'versionId', 'expectedRevision', 'sourceFileName', 'fileName', 'binding', 'state', 'delivery', 'sidecar']);
		const fileName = field(input, 'fileName', 'companion'); if (typeof fileName !== 'string') throw new TypeError('Photo companion requires its image name.');
		const ack = normalizePhotoRasterExportDownloadAckV1(field(input, 'delivery', 'companion'), fileName);
		const facts = normalizePhotoRasterExportBindingV1(field(input, 'binding', 'companion')), extra = record(field(input, 'sidecar', 'companion'), 'Photo companion state', ['state', 'delivery']);
		if (field(input, 'state', 'companion') !== 'committed' || (field(extra, 'state', 'companion') !== 'pending' && field(extra, 'state', 'companion') !== 'started') || field(extra, 'delivery', 'companion') !== null || !facts.sidecarSha256) throw new TypeError('Photo companion recovery requires an unfinished paired image ACK.');
		const identity = (value: unknown): string => { if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) throw new TypeError('Photo companion requires stable identity.'); return value; };
		const revision = field(input, 'expectedRevision', 'companion'); if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || Object.is(revision, -0)) throw new TypeError('Photo companion requires current revision.');
		const binding = Object.freeze({ catalogId: identity(catalogId), photoId: identity(field(input, 'photoId', 'companion')), versionId: identity(field(input, 'versionId', 'companion')), expectedRevision: revision });
		const signal = AbortSignal.any([external, this.#stop.signal]);
		this.#work = this.#run(binding, ack, facts.sidecarSha256, signal); return this.#work;
	}
	async cancelAndJoin(reason: unknown): Promise<void> { this.#stop.abort(reason); await this.#work; }
	async #run(binding: Readonly<{ catalogId: string; photoId: string; versionId: string; expectedRevision: number }>,
		ack: ReturnType<typeof normalizePhotoRasterExportDownloadAckV1>, digest: string, external: AbortSignal): Promise<Readonly<PhotoRasterBatchSidecarRecoveryReceipt>> {
		const runtime = this.#runtime;
		const read: ReadPhotoExportSidecar = async (request, options) => {
			const text = await runtime.read(request, options);
			if (canonicalJsonSha256(this.#profile === 'current3' ? parsePhotoExportSidecarCurrentV1(text) : parsePhotoExportSidecarV1(text)) !== digest) throw new Error('Photo companion saved facts changed.'); return text;
		};
		const sidecar = new PhotoRasterExportSidecarKernelV1(this.#profile, { read }, runtime.save);
		let result: PhotoRasterSidecarReceipt | null = null;
		try {
			await Reflect.apply(runtime.execute, undefined, [async (context: PhotoDevelopExecutionContextV2 | PhotoDevelopExecutionContextCurrentV1) => {
				const signal = AbortSignal.any([external, context.signal]);
				try {
				const scope = this.#profile === 'current3' ? capturePhotoDevelopExecutionContextCurrentV1(context as PhotoDevelopExecutionContextCurrentV1, signal)
					: capturePhotoDevelopExecutionContextV2(context as PhotoDevelopExecutionContextV2, signal);
				const current = () => { signal.throwIfAborted(); if (!scope.isCurrent()) throw new Error('Photo companion selected generation changed.'); };
				current(); const acquired = await scope.acquire(); current();
				const schemaVersion = this.#profile === 'current3' ? 3 : 2;
				const port = this.#profile === 'current3' ? capturePhotoLibraryDevelopPortCurrentV1(acquired as Parameters<typeof capturePhotoLibraryDevelopPortCurrentV1>[0])
					: capturePhotoLibraryDevelopPortV2(acquired as Parameters<typeof capturePhotoLibraryDevelopPortV2>[0]); current();
				if (port.schemaVersion !== schemaVersion) throw new TypeError('Photo companion requires current saved Develop.');
				const snapshot: unknown = await Reflect.apply(port.read, port, [{ schemaVersion, photoId: binding.photoId }, { signal }]); current();
				const own = (key: string): unknown => { const data = Object.getOwnPropertyDescriptor(snapshot, key); if (!data || !Object.hasOwn(data, 'value')) throw new TypeError('Photo companion snapshot requires own data.'); return data.value; };
				if (own('schemaVersion') !== schemaVersion || own('catalogId') !== binding.catalogId || own('photoId') !== binding.photoId
					|| own('revision') !== binding.expectedRevision || own('versionId') !== binding.versionId || own('activeVersionId') !== binding.versionId) throw new Error('Photo companion saved version changed.');
				await sidecar.capture(binding, this.#profile === 'current3' ? detachPhotoLibraryDevelopSettingsCurrentV1(own('develop')) : detachPhotoLibraryDevelopSettingsV2(own('develop')), signal); current();
				await sidecar.verify(signal); current(); result = await sidecar.deliver(ack.fileName, signal);
				} catch (cause) { result = sidecar.failure(ack.fileName, signal, cause); }
			}, external]);
		} catch (cause) { result ??= sidecar.failure(ack.fileName, external, cause); }
		result ??= sidecar.failure(ack.fileName, external, new Error('Photo companion did not enter its selected generation.'));
		return Object.freeze({ status: 'download-started', method: 'download', recoveredImage: true, photoId: binding.photoId, versionId: binding.versionId,
			revision: binding.expectedRevision, fileName: ack.fileName, byteLength: ack.size, sidecar: result });
	}
}
