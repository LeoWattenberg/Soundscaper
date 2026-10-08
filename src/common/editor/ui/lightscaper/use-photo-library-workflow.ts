/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoLibraryBackupSaveV1, type PhotoLibraryBackupSaveRequestV1,
	type PhotoLibraryBackupSaveReceiptV1 } from '../../controller/shared/photo-library-backup-save-v1.ts';
import { PhotoLibraryOriginalRecoveryV1 } from '../../controller/shared/photo-library-original-recovery-v1.ts';
import { usePhotoOriginalRecovery, type ExecutePhotoOriginalRecoveryV1 } from './use-photo-original-recovery.ts';
import type { PhotoLibraryCullReceiptV1 } from '../../controller/shared/photo-library-culling-v1.ts';
import type { PhotoLibraryBatchRenamePlanV1, PhotoLibraryBatchRenameReceiptV1, PhotoLibraryBatchRenameRequestV1,
	PhotoLibraryBatchRenameSnapshotV1, PhotoLibraryBatchRenameUndoV1 } from '../../photo-library-batch-rename-port-v1.ts';
import { readPhotoLibrarySelectionIdsV1 } from '../../controller/shared/photo-library-selection-v1.ts';
import { createPhotoLibraryImportCollectorV1, detachPhotoLibraryImportSettingsV1 } from '../../controller/shared/photo-library-import-gesture-v1.ts';
import type { PhotoLibraryImportGestureReceiptV1, PhotoLibraryImportPresetCommandV1, PhotoLibraryImportPresetSnapshotV1,
	PhotoLibraryImportRequestOptionsV1 } from '../../photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryDefinitionAcknowledgementV1, PhotoLibraryDefinitionCommandV1, PhotoLibraryDefinitionReadRequestV1,
	PhotoLibraryMembershipPatchV1, PhotoLibraryMembershipSnapshotV1 } from '../../photo-library-organization-port-v1.ts';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryAttributePatchV1, PhotoLibraryImportItemV1, PhotoLibraryMetadataPatchV1, PhotoLibraryMetadataSnapshotV1, PhotoLibraryDefinitionPageRequestV1, PhotoLibraryQueryBuildProgressV1, PhotoLibraryQueryV1, PhotoLibraryPreviewTierV1, PhotoLibraryPageV1, PhotoLibraryRowV1, PhotoLibrarySessionPortV1 } from '../../photo-library-session-port-v1.ts';

interface SessionSlot {
	live: boolean;
	readonly factory: CreatePhotoLibrarySessionV1 | undefined;
	readonly backupLoader: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined;
	readonly lifetime: AbortController;
	readonly beforeDrain: Promise<void> | null;
	pending: Promise<PhotoLibrarySessionPortV1> | null;
	active: AbortController | null;
	query: PhotoLibraryQueryV1 | null;
	page: PhotoLibraryPageV1 | null;
	batchRenamePlanner: PhotoLibrarySessionPortV1['planBatchRename'] | null;
	backupRuntime: PhotoLibraryBackupSaveRuntimeV1 | null;
	backupLoading: Promise<void> | null;
}
type SessionAction = (owner: PhotoLibrarySessionPortV1, signal: AbortSignal, current: SessionSlot) => Promise<void>;
type WorkflowAction = SessionAction
	| Readonly<{ start: (signal: AbortSignal, current: SessionSlot) => Promise<void> }>;
export type PhotoLibraryBackupSaveRuntimeV1 = Readonly<Pick<PhotoLibraryBackupSaveRequestV1, 'prepareSave' | 'saveFile' | 'maximumStreamingBytes'>>;
export type LoadPhotoLibraryBackupSaveRuntimeV1 = () => Promise<PhotoLibraryBackupSaveRuntimeV1>;
type ActionStatus = 'completed' | 'failed' | 'cancelled' | 'busy';
export type PhotoLibraryBatchRenameWorkflowReceiptV1 =
	| Readonly<{ outcome: 'acknowledged'; receipt: PhotoLibraryBatchRenameReceiptV1; notice: 'refresh-failed' | null }>
	| Readonly<{ outcome: 'failed' | 'busy' | 'cancelled' }>;
const getFileName = Object.getOwnPropertyDescriptor(File.prototype, 'name')?.get;

/** The effect owns one resource generation, including factories resolving after cleanup. */
export function usePhotoLibraryWorkflow(createSession?: CreatePhotoLibrarySessionV1, loadBackupSaveRuntime?: LoadPhotoLibraryBackupSaveRuntimeV1) {
	const factory = useRef(createSession); factory.current = createSession;
	const loader = useRef(loadBackupSaveRuntime); loader.current = loadBackupSaveRuntime;
	const backupSave = useRef<PhotoLibraryBackupSaveV1 | null>(null);
	backupSave.current ??= new PhotoLibraryBackupSaveV1();
	const controller = backupSave.current;
	const recoveryOwner = useRef<PhotoLibraryOriginalRecoveryV1 | null>(null);
	recoveryOwner.current ??= new PhotoLibraryOriginalRecoveryV1();
	const originalRecovery = recoveryOwner.current;
	const recoveryGeneration = useMemo(() => Object.freeze({ createSession, loadBackupSaveRuntime }), [createSession, loadBackupSaveRuntime]);
	const slot = useRef<SessionSlot | null>(null);
	const retiring = useRef<Promise<void> | null>(null);
	const [page, setPage] = useState<PhotoLibraryPageV1 | null>(null);
	const [receipts, setReceipts] = useState<readonly PhotoLibraryImportItemV1[]>([]);
	const [importReceipt, setImportReceipt] = useState<PhotoLibraryImportGestureReceiptV1 | null>(null);
	const [metadata, setMetadata] = useState<PhotoLibraryMetadataSnapshotV1 | null>(null);
	const [memberships, setMemberships] = useState<PhotoLibraryMembershipSnapshotV1 | null>(null);
	const [busy, setBusy] = useState(false);
	const [query, setQuery] = useState<PhotoLibraryQueryV1 | null>(null);
	const [needsQueryIndex, setNeedsQueryIndex] = useState(false);
	const [queryIndexProgress, setQueryIndexProgress] = useState<PhotoLibraryQueryBuildProgressV1 | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [batchRenameSnapshot, setBatchRenameSnapshot] = useState<PhotoLibraryBatchRenameSnapshotV1 | null>(null);
	const [batchRenameReceipt, setBatchRenameReceipt] = useState<Extract<PhotoLibraryBatchRenameWorkflowReceiptV1, { outcome: 'acknowledged' }> | null>(null);
	const [batchRenameUndo, setBatchRenameUndo] = useState<PhotoLibraryBatchRenameUndoV1 | null>(null);
	const [backupRuntime, setBackupRuntime] = useState<PhotoLibraryBackupSaveRuntimeV1 | null>(null);
	const [backupReceipt, setBackupReceipt] = useState<PhotoLibraryBackupSaveReceiptV1 | null>(null);
	const publishPage = useCallback((current: SessionSlot, next: PhotoLibraryPageV1 | null) => {
		if (!current.live) return null;
		current.page = next; setPage(next); return next;
	}, []);
	useEffect(() => {
		const current: SessionSlot = { live: true, factory: createSession, backupLoader: loadBackupSaveRuntime, lifetime: new AbortController(),
			beforeDrain: retiring.current, pending: null, active: null, query: null, page: null, batchRenamePlanner: null, backupRuntime: null, backupLoading: null };
		slot.current = current;
		queueMicrotask(() => {
			if (!current.live) return;
			setQuery(null); setNeedsQueryIndex(false); setQueryIndexProgress(null);
			publishPage(current, null); setMetadata(null); setMemberships(null); setReceipts([]); setImportReceipt(null); setError(null); setBusy(current.active !== null || controller.isPending() || originalRecovery.isPending());
			setBatchRenameSnapshot(null); setBatchRenameReceipt(null); setBatchRenameUndo(null);
			setBackupRuntime(null); setBackupReceipt(null);
		});
		return () => {
			current.live = false; current.lifetime.abort(); current.active?.abort();
			if (slot.current === current) slot.current = null;
			const pending = current.pending;
			const destinationClosed = Promise.all([controller.cancelAndJoin(), originalRecovery.cancelAndJoin()]);
			const closing = (async () => {
				if (current.beforeDrain) await current.beforeDrain;
				await destinationClosed;
				const owner = await pending?.catch(() => null);
				await owner?.close();
			})();
			retiring.current = closing;
			void closing.catch(() => undefined);
		};
	}, [createSession, loadBackupSaveRuntime, publishPage, controller, originalRecovery]);

	const perform = useCallback(async (action: WorkflowAction, externalSignal?: AbortSignal): Promise<ActionStatus> => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession || current.factory !== factory.current
			|| current.backupLoader !== loadBackupSaveRuntime || current.backupLoader !== loader.current) return 'cancelled';
		if (current.active || controller.isPending() || originalRecovery.isPending()) return 'busy';
		const active = new AbortController(); current.active = active;
		const signal = AbortSignal.any([active.signal, current.lifetime.signal, ...(externalSignal ? [externalSignal] : [])]);
		setBusy(true); setError(null);
		try {
			signal.throwIfAborted();
			if (typeof action === 'function') {
				const owner = await acquire(current);
				signal.throwIfAborted(); await action(owner, signal, current);
			} else await action.start(signal, current);
			return 'completed';
		} catch (failure) {
			// The destination owner can fail cleanup after cancellation. Its error is
			// distinct from the exact cancellation reason and must remain visible.
			const cancelled = signal.aborted && (typeof action === 'function' || failure === signal.reason);
			if (current.live) {
				if (!signal.aborted && errorCode(failure) === 'PHOTO_QUERY_INDEX_NOT_READY') { setNeedsQueryIndex(true); setError(null); }
				else setError(cancelled ? null : message(failure));
			}
			return cancelled ? 'cancelled' : 'failed';
		} finally {
			current.active = null;
			const visible = slot.current;
			if (visible?.live) setBusy(visible.active !== null || controller.isPending() || originalRecovery.isPending());
		}
	}, [createSession, loadBackupSaveRuntime, controller, originalRecovery]);
	const executeOriginalRecovery = useCallback<ExecutePhotoOriginalRecoveryV1>(async action => perform({ start: async (signal, current) => {
		await action({ signal, acquire: () => acquire(current),
			isCurrent: () => current.live && slot.current === current && current.factory === factory.current && current.backupLoader === loader.current,
			refresh: async () => {
				const owner = await acquire(current); signal.throwIfAborted();
				const next = current.query ? await readNonemptyQueryPage(owner, current.query, null, signal) : await owner.readPage({ signal });
				signal.throwIfAborted(); publishPage(current, next);
			} });
	} }), [perform, publishPage]);
	const originalWorkflow = usePhotoOriginalRecovery({ generation: recoveryGeneration, controller: originalRecovery, execute: executeOriginalRecovery });
	const run = useCallback(async (action: SessionAction): Promise<void> => { await perform(action); }, [perform]);
	const prepareBackupSave = useCallback((): Promise<void> => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession || current.factory !== factory.current
			|| current.backupLoader !== loadBackupSaveRuntime || current.backupLoader !== loader.current
			|| !loadBackupSaveRuntime || current.backupRuntime) return Promise.resolve();
		if (current.backupLoading) return current.backupLoading;
		setError(null);
		const pending = Promise.resolve().then(loadBackupSaveRuntime).then(runtime => {
			if (!current.live || current.factory !== factory.current || current.backupLoader !== loader.current) return;
			current.backupRuntime = runtime; setBackupRuntime(runtime);
		}).catch(failure => { if (current.live && current.factory === factory.current && current.backupLoader === loader.current) setError(message(failure)); })
			.finally(() => { if (current.backupLoading === pending) current.backupLoading = null; });
		current.backupLoading = pending; return pending;
	}, [createSession, loadBackupSaveRuntime]);
	const saveBackup = useCallback(async (request: Pick<PhotoLibraryBackupSaveRequestV1, 'catalogName' | 'fileTypeDescription'>): Promise<PhotoLibraryBackupSaveReceiptV1 | null> => {
		const admission = slot.current;
		if (!admission?.live || admission.factory !== createSession || admission.factory !== factory.current
			|| admission.backupLoader !== loadBackupSaveRuntime || admission.backupLoader !== loader.current || !admission.backupRuntime) return null;
		let receipt: PhotoLibraryBackupSaveReceiptV1 | null = null;
		const status = await perform({ start: async (signal, current) => {
			setBackupReceipt(null);
			receipt = await controller.start({ ...request, ...admission.backupRuntime!, signal,
				backupCatalog: async options => {
					const owner = await acquire(current); options.signal?.throwIfAborted();
					return owner.backupCatalog(options);
				} });
		} });
		if (!receipt && status === 'cancelled') receipt = Object.freeze({ status: 'cancelled' });
		if (admission.live && admission.factory === factory.current && admission.backupLoader === loader.current && status !== 'busy') setBackupReceipt(receipt);
		return receipt;
	}, [perform, controller, createSession, loadBackupSaveRuntime]);

	const readPreview = useCallback(async (photoId: string, tier: PhotoLibraryPreviewTierV1,
		options: Readonly<{ signal?: AbortSignal }> = {}) => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession) throw new DOMException('Photo preview generation is closed.', 'AbortError');
		const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
		signal.throwIfAborted();
		const owner = await acquire(current); signal.throwIfAborted();
		const result = await owner.readPreview(photoId, tier, { signal }); signal.throwIfAborted();
		return result;
	}, [createSession]);

	const readPage = useCallback((cursor: string | null = null) => run(async (owner, signal, current) => {
		const next = current.query ? await readNonemptyQueryPage(owner, current.query, cursor, signal) : await owner.readPage({ cursor, signal });
		publishPage(current, next);
	}), [run, publishPage]);
	const readBatchRenameSelection = useCallback(async (values: readonly string[], options: Readonly<{ signal?: AbortSignal }> = {}): Promise<void> => {
		const admission = slot.current;
		if (!admission?.live || admission.factory !== factory.current || admission.active || controller.isPending() || originalRecovery.isPending()) return;
		let ids: readonly string[];
		try {
			ids = readPhotoLibrarySelectionIdsV1(values);
			if (ids.length === 0) throw new RangeError('Batch rename requires selected photos.');
		} catch (failure) { setError(message(failure)); return; }
		setBatchRenameSnapshot(null); setBatchRenameReceipt(null); admission.batchRenamePlanner = null;
		await perform(async (owner, signal, current) => {
			const next = await owner.readBatchRenameSelection(ids, { signal }); signal.throwIfAborted();
			if (current.live && current.factory === factory.current) {
				current.batchRenamePlanner = request => owner.planBatchRename(request); setBatchRenameSnapshot(next);
			}
		}, options.signal);
	}, [perform, controller, originalRecovery]);
	const planBatchRename = useCallback((request: PhotoLibraryBatchRenameRequestV1): PhotoLibraryBatchRenamePlanV1 => {
		const current = slot.current;
		if (!current?.live || current.factory !== factory.current || !current.batchRenamePlanner) {
			throw new DOMException('Batch rename selection is unavailable.', 'AbortError');
		}
		return current.batchRenamePlanner(request);
	}, []);
	const runBatchRename = useCallback(async (save: (owner: PhotoLibrarySessionPortV1, signal: AbortSignal) => Promise<PhotoLibraryBatchRenameReceiptV1>,
		options: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryBatchRenameWorkflowReceiptV1> => {
		if (!slot.current?.live || slot.current.factory !== factory.current) return Object.freeze({ outcome: 'cancelled' });
		let result: Extract<PhotoLibraryBatchRenameWorkflowReceiptV1, { outcome: 'acknowledged' }> | null = null;
		let generation: SessionSlot | null = null;
		const remember = (current: SessionSlot, acknowledged: Extract<PhotoLibraryBatchRenameWorkflowReceiptV1, { outcome: 'acknowledged' }>) => {
			if (!current.live || current.factory !== factory.current) return;
			setBatchRenameReceipt(acknowledged);
			if (acknowledged.receipt.action === 'undo' || acknowledged.receipt.items.some(item => item.status === 'renamed')) {
				setBatchRenameUndo(acknowledged.receipt.undo);
			}
		};
		const status = await perform(async (owner, signal, current) => {
			if (!current.live || current.factory !== factory.current) throw new DOMException('Batch rename generation is closed.', 'AbortError');
			generation = current; setBatchRenameReceipt(null);
			const receipt = await save(owner, signal);
			result = Object.freeze({ outcome: 'acknowledged', receipt, notice: 'refresh-failed' });
			remember(current, Object.freeze({ ...result, notice: null }));
			if (!current.live || current.factory !== factory.current) return;
			const names = new Map(receipt.items.filter(item => item.status !== 'failed').map(item => [item.photoId, item.fileName]));
			const previous = current.page;
			if (previous) publishPage(current, Object.freeze({ ...previous, cursor: null,
				rows: Object.freeze(previous.rows.map(row => names.has(row.id) ? Object.freeze({ ...row, fileName: names.get(row.id)! }) : row)) }));
			signal.throwIfAborted();
			const next = current.query ? await readNonemptyQueryPage(owner, current.query, null, signal) : await owner.readPage({ signal });
			signal.throwIfAborted();
			if (current.live && current.factory === factory.current && publishPage(current, next)) {
				result = Object.freeze({ outcome: 'acknowledged', receipt, notice: null });
			}
		}, options.signal);
		if (result) {
			if (generation) remember(generation, result);
			return result;
		}
		return Object.freeze({ outcome: status === 'completed' ? 'failed' : status });
	}, [perform, publishPage]);
	const renamePhotos = useCallback((plan: PhotoLibraryBatchRenamePlanV1, options: Readonly<{ signal?: AbortSignal }> = {}) =>
		runBatchRename((owner, signal) => owner.renamePhotos(plan, { signal }), options), [runBatchRename]);
	const undoBatchRename = useCallback((undo: PhotoLibraryBatchRenameUndoV1, options: Readonly<{ signal?: AbortSignal }> = {}) =>
		runBatchRename((owner, signal) => owner.undoBatchRename(undo, { signal }), options), [runBatchRename]);
	const applyQuery = (nextQuery: PhotoLibraryQueryV1) => run(async (owner, signal, current) => {
		const next = await readNonemptyQueryPage(owner, nextQuery, null, signal);
		if (current.live) { current.query = nextQuery; setQuery(nextQuery); setNeedsQueryIndex(false); publishPage(current, next); }
	});
	const probeQuery = () => run(async (owner, signal, current) => {
		await owner.readQueryStep({ query: current.query ?? DEFAULT_QUERY, signal });
		signal.throwIfAborted(); if (current.live) setNeedsQueryIndex(false);
	});
	const buildQueryIndex = () => run(async (owner, signal, current) => {
		let processed = 0, readBytes = 0;
		while (true) {
			signal.throwIfAborted();
			const next = await owner.rebuildQueryStep({ signal }); signal.throwIfAborted();
			processed += next.processed; readBytes += next.readBytes;
			if (current.live) setQueryIndexProgress(Object.freeze({ processed, readBytes, ready: next.ready }));
			if (next.ready) { if (current.live) setNeedsQueryIndex(false); return; }
			await yieldTask(signal);
		}
	});
	const readDefinitions = useCallback(async (request: PhotoLibraryDefinitionPageRequestV1) => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession) throw new DOMException('Definition page generation is closed.', 'AbortError');
		const signal = request.signal ? AbortSignal.any([request.signal, current.lifetime.signal]) : current.lifetime.signal;
		signal.throwIfAborted();
		const owner = await acquire(current); signal.throwIfAborted();
		const result = await owner.readDefinitionPage({ ...request, signal }); signal.throwIfAborted(); return result;
	}, [createSession]);
	const readDefinition = useCallback(async (request: PhotoLibraryDefinitionReadRequestV1) => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession) throw new DOMException('Definition generation is closed.', 'AbortError');
		const signal = request.signal ? AbortSignal.any([request.signal, current.lifetime.signal]) : current.lifetime.signal;
		signal.throwIfAborted();
		const owner = await acquire(current); signal.throwIfAborted();
		const result = await owner.readDefinition({ ...request, signal }); signal.throwIfAborted(); return result;
	}, [createSession]);

	const readImportPresets = useCallback(async (options: Readonly<{ signal?: AbortSignal }> = {}) => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession) throw new DOMException('Import preset generation is closed.', 'AbortError');
		const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
		signal.throwIfAborted(); const owner = await acquire(current); signal.throwIfAborted();
		const result = await owner.readImportPresets({ signal }); signal.throwIfAborted(); return result;
	}, [createSession]);
	const applyImportPreset = useCallback(async (command: PhotoLibraryImportPresetCommandV1, options: Readonly<{ signal?: AbortSignal }> = {}) => {
		const result: { ack?: PhotoLibraryImportPresetSnapshotV1; failure?: Readonly<{ value: unknown }> } = {};
		const status = await perform(async (owner, signal) => {
			try { result.ack = await owner.applyImportPreset(command, { signal }); }
			catch (failure) { result.failure = { value: failure }; throw failure; }
		}, options.signal);
		if (result.ack) return result.ack;
		if (result.failure) throw result.failure.value;
		if (status === 'cancelled') throw new DOMException('Import preset authoring was cancelled.', 'AbortError');
		throw new Error(status === 'busy' ? 'A photo library change is already pending.' : 'Import preset authoring failed.');
	}, [perform]);
	const importFiles = useCallback(async (files: readonly File[], options: Pick<PhotoLibraryImportRequestOptionsV1, 'settings' | 'signal'> = {}): Promise<PhotoLibraryImportGestureReceiptV1> => {
		const admission = slot.current;
		if (!admission?.live || admission.factory !== factory.current || options.signal?.aborted) return Object.freeze({ outcome: 'cancelled' });
		if (admission.active || controller.isPending() || originalRecovery.isPending()) return Object.freeze({ outcome: 'busy' });
		// Capture authored state and original source names before the lazy factory can yield.
		let draft;
		try {
			if (files.length < 1 || files.length > 64) throw new RangeError('Import requires one through 64 selected Files.');
			const selected = Object.freeze([...files]);
			const names = selected.map(file => { const name: unknown = getFileName?.call(file);
				if (typeof name !== 'string') throw new TypeError('Import requires selected source Files.'); return name; });
			draft = { selected, collector: createPhotoLibraryImportCollectorV1(names),
				settings: options.settings === undefined ? undefined : detachPhotoLibraryImportSettingsV1(options.settings) };
		} catch (failure) {
			const current = slot.current;
			if (!current?.live || current.factory !== createSession || options.signal?.aborted) return Object.freeze({ outcome: 'cancelled' });
			if (current.active) return Object.freeze({ outcome: 'busy' });
			setError(message(failure)); return Object.freeze({ outcome: 'failed' });
		}
		const { selected, collector, settings } = draft;
		setReceipts([]); setImportReceipt(null);
		let receipt: PhotoLibraryImportGestureReceiptV1 | null = null;
		const publication: { generation?: SessionSlot } = {};
		const status = await perform(async (owner, signal, current) => {
			publication.generation = current; setImportReceipt(null);
			const publish = () => {
				if (!current.live || current.factory !== factory.current) return;
				setReceipts(collector.snapshot());
				if (current.page) publishPage(current, Object.freeze({ ...current.page, cursor: null }));
			};
			let observing = true;
			try {
				const results = await owner.importFiles(selected, { signal, ...(settings === undefined ? {} : { settings }),
					onAcknowledged: item => { if (observing && collector.acknowledge(item)) publish(); } });
				observing = false;
				collector.finish(results);
				receipt = Object.freeze({ outcome: 'acknowledged', items: collector.snapshot(), completion: 'finished', notice: 'refresh-failed' });
			} catch (failure) {
				observing = false;
				if (collector.hasAcknowledgement()) receipt = Object.freeze({ outcome: 'acknowledged', items: collector.snapshot(),
					completion: signal.aborted ? 'cancelled' : 'failed', notice: 'refresh-failed' });
				publish(); throw failure;
			}
			publish(); signal.throwIfAborted();
			const next = current.query ? await readNonemptyQueryPage(owner, current.query, null, signal) : await owner.readPage({ signal });
			signal.throwIfAborted();
			if (publishPage(current, next)) receipt = Object.freeze({ outcome: 'acknowledged', items: collector.snapshot(), completion: 'finished', notice: null });
		}, options.signal);
		if (publication.generation?.live && slot.current === publication.generation && publication.generation.factory === factory.current) setImportReceipt(receipt);
		return receipt ?? Object.freeze({ outcome: status === 'completed' ? 'failed' : status });
	}, [createSession, perform, publishPage, controller, originalRecovery]);
	const refreshQuery = async (owner: PhotoLibrarySessionPortV1, signal: AbortSignal, current: SessionSlot) => {
		if (!current.query) return current.live ? current.page : null;
		const next = await readNonemptyQueryPage(owner, current.query, null, signal);
		return publishPage(current, next);
	};
	const updateRow = (updated: PhotoLibraryRowV1, current: SessionSlot) => {
		const previous = current.page;
		return publishPage(current, previous ? Object.freeze({ ...previous, cursor: null,
			rows: Object.freeze(previous.rows.map(row => row.id === updated.id ? updated : row)) }) : null);
	};
	const editAttributes = async (save: (owner: PhotoLibrarySessionPortV1, signal: AbortSignal) => Promise<PhotoLibraryRowV1>,
		options: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryCullReceiptV1> => {
		let receipt: PhotoLibraryCullReceiptV1 | null = null;
		const status = await perform(async (owner, signal, current) => {
			const updated = await save(owner, signal);
			// The durable acknowledgement remains saved even if refresh or cancellation follows.
			receipt = Object.freeze({ outcome: 'saved', photoId: updated.id, page: null, notice: 'refresh-failed' });
			try {
				// A successful query publishes one final page; an intermediate page would
				// invalidate the culling observer's captured page identity while awaiting it.
				const next = current.query ? await refreshQuery(owner, signal, current) : updateRow(updated, current);
				if (next) receipt = Object.freeze({ outcome: 'saved', photoId: updated.id, page: next, notice: null });
			} catch (failure) { updateRow(updated, current); throw failure; }
		}, options.signal);
		return receipt ?? Object.freeze({ outcome: status === 'completed' ? 'failed' : status });
	};
	const setRating = (photoId: string, rating: number, options: Readonly<{ signal?: AbortSignal }> = {}) =>
		editAttributes((owner, signal) => owner.setRating(photoId, rating, { signal }), options);
	const applyAttributes = (photoId: string, changes: PhotoLibraryAttributePatchV1, options: Readonly<{ signal?: AbortSignal }> = {}) =>
		editAttributes((owner, signal) => owner.applyAttributes(photoId, changes, { signal }), options);
	const readMetadata = useCallback((photoId: string) => run(async (owner, signal, current) => {
		setMetadata(null);
		const next = await owner.readMetadata(photoId, { signal });
		if (current.live) setMetadata(next);
	}), [run]);
	const applyMetadata = (photoId: string, expectedRevision: number, changes: PhotoLibraryMetadataPatchV1) => run(async (owner, signal, current) => {
		const next = await owner.applyMetadata(photoId, expectedRevision, changes, { signal });
		if (current.live) {
			setMetadata(next);
			const previous = current.page;
			publishPage(current, previous ? Object.freeze({ ...previous, cursor: null,
				rows: Object.freeze(previous.rows.map(row => row.id === next.photoId ? Object.freeze({ ...row, fileName: next.metadata.fileName }) : row)) }) : null);
		}
		await refreshQuery(owner, signal, current);
	});
	const applyDefinition = async (expectedRootRevision: number, command: PhotoLibraryDefinitionCommandV1): Promise<PhotoLibraryDefinitionAcknowledgementV1> => {
		const result: { ack?: PhotoLibraryDefinitionAcknowledgementV1; failure?: Readonly<{ value: unknown }> } = {};
		const status = await perform(async (owner, signal, current) => {
			try { result.ack = await owner.applyDefinition(expectedRootRevision, command, { signal }); }
			catch (failure) { result.failure = { value: failure }; throw failure; }
			if (current.page) publishPage(current, Object.freeze({ ...current.page, cursor: null }));
			await refreshQuery(owner, signal, current);
		});
		if (result.ack) return result.ack;
		if (result.failure) throw result.failure.value;
		if (status === 'cancelled') throw new DOMException('Catalog authoring was cancelled.', 'AbortError');
		throw new Error(status === 'busy' ? 'A photo library change is already pending.' : 'Catalog authoring failed.');
	};
	const readMemberships = useCallback((photoId: string) => run(async (owner, signal, current) => {
		setMemberships(null);
		const next = await owner.readMemberships(photoId, { signal });
		if (current.live) setMemberships(next);
	}), [run]);
	const applyMemberships = (photoId: string, expectedRevision: number, changes: PhotoLibraryMembershipPatchV1) => run(async (owner, signal, current) => {
		const next = await owner.applyMemberships(photoId, expectedRevision, changes, { signal });
		if (current.live) setMemberships(next.snapshot);
		updateRow(next.row, current);
		await refreshQuery(owner, signal, current);
	});
	return { ...originalWorkflow, page, metadata, memberships, batchRenameSnapshot, batchRenameReceipt, batchRenameUndo,
		prepareBackupSave, saveBackup, backupReceipt, backupReady: backupRuntime !== null, maximumBackupStreamingBytes: backupRuntime?.maximumStreamingBytes ?? null,
		cancelBackup: () => { if (controller.isPending()) slot.current?.active?.abort(); },
		readBatchRenameSelection, planBatchRename, renamePhotos, undoBatchRename, readPreview, query, needsQueryIndex, queryIndexProgress, applyQuery, probeQuery, buildQueryIndex, readDefinitions,
		readDefinition, applyDefinition, readMemberships, applyMemberships, readImportPresets, applyImportPreset, receipts, importReceipt, busy, error, readMetadata, applyMetadata, readPage, importFiles, setRating, applyAttributes,
		cancel: () => { slot.current?.active?.abort(); } };
}

function message(failure: unknown): string {
	try {
		const descriptor = failure && typeof failure === 'object' ? Object.getOwnPropertyDescriptor(failure, 'message') : undefined;
		if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') return descriptor.value.slice(0, 2_048);
	} catch { /* A diagnostic must never revoke an operation's outcome. */ }
	return 'The photo library action failed.';
}

/** A canceled observer can settle before native close; replacement joins that close. */
function acquire(current: SessionSlot): Promise<PhotoLibrarySessionPortV1> {
	if (!current.pending) {
		const pending = Promise.resolve().then(async () => {
			if (current.beforeDrain) await current.beforeDrain;
			current.lifetime.signal.throwIfAborted();
			if (!current.factory) throw new Error('The photo library is unavailable.');
			return current.factory();
		});
		current.pending = pending;
		void pending.catch(() => { if (current.pending === pending) current.pending = null; });
	}
	return current.pending;
}

export const DEFAULT_PHOTO_LIBRARY_QUERY_V1: PhotoLibraryQueryV1 = Object.freeze({ text: '', filter: null,
	sort: Object.freeze({ field: 'photo-id', direction: 'ascending' }) });
const DEFAULT_QUERY = DEFAULT_PHOTO_LIBRARY_QUERY_V1;

async function readNonemptyQueryPage(owner: PhotoLibrarySessionPortV1, query: PhotoLibraryQueryV1, cursor: string | null, signal: AbortSignal): Promise<PhotoLibraryPageV1> {
	while (true) {
		signal.throwIfAborted(); const next = await owner.readQueryStep({ query, cursor, signal }); signal.throwIfAborted();
		if (next.rows.length > 0 || next.cursor === null) return Object.freeze({
			catalogName: next.catalogName, totalCount: next.totalCount, rows: next.rows, cursor: next.cursor,
		});
		if (next.cursor === cursor) throw new Error('Photo query continuation did not advance.');
		cursor = next.cursor; await yieldTask(signal);
	}
}
async function yieldTask(signal: AbortSignal): Promise<void> {
	await new Promise<void>(resolve => { setTimeout(resolve, 0); }); signal.throwIfAborted();
}
function errorCode(value: unknown): unknown {
	try { return value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'code')?.value as unknown : undefined; }
	catch { return undefined; }
}
