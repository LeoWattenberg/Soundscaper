/* SPDX-License-Identifier: AGPL-3.0-only */
import type { BrowserFileSaveRequest, BrowserSavedFile } from '../../common/editor/browser-file-save-service.ts';
import type { ExecutePhotoDevelopV2 } from '../../common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import type { ReadPhotoExportSidecar } from '../../common/editor/photo-library-session-port-v2.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { canonicalJsonSha256 } from '../../common/canonical-json-sha256.ts';
import { parsePhotoExportSidecarV1 } from '../catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoRasterExportDownloadAckV1, normalizePhotoRasterExportBindingV1, type PhotoRasterExportJournalMemberV1 } from '../storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterExportSidecar, type PhotoRasterSidecarReceipt } from './photo-raster-export-sidecar.ts';
import { detachPhotoLibraryDevelopSettingsV2, capturePhotoDevelopExecutionContextV2, capturePhotoLibraryDevelopPortV2 } from '../../common/editor/controller/shared/photo-library-develop-command-v2.ts';

interface Runtime { readonly execute: ExecutePhotoDevelopV2; readonly read: ReadPhotoExportSidecar;
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
export class PhotoRasterBatchSidecarRecovery {
	readonly #runtime: Runtime;
	readonly #stop = new AbortController();
	#work: Promise<Readonly<PhotoRasterBatchSidecarRecoveryReceipt>> | null = null;
	constructor(value: Runtime) {
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
			if (canonicalJsonSha256(parsePhotoExportSidecarV1(text)) !== digest) throw new Error('Photo companion saved facts changed.'); return text;
		};
		const sidecar = new PhotoRasterExportSidecar({ read }, runtime.save);
		let result: PhotoRasterSidecarReceipt | null = null;
		try {
			await runtime.execute(async context => {
				const signal = AbortSignal.any([external, context.signal]);
				try {
				const scope = capturePhotoDevelopExecutionContextV2(context, signal);
				const current = () => { signal.throwIfAborted(); if (!scope.isCurrent()) throw new Error('Photo companion selected generation changed.'); };
				current(); const port = capturePhotoLibraryDevelopPortV2(await scope.acquire()); current();
				if (port.schemaVersion !== 2) throw new TypeError('Photo companion requires current saved Develop.');
				const snapshot = await port.read({ schemaVersion: 2, photoId: binding.photoId }, { signal }); current();
				const own = (key: string): unknown => { const data = Object.getOwnPropertyDescriptor(snapshot, key); if (!data || !Object.hasOwn(data, 'value')) throw new TypeError('Photo companion snapshot requires own data.'); return data.value; };
				if (own('schemaVersion') !== 2 || own('catalogId') !== binding.catalogId || own('photoId') !== binding.photoId
					|| own('revision') !== binding.expectedRevision || own('versionId') !== binding.versionId || own('activeVersionId') !== binding.versionId) throw new Error('Photo companion saved version changed.');
				await sidecar.capture(binding, detachPhotoLibraryDevelopSettingsV2(own('develop')), signal); current();
				await sidecar.verify(signal); current(); result = await sidecar.deliver(ack.fileName, signal);
				} catch (cause) { result = sidecar.failure(ack.fileName, signal, cause); }
			}, external);
		} catch (cause) { result ??= sidecar.failure(ack.fileName, external, cause); }
		result ??= sidecar.failure(ack.fileName, external, new Error('Photo companion did not enter its selected generation.'));
		return Object.freeze({ status: 'download-started', method: 'download', recoveredImage: true, photoId: binding.photoId, versionId: binding.versionId,
			revision: binding.expectedRevision, fileName: ack.fileName, byteLength: ack.size, sidecar: result });
	}
}
