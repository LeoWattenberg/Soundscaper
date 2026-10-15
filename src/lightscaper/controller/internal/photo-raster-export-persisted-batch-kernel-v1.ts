/* SPDX-License-Identifier: AGPL-3.0-only */
import { canonicalJsonSha256 } from '../../../common/canonical-json-sha256.ts';
import type { PhotoLibraryExportJournalAccess, PhotoLibraryExportSidecarRequest, ReadPhotoExportSidecar } from '../../../common/editor/photo-library-session-port-v2.ts';
import type { ExecutePhotoDevelopV2 } from '../../../common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../../common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { PhotoRasterExportProfileV1 } from '../photo-raster-export-contract-v1.ts';
import { parsePhotoExportSidecarCurrentV1 } from '../../catalog/photo-export-sidecar-current-v1.ts';
import { parsePhotoExportSidecarV1 } from '../../catalog/photo-export-sidecar-v1.ts';
import { createPhotoCubeLutClosureV1 } from '../../catalog/photo-cube-lut-closure-v1.ts';
import { PhotoRasterExportJournalOwnerV1 } from '../../storage/photo-raster-export-journal-owner-v1.ts';
import { PhotoRasterExportJournalOwnerCurrentV1 } from '../../storage/photo-raster-export-journal-owner-current-v1.ts';
import { isPhotoRasterExportMemberCompleteV1, type PhotoRasterExportBindingV1 } from '../../storage/photo-raster-export-journal-v1.ts';
import { createPhotoRasterExportJournalForProfileV1 } from '../../storage/internal/photo-raster-export-journal-kernel-v1.ts';
import { capturePhotoRasterBatchSelection, type PhotoRasterBatchSelection, type PreparedPhotoRasterBatchSelection } from '../photo-raster-export-batch-selection.ts';
import { preparePhotoRasterBatchSelectionForProfileV1 } from './photo-raster-export-batch-selection-kernel-v1.ts';
import type { PhotoRasterExportBatchDestinations } from '../photo-raster-export-batch-queue.ts';
import type { PhotoRasterExportBatchV1 } from '../photo-raster-export-batch-v1.ts';
import { createPhotoRasterBatchDownloadDestinations } from '../photo-raster-export-batch-download-destinations.ts';
import { assertPhotoRasterJournalPlanForProfileV1, createPhotoRasterJournalDestinationsForProfileV1, PhotoRasterJournalDestinationErrorV1 } from './photo-raster-export-journal-destinations-kernel-v1.ts';
import { reconcilePhotoRasterExportBatchRecoveryForProfileV1, type PhotoRasterExportRecoveryEntryV1 } from './photo-raster-export-batch-recovery-kernel-v1.ts';
import { readClosedDomainRecord as record, readClosedDomainField as field, readClosedDomainArray as array } from '../../../common/editor/closed-domain-value.ts';

/** Scalar provenance from a complete admitted saved Photo, not a body lease. */
export async function readPhotoRasterExportBindingForProfileV1(profile: PhotoRasterExportProfileV1, request: Readonly<PhotoLibraryExportSidecarRequest>, read: ReadPhotoExportSidecar, signal: AbortSignal, sidecarEnabled = false): Promise<Readonly<PhotoRasterExportBindingV1>> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported photo journal binding profile.');
	const captured = Object.freeze({ catalogId: request.catalogId, photoId: request.photoId, versionId: request.versionId, expectedRevision: request.expectedRevision });
	signal.throwIfAborted(); const text = await read(captured, { signal }), sidecar = profile === 'current3' ? parsePhotoExportSidecarCurrentV1(text) : parsePhotoExportSidecarV1(text); signal.throwIfAborted();
	// Fingerprints cover normalized complete facts. The optional delivery owner
	// separately requires canonical text; legacy raster-only reads keep admission.
	if (sidecar.binding.catalogId !== captured.catalogId || sidecar.binding.photoId !== captured.photoId || sidecar.binding.revision !== captured.expectedRevision
		|| sidecar.version.id !== captured.versionId || sidecar.binding.activeVersionId !== captured.versionId) throw new Error('Photo export journal saved binding changed.');
	const closure = createPhotoCubeLutClosureV1(), develop = sidecar.version.develop;
	// The complete Current sidecar is admitted above. Only the private LUT ledger
	// sees its computation view; full recipe and sidecar fingerprints retain repairs.
	closure.addDevelop(develop.processVersion === 3 ? { processVersion: 2, effects: develop.effects,
		geometry: develop.geometry, masks: develop.masks, maskBindings: develop.maskBindings } : develop);
	return Object.freeze({ originalSha256: sidecar.original.contentSha256, recipeSha256: canonicalJsonSha256(sidecar.version.develop),
		lutSha256: Object.freeze(closure.finish().map(reference => reference.sha256)), ...(sidecarEnabled ? { sidecarSha256: canonicalJsonSha256(sidecar) } : {}) });
}
export interface PhotoRasterPersistedBatchOptionsV1 {
	readonly selection: readonly Readonly<PhotoRasterBatchSelection>[];
	readonly execute: ExecutePhotoDevelopV2;
	readonly readSidecar: ReadPhotoExportSidecar;
	readonly openJournal: (options: Readonly<{ signal: AbortSignal }>) => Promise<Readonly<PhotoLibraryExportJournalAccess>>;
	readonly signal: AbortSignal;
}
export interface PhotoRasterPersistedBatchOptionsCurrentV1 extends Omit<PhotoRasterPersistedBatchOptionsV1, 'execute'> {
	readonly execute: ExecutePhotoDevelopCurrentV1;
}
interface Options extends Omit<PhotoRasterPersistedBatchOptionsV1, 'execute'> {
	readonly execute: ExecutePhotoDevelopV2 | ExecutePhotoDevelopCurrentV1;
}
type JournalOwner = PhotoRasterExportJournalOwnerV1 | PhotoRasterExportJournalOwnerCurrentV1;
export interface PhotoRasterPersistedBatchPreparedV1 {
	readonly profile: PhotoRasterExportProfileV1;
	readonly options: Options;
	readonly owner: JournalOwner;
	readonly prepared: Readonly<PreparedPhotoRasterBatchSelection> | null;
	readonly bindings: readonly Readonly<PhotoRasterExportBindingV1>[];
	readonly recovery: readonly Readonly<PhotoRasterExportRecoveryEntryV1>[];
	readonly verify: PhotoLibraryExportJournalAccess['verifyResources'];
}
/** Composition of existing journal, queue and download owners. It adds no
 * scheduler and acquires neither persisted handles nor automatic permission. */
export class PhotoRasterPersistedBatchKernelV1 {
	readonly #profile: PhotoRasterExportProfileV1;
	readonly #journal: JournalOwner;
	readonly #options: Options;
	readonly #bindings: readonly Readonly<PhotoRasterExportBindingV1>[];
	readonly #verify: PhotoLibraryExportJournalAccess['verifyResources'];
	readonly prepared: Readonly<PreparedPhotoRasterBatchSelection> | null;
	readonly recovery: readonly Readonly<PhotoRasterExportRecoveryEntryV1>[];
	protected constructor(state: PhotoRasterPersistedBatchPreparedV1) {
		if (state.profile !== 'legacy2' && state.profile !== 'current3') throw new TypeError('Unsupported photo persisted batch profile.');
		this.#profile = state.profile; this.#options = state.options; this.#journal = state.owner; this.prepared = state.prepared;
		this.#bindings = state.bindings; this.recovery = state.recovery; this.#verify = state.verify;
	}
	get journal() { return this.#journal.current; }
	discardUnfinished(review: unknown): Promise<void> { this.#options.signal.throwIfAborted(); return this.#journal.discardUnfinished(review); }
	protected static async prepareForProfileV1(profile: PhotoRasterExportProfileV1, options: Options): Promise<PhotoRasterPersistedBatchPreparedV1> {
		if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported photo persisted batch profile.');
		options = captureOptions(options);
		const { signal, openJournal, readSidecar, execute, selection } = options;
		const access = await openJournal({ signal }); signal.throwIfAborted();
		const owner = profile === 'current3' ? new PhotoRasterExportJournalOwnerCurrentV1(access.settings, access.catalogId)
			: new PhotoRasterExportJournalOwnerV1(access.settings, access.catalogId);
		const verifyResources = access.verifyResources;
		if (typeof verifyResources !== 'function') throw new TypeError('Photo export journal requires joined resource verification.');
		const verify: PhotoLibraryExportJournalAccess['verifyResources'] = (...args) => Reflect.apply(verifyResources, access, args);
		try {
			const journal = await owner.load(); signal.throwIfAborted();
			const prepared = selection.length ? await preparePhotoRasterBatchSelectionForProfileV1(profile, selection, execute, signal) : null;
			if (prepared && prepared.catalogId !== access.catalogId) throw new Error('Photo export journal catalog changed.');
			const reads = prepared ? await Promise.allSettled(prepared.members.map(member => readPhotoRasterExportBindingForProfileV1(profile, { catalogId: access.catalogId, ...member }, readSidecar, signal, true))) : [];
			const bindings: Readonly<PhotoRasterExportBindingV1>[] = [];
			// Every captured read joins before any opaque refusal leaves preparation.
			for (const read of reads) { if (read.status === 'rejected') throw read.reason; bindings.push(read.value); }
			const current: { photoId: string; versionId: string; expectedRevision: number; binding: Readonly<PhotoRasterExportBindingV1> }[] = [];
			if (journal) for (const member of journal.members) {
				try { const binding = await readPhotoRasterExportBindingForProfileV1(profile, { catalogId: access.catalogId, ...member }, readSidecar, signal, Boolean(journal.sidecarEnabled)); current.push({ photoId: member.photoId, versionId: member.versionId, expectedRevision: member.expectedRevision, binding }); }
				catch { signal.throwIfAborted(); /* Missing/stale facts never authorize work. */ }
			}
			signal.throwIfAborted();
			return Object.freeze({ profile, options, owner, prepared, bindings: Object.freeze(bindings), recovery: journal ? reconcilePhotoRasterExportBatchRecoveryForProfileV1(profile, journal, { catalogId: access.catalogId, members: current }) : Object.freeze([]), verify });
		} catch (error) { await owner.closeAndJoin(); throw error; }
	}
	/** Native ports and exact targets pin in the gesture, before the held CAS.
	 * A failed publication still owns and joins the acquired native retirement. */
	prepareFreshDestinations(plan: Readonly<PhotoRasterExportBatchV1>, runtime: unknown, filenameTemplate: string, replaceCompleted = false): Promise<Readonly<PhotoRasterExportBatchDestinations>> {
		this.#options.signal.throwIfAborted();
		if (!this.prepared || plan.members.some((member, index) => {
			const original = this.prepared!.members[index]; return !original || member.photoId !== original.photoId || member.versionId !== original.versionId || member.expectedRevision !== original.expectedRevision || member.sourceFileName !== original.sourceFileName;
		}) || plan.members.length !== this.prepared.members.length) throw new TypeError('Photo export plan differs from its captured selection.');
		if (this.journal && (!replaceCompleted || this.journal.members.some(member => !isPhotoRasterExportMemberCompleteV1(member)))) throw new TypeError('Existing export history requires explicit completed replacement.');
		if (this.journal?.batchId === plan.batchId) throw new TypeError('Completed replacement requires a different batch identity.');
		const value = createPhotoRasterExportJournalForProfileV1(this.#profile, plan, { catalogId: this.#journal.catalogId, filenameTemplate, bindings: plan.sidecarEnabled ? this.#bindings : this.#bindings.map(({ originalSha256, recipeSha256, lutSha256 }) => ({ originalSha256, recipeSha256, lutSha256 })) });
		const native = createPhotoRasterBatchDownloadDestinations(plan, runtime);
		return (async () => {
			try {
				if (replaceCompleted) await this.#journal.replaceCompleted(value); else await this.#journal.create(value);
				return await this.#destinations(plan, native, []);
			} catch (cause) {
				let cleanup: Readonly<{ cause: unknown }> | undefined;
				try { await native.retireAndJoin(); } catch (cause) { cleanup = Object.freeze({ cause }); }
				throw new PhotoRasterJournalDestinationErrorV1(cause, Object.freeze({ deliveries: Object.freeze([]), publicationFailures: Object.freeze([]) }), cleanup);
			}
		})();
	}
	prepareRecoveryDestinations(plan: Readonly<PhotoRasterExportBatchV1>, runtime: unknown, reviewedRetryJobIds: readonly string[]): Promise<Readonly<PhotoRasterExportBatchDestinations>> {
		this.#options.signal.throwIfAborted();
		assertPhotoRasterJournalPlanForProfileV1(this.#profile, plan, this.#journal);
		for (const member of plan.members) {
			const entry = this.recovery.find(entry => entry.member.jobId === member.jobId);
			if (!entry?.currentMatches || entry.disposition === 'already-committed' || entry.disposition === 'stale' || (entry.disposition === 'needs-review' && !reviewedRetryJobIds.includes(member.jobId))) throw new TypeError('Photo export recovery requires current facts and explicit uncertainty review.');
		}
		return this.#destinations(plan, createPhotoRasterBatchDownloadDestinations(plan, runtime), reviewedRetryJobIds);
	}
	async #destinations(plan: Readonly<PhotoRasterExportBatchV1>, native: Readonly<PhotoRasterExportBatchDestinations>, reviewed: readonly string[]): Promise<Readonly<PhotoRasterExportBatchDestinations>> {
		const verify = async (member: PhotoRasterExportBatchV1['members'][number], request: Parameters<PhotoRasterExportBatchDestinations['saveFile']>[1]) => {
			const signal = request.signal ? AbortSignal.any([this.#options.signal, request.signal]) : this.#options.signal, journal = this.#journal.current!;
			// After durable intent, both complete saved facts and real original/LUT
			// bodies are re-admitted immediately before either native delivery.
			const binding = await readPhotoRasterExportBindingForProfileV1(this.#profile, { catalogId: journal.catalogId, ...member }, this.#options.readSidecar, signal, Boolean(journal.sidecarEnabled));
			if (JSON.stringify(binding) !== JSON.stringify(journal.members.find(row => row.jobId === member.jobId)!.binding)) throw new Error('Photo export journal original, recipe, metadata or LUT changed before delivery.');
			await this.#verify({ catalogId: journal.catalogId, photoId: member.photoId, versionId: member.versionId, expectedRevision: member.expectedRevision }, { signal }); signal.throwIfAborted();
		};
		const verified = Object.freeze<PhotoRasterExportBatchDestinations>({ prepareSave: native.prepareSave, retireAndJoin: native.retireAndJoin,
			saveFile: async (member, request) => { await verify(member, request); return native.saveFile(member, request); },
			...(native.saveSidecar ? { saveSidecar: async (member: PhotoRasterExportBatchV1['members'][number], request: Parameters<PhotoRasterExportBatchDestinations['saveFile']>[1]) => { await verify(member, request); return native.saveSidecar!(member, request); } } : {}),
		});
		const joined = await createPhotoRasterJournalDestinationsForProfileV1(this.#profile, plan, this.#journal, () => verified, { reviewedRetryJobIds: reviewed });
		return Object.freeze({ prepareSave: joined.prepareSave, saveFile: joined.saveFile, ...(joined.saveSidecar ? { saveSidecar: joined.saveSidecar } : {}), retireAndJoin: joined.retireAndJoin });
	}
	closeAndJoin(): Promise<void> { return this.#journal.closeAndJoin(); }
}
function captureOptions(value: unknown): Readonly<Options> {
	const input = record(value, 'Photo persisted batch capabilities', ['selection', 'execute', 'readSidecar', 'openJournal', 'signal']);
	const selection = array(field(input, 'selection', 'batch'), 'Photo persisted batch selection', 0, 64);
	const signal = field(input, 'signal', 'batch') as AbortSignal; Reflect.apply(AbortSignal.prototype.throwIfAborted, signal, []);
	const method = <Method>(key: string): Method => {
		const fn = field(input, key, 'Photo persisted batch capability');
		if (typeof fn !== 'function') throw new TypeError('Photo persisted batch requires own callable capabilities.');
		return ((...args: unknown[]) => Reflect.apply(fn, value, args) as unknown) as Method;
	};
	return Object.freeze({ selection: selection.length ? capturePhotoRasterBatchSelection(selection) : Object.freeze([]), signal,
		execute: method<Options['execute']>('execute'), readSidecar: method<Options['readSidecar']>('readSidecar'), openJournal: method<Options['openJournal']>('openJournal') });
}
