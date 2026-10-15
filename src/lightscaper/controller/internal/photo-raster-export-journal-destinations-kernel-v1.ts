/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../../common/editor/closed-domain-value.ts';
import type { BrowserFileSaveRequest, BrowserSavedFile } from '../../../common/editor/browser-file-save-service.ts';
import { capturePhotoRasterExportOutput, type PhotoRasterExportProfileV1 } from '../photo-raster-export-contract-v1.ts';
import { capturePhotoRasterExportOutputCurrentV1 } from '../photo-raster-export-output-current-v1.ts';
import { normalizePhotoRasterBatchGraphicIntentV1 } from '../photo-raster-export-batch-graphic-v1.ts';
import type { PhotoRasterExportBatchMemberV1 } from '../photo-raster-export-batch-v1.ts';
import type { PhotoRasterExportBatchCurrentV1 } from '../photo-raster-export-batch-current-v1.ts';
import type { PhotoRasterExportBatchDestinations } from '../photo-raster-export-batch-queue.ts';
import { PHOTO_RASTER_EXPORT_SIDECAR_MAXIMUM_BYTES_V1, normalizePhotoRasterExportDownloadAckV1, normalizePhotoRasterExportSidecarAckV1, isPhotoRasterExportMemberCompleteV1, type PhotoRasterExportSidecarAckV1, type PhotoRasterExportDownloadAckV1 } from '../../storage/photo-raster-export-journal-v1.ts';
import type { PhotoRasterExportJournalOwnerV1 } from '../../storage/photo-raster-export-journal-owner-v1.ts';

export interface PhotoRasterJournalDestinationReceiptV1 {
	readonly deliveries: readonly Readonly<{ jobId: string; ack: Readonly<PhotoRasterExportDownloadAckV1> }>[];
	readonly sidecarDeliveries?: readonly Readonly<{ jobId: string; ack: Readonly<PhotoRasterExportSidecarAckV1> }>[];
	readonly publicationFailures: readonly Readonly<{ jobId: string; cause: unknown }>[];
}
export interface PhotoRasterJournalDestinationsV1 extends PhotoRasterExportBatchDestinations {
	readonly getReceipt: () => Readonly<PhotoRasterJournalDestinationReceiptV1>;
}
export class PhotoRasterJournalDestinationErrorV1 extends Error {
	readonly failure: Readonly<{ cause: unknown; receipt: Readonly<PhotoRasterJournalDestinationReceiptV1>; cleanup?: Readonly<{ cause: unknown }> }>;
	constructor(cause: unknown, receipt: Readonly<PhotoRasterJournalDestinationReceiptV1>, cleanup?: Readonly<{ cause: unknown }>) {
		super('Photo export journal destinations did not settle.', { cause }); this.name = 'PhotoRasterJournalDestinationErrorV1';
		this.failure = Object.freeze({ cause, receipt, ...(cleanup ? { cleanup: Object.freeze({ cause: cleanup.cause }) } : {}) });
	}
}
const THROW_IF_ABORTED = AbortSignal.prototype.throwIfAborted;
/** Acquire is injected prior-authorized authority, invoked in the initial
 * gesture before any await. This adapter never opens a picker or serializes
 * capabilities. Journal intent precedes native download initiation. */
export function createPhotoRasterJournalDestinationsForProfileV1(profile: PhotoRasterExportProfileV1, plan: Readonly<PhotoRasterExportBatchCurrentV1>, journal: PhotoRasterExportJournalOwnerV1,
	acquire: () => PhotoRasterExportBatchDestinations | PromiseLike<PhotoRasterExportBatchDestinations>, options: Readonly<{ reviewedRetryJobIds?: readonly string[] }> = {},
): Promise<Readonly<PhotoRasterJournalDestinationsV1>> {
	const captured = captureMembers(profile, plan, journal), sidecarEnabled = journal.current!.sidecarEnabled === true;
	const input = record(options, 'Photo export retry options', ['reviewedRetryJobIds'], []);
	const reviewed = new Set(array(Object.hasOwn(input, 'reviewedRetryJobIds') ? field(input, 'reviewedRetryJobIds', 'retry') : [], 'Reviewed photo export jobs', 0, captured.size).map(value => {
		if (typeof value !== 'string' || ![...captured.values()].includes(value)) throw new TypeError('Photo export retry review must name a captured member.'); return value;
	}));
	for (const jobId of captured.values()) {
		const member = journal.current!.members.find(member => member.jobId === jobId)!;
		if (isPhotoRasterExportMemberCompleteV1(member) || ((member.state === 'started' || member.sidecar?.state === 'started') && !reviewed.has(jobId))) throw new TypeError('Photo export recovery requires explicit review and fresh authorization.');
	}
	let authority: PhotoRasterExportBatchDestinations | PromiseLike<PhotoRasterExportBatchDestinations>;
	try { authority = acquire(); }
	catch (cause) { throw new PhotoRasterJournalDestinationErrorV1(cause, Object.freeze({ deliveries: Object.freeze([]), publicationFailures: Object.freeze([]) })); }
	// Direct authority is pinned before yielding. A promised authority is pinned
	// immediately on its native fulfillment, without reading capability getters.
	if (authority && typeof authority === 'object' && Object.getOwnPropertyDescriptor(authority, 'retireAndJoin')) {
		return captureAuthority(authority as PhotoRasterExportBatchDestinations, captured, journal, reviewed, sidecarEnabled);
	}
	return Promise.resolve(authority).then(runtime => captureAuthority(runtime, captured, journal, reviewed, sidecarEnabled), cause => {
		throw new PhotoRasterJournalDestinationErrorV1(cause, Object.freeze({ deliveries: Object.freeze([]), publicationFailures: Object.freeze([]) }));
	});
}
async function captureAuthority(runtime: PhotoRasterExportBatchDestinations, members: ReadonlyMap<Readonly<PhotoRasterExportBatchMemberV1>, string>,
	journal: PhotoRasterExportJournalOwnerV1, reviewed: ReadonlySet<string>, sidecarEnabled: boolean): Promise<Readonly<PhotoRasterJournalDestinationsV1>> {
	const sidecarDeliveries = new Map<string, Readonly<PhotoRasterExportSidecarAckV1>>();
	const deliveries = new Map<string, Readonly<PhotoRasterExportDownloadAckV1>>(), publications = new Map<string, unknown>();
	const receipt = (): Readonly<PhotoRasterJournalDestinationReceiptV1> => Object.freeze({ deliveries: Object.freeze([...deliveries].map(([jobId, ack]) => Object.freeze({ jobId, ack }))),
		...(sidecarEnabled ? { sidecarDeliveries: Object.freeze([...sidecarDeliveries].map(([jobId, ack]) => Object.freeze({ jobId, ack }))) } : {}),
		publicationFailures: Object.freeze([...publications].map(([jobId, cause]) => Object.freeze({ jobId, cause }))) });
	const pin = <Method>(name: string): Method => {
		if (!runtime || typeof runtime !== 'object') throw new TypeError('Photo export destinations require native ports.');
		const descriptor = Object.getOwnPropertyDescriptor(runtime, name), fn: unknown = descriptor?.value;
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof fn !== 'function') throw new TypeError('Photo export destinations require own native ports.');
		return ((...args: unknown[]) => Reflect.apply(fn, runtime, args) as unknown) as Method;
	};
	// A safely admitted own cleanup is retained before other capability admission.
	let retire: PhotoRasterExportBatchDestinations['retireAndJoin'];
	try { retire = pin('retireAndJoin'); } catch (cause) { throw new PhotoRasterJournalDestinationErrorV1(cause, receipt()); }
	let prepare: PhotoRasterExportBatchDestinations['prepareSave'], save: PhotoRasterExportBatchDestinations['saveFile'], saveSidecar: PhotoRasterExportBatchDestinations['saveSidecar'];
	try { prepare = pin('prepareSave'); save = pin('saveFile'); if (sidecarEnabled) saveSidecar = pin('saveSidecar'); }
	catch (error) {
		try { await retire(); } catch (cleanup) { throw new PhotoRasterJournalDestinationErrorV1(error, receipt(), { cause: cleanup }); }
		throw new PhotoRasterJournalDestinationErrorV1(error, receipt());
	}
	const pending = new Set<Promise<unknown>>(), failed: unknown[] = [], attempted = new Set<string>();
	let closed = false, retirement: Promise<void> | null = null;
	const memberId = (member: Readonly<PhotoRasterExportBatchMemberV1>): string => {
		if (closed) throw new DOMException('Photo export journal destinations retired.', 'AbortError');
		const jobId = members.get(member); if (!jobId) throw new TypeError('Photo export destination member is outside its captured plan.'); return jobId;
	};
	const join = <Result>(invoke: () => Promise<Result>): Promise<Result> => {
		const work = invoke(); pending.add(work);
		void work.then(() => { pending.delete(work); }, error => { pending.delete(work); failed.push(error); }); return work;
	};
	const deliver = (member: Readonly<PhotoRasterExportBatchMemberV1>, request: BrowserFileSaveRequest, sidecar: boolean): Promise<BrowserSavedFile> => {
		const jobId = memberId(member), attempt = jobId + (sidecar ? ':sidecar' : '');
		if (attempted.has(attempt)) throw new TypeError('Photo export delivery already attempted.'); attempted.add(attempt);
		const captured = { ...request }, fileName = member.fileName + (sidecar ? '.lightscaper.json' : '');
		if (sidecar && (captured.mimeType !== 'application/json' || !(captured.blob instanceof Blob) || captured.blob.type !== 'application/json'
			|| captured.blob.size < 1 || captured.blob.size > PHOTO_RASTER_EXPORT_SIDECAR_MAXIMUM_BYTES_V1)) throw new TypeError('Photo companion requires bounded JSON bytes.');
		return join(async () => {
			if (sidecar) await journal.sidecarStarted(jobId, reviewed.has(jobId)); else await journal.started(jobId, reviewed.has(jobId));
			if (closed) throw new DOMException('Photo export destinations retired before delivery.', 'AbortError');
			if (captured.signal) Reflect.apply(THROW_IF_ABORTED, captured.signal, []);
			const saved = await (sidecar ? saveSidecar! : save)(member, captured);
			if (Object.hasOwn(saved, 'cancelled')) {
				const cancelled = record(saved, 'Photo export cancelled download', ['cancelled', 'fileName', 'size']);
				if (field(cancelled, 'cancelled', 'cancelled') !== true) throw new TypeError('Photo export cancellation must be explicit.');
				const scalar = normalizePhotoRasterExportDownloadAckV1({ status: 'download-started', method: 'download', fileName: field(cancelled, 'fileName', 'cancelled'), size: field(cancelled, 'size', 'cancelled') }, fileName);
				return Object.freeze<BrowserSavedFile>({ cancelled: true, fileName: scalar.fileName, size: scalar.size });
			}
			const input = record(saved, 'Photo export native download', ['method', 'fileName', 'size']);
			const raw = { status: 'download-started', method: field(input, 'method', 'download'), fileName: field(input, 'fileName', 'download'), size: field(input, 'size', 'download') };
			if (sidecar) {
				const ack = normalizePhotoRasterExportSidecarAckV1({ ...raw, mediaType: 'application/json' }, member.fileName);
				if (ack.size !== captured.blob!.size) throw new TypeError('Photo JSON download size differs from its captured body.');
				sidecarDeliveries.set(jobId, ack); try { await journal.sidecarCommitted(jobId, ack); } catch (cause) { publications.set(attempt, cause); }
			} else {
				const ack = normalizePhotoRasterExportDownloadAckV1(raw, member.fileName);
				deliveries.set(jobId, ack); try { await journal.committed(jobId, ack); } catch (cause) { publications.set(attempt, cause); }
			}
			return Object.freeze<BrowserSavedFile>({ method: 'download', fileName, size: field(input, 'size', 'download') as number });
		});
	};
	const result: Readonly<PhotoRasterJournalDestinationsV1> = Object.freeze({
		getReceipt: receipt,
		prepareSave(member: Readonly<PhotoRasterExportBatchMemberV1>, request: BrowserFileSaveRequest) {
			memberId(member);
			return join(async () => {
				const prepared = await prepare(member, request);
				const input = record(prepared, 'Photo export prepared download', ['mode', 'target', 'fileName']);
				if (field(input, 'mode', 'prepared') !== 'blob' || field(input, 'fileName', 'prepared') !== member.fileName) throw new TypeError('Journaled exports require explicit blob download targets.');
				const target = record(field(input, 'target', 'prepared'), 'Photo export download target', ['browserDownload', 'name']);
				if (field(target, 'browserDownload', 'target') !== true || field(target, 'name', 'target') !== member.fileName) throw new TypeError('Journaled exports refuse deferred native destinations.');
				return prepared;
			});
		},
		saveFile(member: Readonly<PhotoRasterExportBatchMemberV1>, request: BrowserFileSaveRequest) { return deliver(member, request, false); },
		...(sidecarEnabled ? { saveSidecar(member: Readonly<PhotoRasterExportBatchMemberV1>, request: BrowserFileSaveRequest) { return deliver(member, request, true); } } : {}),
		retireAndJoin() {
			if (retirement) return retirement; closed = true;
			retirement = (async () => {
				await Promise.allSettled([...pending]); await journal.closeAndJoin();
				let cleanup: Readonly<{ cause: unknown }> | undefined;
				try { await retire(); } catch (cause) { cleanup = Object.freeze({ cause }); }
				if (failed.length || cleanup) throw new PhotoRasterJournalDestinationErrorV1(failed.length ? failed[0] : cleanup!.cause, receipt(), failed.length ? cleanup : undefined);
			})(); return retirement;
		},
	}); return result;
}
/** Before acquiring native authority, recovery retains the complete journal plan. */
export function assertPhotoRasterJournalPlanForProfileV1(profile: PhotoRasterExportProfileV1, plan: Readonly<PhotoRasterExportBatchCurrentV1>, owner: PhotoRasterExportJournalOwnerV1): void {
	captureMembers(profile, plan, owner);
}
function captureMembers(profile: PhotoRasterExportProfileV1, planValue: Readonly<PhotoRasterExportBatchCurrentV1>, owner: PhotoRasterExportJournalOwnerV1): ReadonlyMap<Readonly<PhotoRasterExportBatchMemberV1>, string> {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unsupported fixed photo export destinations profile.');
	const journal = owner.current; if (!journal) throw new TypeError('Photo export destinations require a durable journal.');
	const plan = record(planValue, 'Photo export destination plan', ['schemaVersion', 'batchId', 'format', 'members', 'output', 'sidecarEnabled', 'graphicWatermark'], ['schemaVersion', 'batchId', 'format', 'members']);
	if (field(plan, 'schemaVersion', 'plan') !== 1 || field(plan, 'batchId', 'plan') !== journal.batchId || field(plan, 'format', 'plan') !== journal.format) throw new TypeError('Photo export destinations differ from their journal.');
	const output = Object.hasOwn(plan, 'output') ? profile === 'current3' ? capturePhotoRasterExportOutputCurrentV1(field(plan, 'output', 'plan'), journal.format)
		: capturePhotoRasterExportOutput(field(plan, 'output', 'plan')) : undefined;
	const sidecarEnabled = Object.hasOwn(plan, 'sidecarEnabled') ? field(plan, 'sidecarEnabled', 'plan') : false;
	if (typeof sidecarEnabled !== 'boolean' || sidecarEnabled !== Boolean(journal.sidecarEnabled)) throw new TypeError('Photo companion selection differs from its journal.');
	if (JSON.stringify(output) !== JSON.stringify(journal.output)) throw new TypeError('Photo export settings differ from their journal.');
	const graphicWatermark = Object.hasOwn(plan, 'graphicWatermark') ? normalizePhotoRasterBatchGraphicIntentV1(field(plan, 'graphicWatermark', 'plan')) : undefined;
	if (JSON.stringify(graphicWatermark) !== JSON.stringify(journal.graphicWatermark)) throw new TypeError('Photo export graphic differs from its journal.');
	const seen = new Set<string>();
	return new Map(array(field(plan, 'members', 'plan'), 'Photo export destination members', 1, journal.members.length).map(value => {
		const keys = ['jobId', 'index', 'photoId', 'versionId', 'expectedRevision', 'sourceFileName', 'fileName'] as const;
		const member = record(value, 'Photo export destination member', keys), jobId = field(member, 'jobId', 'member');
		const stored = journal.members.find(member => member.jobId === jobId);
		if (!stored || seen.has(stored.jobId) || keys.some(key => field(member, key, 'member') !== stored[key])) throw new TypeError('Photo export member differs from its journal.');
		seen.add(stored.jobId); return [value as Readonly<PhotoRasterExportBatchMemberV1>, stored.jobId] as const;
	}));
}
