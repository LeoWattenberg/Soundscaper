/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PhotoExportDestinations } from '../../../../lightscaper/controller/photo-export-destinations.ts';
import { usePhotoLibraryWorkflowReads } from './photo-library-workflow-reads.ts';
import { message, errorCode } from './photo-library-workflow-diagnostics.ts';
import { acquirePhotoLibraryWorkflowSlotV2 as acquire, retirePhotoLibraryWorkflowSlotV2,
	type PhotoLibraryWorkflowSlotV2 as SessionSlot } from '../../controller/shared/photo-library-workflow-slot-v2.ts';
import { joinPhotoLibraryRetirementV1, type PhotoLibraryBackupSaveRuntimeV1, type LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import { PhotoLibraryBackupSaveV1, type PhotoLibraryBackupSaveRequestV1,
	type PhotoLibraryBackupSaveReceiptV1 } from '../../controller/shared/photo-library-backup-save-v1.ts';
import { PhotoLibraryOriginalRecoveryV1 } from '../../controller/shared/photo-library-original-recovery-v1.ts';
import { DEFAULT_PHOTO_LIBRARY_QUERY_V2 as DEFAULT_QUERY, isMetadataQuery, readNonemptyQueryPage,
	readQueryStep, readVisiblePage, yieldTask } from '../../controller/shared/photo-library-query-navigation.ts';
import { usePhotoOriginalRecovery, type ExecutePhotoOriginalRecoveryV1 } from './use-photo-original-recovery.ts';
import type { ExecutePhotoStackV1 } from './use-photo-stacks.ts';
import type { ExecutePhotoSavedFiltersV1 } from './use-photo-saved-filters.ts';
import { capturePhotoLibraryDevelopPortV2, type ExecutePhotoDevelopCurrent } from './photo-library-workflow-develop.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { PhotoLibraryCubeLutPortV1 } from '../../photo-library-cube-lut-port-v1.ts';
import type { PhotoLibraryCullReceiptV1 } from '../../controller/shared/photo-library-culling-v1.ts';
import type { PhotoLibraryBatchRenamePlanV1, PhotoLibraryBatchRenameReceiptV1, PhotoLibraryBatchRenameRequestV1,
	PhotoLibraryBatchRenameSnapshotV1, PhotoLibraryBatchRenameUndoV1 } from '../../photo-library-batch-rename-port-v1.ts';
import { readPhotoLibrarySelectionIdsV1 } from '../../controller/shared/photo-library-selection-v1.ts';
import { detachPhotoLibraryImportGestureV2, executePhotoLibraryImportGestureV2, type PhotoLibraryImportGestureOptionsV2 } from './photo-library-workflow-import-v2.ts';
import type { PhotoLibraryQueryV2, PhotoLibraryQueryBuildProgressV2 } from '../../photo-library-query-port-v2.ts';
import type { PhotoLibraryImportGestureReceiptV1, PhotoLibraryImportPresetCommandV1, PhotoLibraryImportPresetSnapshotV1 } from '../../photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryDefinitionAcknowledgementV1, PhotoLibraryDefinitionCommandV1, PhotoLibraryDefinitionReadRequestV1,
	PhotoLibraryMembershipPatchV1, PhotoLibraryMembershipSnapshotV1 } from '../../photo-library-organization-port-v1.ts';
import type { PhotoLibraryAttributePatchV1, PhotoLibraryImportItemV1, PhotoLibraryMetadataPatchV1, PhotoLibraryMetadataSnapshotV1, PhotoLibraryDefinitionPageRequestV1, PhotoLibraryQueryBuildProgressV1, PhotoLibraryQueryV1, PhotoLibraryPageV1, PhotoLibraryRowV1 } from '../../photo-library-session-port-v1.ts';

export { DEFAULT_PHOTO_LIBRARY_QUERY_V1, DEFAULT_PHOTO_LIBRARY_QUERY_V2 } from '../../controller/shared/photo-library-query-navigation.ts';

import type { CreatePhotoLibrarySessionV3, PhotoLibrarySessionPortV2 } from '../../photo-library-session-port-v2.ts';

type SessionAction = (owner: PhotoLibrarySessionPortV2, signal: AbortSignal, current: SessionSlot) => Promise<void>;
type WorkflowAction = SessionAction
	| Readonly<{ start: (signal: AbortSignal, current: SessionSlot) => Promise<void> }>;
export type { PhotoLibraryBackupSaveRuntimeV1, LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
type ActionStatus = 'completed' | 'failed' | 'cancelled' | 'busy';
export type PhotoLibraryBatchRenameWorkflowReceiptV1 =
	| Readonly<{ outcome: 'acknowledged'; receipt: PhotoLibraryBatchRenameReceiptV1; notice: 'refresh-failed' | null }>
	| Readonly<{ outcome: 'failed' | 'busy' | 'cancelled' }>;
const nativeCheck = AbortSignal.prototype.throwIfAborted;
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const check = (signal: AbortSignal) => { Reflect.apply(nativeCheck, signal, []); };

/** The effect owns one resource generation, including factories resolving after cleanup. */
export function usePhotoLibraryWorkflowV2(createSession?: CreatePhotoLibrarySessionV3, loadBackupSaveRuntime?: LoadPhotoLibraryBackupSaveRuntimeV1,
	createDevelopProxyRuntime?: CreatePhotoLibraryDevelopProxyRuntimeV2) {
	const factory = useRef(createSession); factory.current = createSession;
	const loader = useRef(loadBackupSaveRuntime); loader.current = loadBackupSaveRuntime;
	const renderer = useRef(createDevelopProxyRuntime); renderer.current = createDevelopProxyRuntime;
	const backupSave = useRef<PhotoLibraryBackupSaveV1 | null>(null);
	backupSave.current ??= new PhotoLibraryBackupSaveV1();
	const controller = backupSave.current;
	const recoveryOwner = useRef<PhotoLibraryOriginalRecoveryV1 | null>(null);
	recoveryOwner.current ??= new PhotoLibraryOriginalRecoveryV1();
	const originalRecovery = recoveryOwner.current;
	const exportDestinations = useRef(new WeakMap<SessionSlot, PhotoExportDestinations>());
	const recoveryGeneration = useMemo(() => Object.freeze({ createSession, loadBackupSaveRuntime, createDevelopProxyRuntime }), [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime]);
	const slot = useRef<SessionSlot | null>(null);
	const retiring = useRef<Promise<void> | null>(null);
	const [page, setPage] = useState<PhotoLibraryPageV1 | null>(null);
	const [receipts, setReceipts] = useState<readonly PhotoLibraryImportItemV1[]>([]);
	const [importReceipt, setImportReceipt] = useState<PhotoLibraryImportGestureReceiptV1 | null>(null);
	const [metadata, setMetadata] = useState<PhotoLibraryMetadataSnapshotV1 | null>(null);
	const [memberships, setMemberships] = useState<PhotoLibraryMembershipSnapshotV1 | null>(null);
	const [busy, setBusy] = useState(false);
	const [query, setQuery] = useState<PhotoLibraryQueryV1 | PhotoLibraryQueryV2 | null>(null);
	const [savedCollectionId, setSavedCollectionId] = useState<string | null>(null);
	const [queryIdentity, setQueryIdentity] = useState<PhotoLibraryQueryV1 | PhotoLibraryQueryV2 | Readonly<{ collectionId: string }> | null>(null);
	const [stackCollapsed, setStackCollapsedState] = useState(false);
	const [needsQueryIndex, setNeedsQueryIndex] = useState(false);
	const [queryIndexProgress, setQueryIndexProgress] = useState<PhotoLibraryQueryBuildProgressV1 | PhotoLibraryQueryBuildProgressV2 | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [batchRenameSnapshot, setBatchRenameSnapshot] = useState<PhotoLibraryBatchRenameSnapshotV1 | null>(null);
	const [batchRenameReceipt, setBatchRenameReceipt] = useState<Extract<PhotoLibraryBatchRenameWorkflowReceiptV1, { outcome: 'acknowledged' }> | null>(null);
	const [batchRenameUndo, setBatchRenameUndo] = useState<PhotoLibraryBatchRenameUndoV1 | null>(null);
	const [backupRuntime, setBackupRuntime] = useState<PhotoLibraryBackupSaveRuntimeV1 | null>(null);
	const [backupReceipt, setBackupReceipt] = useState<PhotoLibraryBackupSaveReceiptV1 | null>(null);
	const retireAndJoin = useCallback((presentation: Promise<void> | null = null): Promise<void> => {
		const current = slot.current;
		if (!current) return retiring.current ?? Promise.resolve();
		const closing = retirePhotoLibraryWorkflowSlotV2(current, () => joinPhotoLibraryRetirementV1([controller.cancelAndJoin(), originalRecovery.cancelAndJoin(), exportDestinations.current.get(current)?.retireAndJoin() ?? null, presentation]));
		retiring.current = closing; return closing;
	}, [controller, originalRecovery]);
	const registerExportDestination = useCallback((cancelAndJoin: () => Promise<void>): (() => void) => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession || current.factory !== factory.current
			|| current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current
			|| current.backupLoader !== loadBackupSaveRuntime || current.backupLoader !== loader.current) throw new DOMException('Photo export generation is closed.', 'AbortError');
		const destinations = exportDestinations.current.get(current);
		if (!destinations) throw new DOMException('Photo export generation is closed.', 'AbortError');
		return destinations.register(cancelAndJoin);
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime]);
	const publishPage = useCallback((current: SessionSlot, next: PhotoLibraryPageV1 | null) => {
		if (!current.live) return null;
		current.page = next; setPage(next); return next;
	}, []);
	useEffect(() => {
		const current: SessionSlot = { live: true, factory: createSession, proxyFactory: createDevelopProxyRuntime, proxyPending: null, closeOwner: null, backupLoader: loadBackupSaveRuntime, lifetime: new AbortController(),
			beforeDrain: retiring.current, pending: null, active: null, query: null, savedCollectionId: null, stackCollapsed: false, page: null, batchRenamePlanner: null, backupRuntime: null, backupLoading: null, retirement: null };
		exportDestinations.current.set(current, new PhotoExportDestinations()); slot.current = current;
		queueMicrotask(() => {
			if (!current.live) return;
			setQuery(null); setSavedCollectionId(null); setQueryIdentity(null); setStackCollapsedState(false); setNeedsQueryIndex(false); setQueryIndexProgress(null);
			publishPage(current, null); setMetadata(null); setMemberships(null); setReceipts([]); setImportReceipt(null); setError(null); setBusy(current.active !== null || controller.isPending() || originalRecovery.isPending());
			setBatchRenameSnapshot(null); setBatchRenameReceipt(null); setBatchRenameUndo(null);
			setBackupRuntime(null); setBackupReceipt(null);
		});
		return () => {
			const closing = retirePhotoLibraryWorkflowSlotV2(current, () => joinPhotoLibraryRetirementV1([controller.cancelAndJoin(), originalRecovery.cancelAndJoin(), exportDestinations.current.get(current)?.retireAndJoin() ?? null]));
			if (slot.current === current) slot.current = null;
			retiring.current = closing;
			void closing.catch(() => undefined);
		};
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, publishPage, controller, originalRecovery]);

	const perform = useCallback(async (action: WorkflowAction, externalSignal?: AbortSignal): Promise<ActionStatus> => {
		const current = slot.current;
		if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession || current.factory !== factory.current
			|| current.backupLoader !== loadBackupSaveRuntime || current.backupLoader !== loader.current || current.proxyFactory !== renderer.current) return 'cancelled';
		if (current.active || controller.isPending() || originalRecovery.isPending()) return 'busy';
		const active = new AbortController(); current.active = active;
		const signal = AbortSignal.any([active.signal, current.lifetime.signal, ...(externalSignal ? [externalSignal] : [])]);
		setBusy(true); setError(null);
		try {
			check(signal);
			if (typeof action === 'function') {
				const owner = await acquire(current);
				check(signal); await action(owner, signal, current);
			} else await action.start(signal, current);
			return 'completed';
		} catch (failure) {
			// The destination owner can fail cleanup after cancellation. Its error is
			// distinct from the exact cancellation reason and must remain visible.
			const cancelled = Reflect.apply(nativeAborted, signal, []) === true && Object.is(failure, Reflect.apply(nativeReason, signal, []));
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
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, controller, originalRecovery]);
	const executeOriginalRecovery = useCallback<ExecutePhotoOriginalRecoveryV1>(async action => perform({ start: async (signal, current) => {
		await action({ signal, acquire: () => acquire(current),
			isCurrent: () => current.live && slot.current === current && current.factory === factory.current && current.backupLoader === loader.current && current.proxyFactory === renderer.current,
			refresh: async () => {
				const owner = await acquire(current); check(signal);
				const next = await readVisiblePage(owner, current, null, signal);
				check(signal); publishPage(current, next);
			} });
	} }), [perform, publishPage]);
	const executeStack = useCallback<ExecutePhotoStackV1>((action, externalSignal) => perform({ start: async (signal, current) => {
		await action({ signal, acquire: () => acquire(current),
			isCurrent: () => current.live && slot.current === current && current.factory === factory.current && current.backupLoader === loader.current && current.proxyFactory === renderer.current,
			refresh: async () => {
				const owner = await acquire(current); check(signal);
				const next = await readVisiblePage(owner, current, null, signal);
				check(signal); return publishPage(current, next);
			} });
	} }, externalSignal), [perform, publishPage]);
	const executeSavedFilters = useCallback<ExecutePhotoSavedFiltersV1>((action, externalSignal) => perform({ start: async (signal, current) => {
		const isCurrent = () => current.live && slot.current === current && current.factory === factory.current && current.backupLoader === loader.current && current.proxyFactory === renderer.current;
		await action({ signal, acquire: () => acquire(current), isCurrent, selectedCollectionId: () => current.savedCollectionId,
			retireSavedSelection: id => {
				if (!isCurrent() || current.savedCollectionId !== id) return;
				setQueryIdentity(Object.freeze({ collectionId: id }));
				if (current.page) publishPage(current, Object.freeze({ ...current.page, cursor: null }));
			},
			refresh: async () => {
				const owner = await acquire(current); check(signal);
				const next = await readVisiblePage(owner, current, null, signal); check(signal);
				return isCurrent() ? publishPage(current, next) : null;
			}, activate: async selection => {
				const owner = await acquire(current); check(signal);
				if (!isCurrent()) return null;
				const id = selection.kind === 'saved' ? selection.collectionId : null;
				const next = await readVisiblePage(owner, { query: null, savedCollectionId: id, stackCollapsed: current.stackCollapsed }, null, signal);
				check(signal); if (!isCurrent()) return null;
				current.query = null; current.savedCollectionId = id; setQuery(null); setSavedCollectionId(id);
				setQueryIdentity(id === null ? null : Object.freeze({ collectionId: id })); setNeedsQueryIndex(false);
				return publishPage(current, next);
			} });
	} }, externalSignal), [perform, publishPage]);
	const executeDevelop = useCallback<ExecutePhotoDevelopCurrent>((action, externalSignal) => perform({ start: async (signal, current) => {
		await action({ signal, acquire: async () => {
			const owner = await acquire(current); check(signal);
			return capturePhotoLibraryDevelopPortV2(owner.develop, signal);
		}, isCurrent: () => current.live && slot.current === current && current.factory === factory.current && current.backupLoader === loader.current && current.proxyFactory === renderer.current,
		refresh: async () => {
			const owner = await acquire(current); check(signal);
			const next = await readVisiblePage(owner, current, null, signal); check(signal); return publishPage(current, next);
		} });
	} }, externalSignal), [perform, publishPage]);
	const originalWorkflow = usePhotoOriginalRecovery({ generation: recoveryGeneration, controller: originalRecovery, execute: executeOriginalRecovery });
	const run = useCallback(async (action: SessionAction): Promise<void> => { await perform(action); }, [perform]);
	const prepareBackupSave = useCallback((): Promise<void> => {
		const current = slot.current;
		if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession || current.factory !== factory.current
			|| current.backupLoader !== loadBackupSaveRuntime || current.backupLoader !== loader.current
			|| !loadBackupSaveRuntime || current.backupRuntime) return Promise.resolve();
		if (current.backupLoading) return current.backupLoading;
		setError(null);
		const pending = Promise.resolve().then(loadBackupSaveRuntime).then(runtime => {
			if (!current.live || current.factory !== factory.current || current.backupLoader !== loader.current || current.proxyFactory !== renderer.current) return;
			current.backupRuntime = runtime; setBackupRuntime(runtime);
		}).catch(failure => { if (current.live && current.factory === factory.current && current.backupLoader === loader.current && current.proxyFactory === renderer.current) setError(message(failure)); })
			.finally(() => { if (current.backupLoading === pending) current.backupLoading = null; });
		current.backupLoading = pending; return pending;
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime]);
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

	const { readPreview, withOriginalFrame, loadDevelopProxyRuntime, readExportMetadata } = usePhotoLibraryWorkflowReads({
		slot, factory, loader, renderer, createSession, loadBackupSaveRuntime, createDevelopProxyRuntime });
	const importCubeLut = useCallback<PhotoLibraryCubeLutPortV1['importFile']>(async (file, options = {}) => {
		const result: { receipt?: Awaited<ReturnType<PhotoLibraryCubeLutPortV1['importFile']>>; failure?: Readonly<{ value: unknown }> } = {};
		const caller = options.signal; if (caller) check(caller);
		const status = await perform(async (owner, signal) => {
			const port = owner.cubeLuts, write = port.importFile; check(signal);
			try { result.receipt = await Reflect.apply(write, port, [file, { signal }]) as Awaited<ReturnType<PhotoLibraryCubeLutPortV1['importFile']>>; }
			catch (failure) { result.failure = { value: failure }; throw failure; }
		}, caller);
		if (result.receipt) return result.receipt;
		if (result.failure) throw result.failure.value;
		if (status === 'cancelled') { if (caller) check(caller); throw new DOMException('LUT import was cancelled.', 'AbortError'); }
		throw new Error(status === 'busy' ? 'A photo library change is already pending.' : 'LUT import failed.');
	}, [perform]);

	const readPage = useCallback((cursor: string | null = null) => run(async (owner, signal, current) => {
		const next = await readVisiblePage(owner, current, cursor, signal);
		publishPage(current, next);
	}), [run, publishPage]);
	const setStackCollapsed = useCallback((collapsed: boolean): Promise<void> => run(async (owner, signal, current) => {
		const next = await readVisiblePage(owner, { ...current, stackCollapsed: collapsed }, null, signal); check(signal);
		if (current.live) { current.stackCollapsed = collapsed; setStackCollapsedState(collapsed);
			if (current.savedCollectionId !== null) setQueryIdentity(Object.freeze({ collectionId: current.savedCollectionId }));
			publishPage(current, next); }
	}), [run, publishPage]);
	const readBatchRenameSelection = useCallback(async (values: readonly string[], options: Readonly<{ signal?: AbortSignal }> = {}): Promise<void> => {
		const admission = slot.current;
		if (!admission?.live || admission.factory !== createSession || admission.factory !== factory.current || admission.proxyFactory !== createDevelopProxyRuntime
			|| admission.proxyFactory !== renderer.current || admission.active || controller.isPending() || originalRecovery.isPending()) return;
		let ids: readonly string[];
		try {
			ids = readPhotoLibrarySelectionIdsV1(values);
			if (ids.length === 0) throw new RangeError('Batch rename requires selected photos.');
		} catch (failure) { setError(message(failure)); return; }
		setBatchRenameSnapshot(null); setBatchRenameReceipt(null); admission.batchRenamePlanner = null;
		await perform(async (owner, signal, current) => {
			const next = await owner.readBatchRenameSelection(ids, { signal }); check(signal);
			if (current.live && current.factory === factory.current) {
				current.batchRenamePlanner = request => owner.planBatchRename(request); setBatchRenameSnapshot(next);
			}
		}, options.signal);
	}, [createSession, createDevelopProxyRuntime, perform, controller, originalRecovery]);
	const planBatchRename = useCallback((request: PhotoLibraryBatchRenameRequestV1): PhotoLibraryBatchRenamePlanV1 => {
		const current = slot.current;
		if (!current?.live || current.factory !== factory.current || !current.batchRenamePlanner) {
			throw new DOMException('Batch rename selection is unavailable.', 'AbortError');
		}
		return current.batchRenamePlanner(request);
	}, []);
	const runBatchRename = useCallback(async (save: (owner: PhotoLibrarySessionPortV2, signal: AbortSignal) => Promise<PhotoLibraryBatchRenameReceiptV1>,
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
			check(signal);
			const next = await readVisiblePage(owner, current, null, signal);
			check(signal);
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
	const applyQuery = (nextQuery: PhotoLibraryQueryV1 | PhotoLibraryQueryV2) => run(async (owner, signal, current) => {
		const next = await readNonemptyQueryPage(owner, nextQuery, null, signal, current.stackCollapsed);
		if (current.live) { current.query = nextQuery; current.savedCollectionId = null; setSavedCollectionId(null);
			setQuery(nextQuery); setQueryIdentity(nextQuery); setNeedsQueryIndex(false); publishPage(current, next); }
	});
	const probeQuery = () => run(async (owner, signal, current) => {
		await readQueryStep(owner, current.query ?? DEFAULT_QUERY, null, signal, current.stackCollapsed);
		check(signal); if (current.live) setNeedsQueryIndex(false);
	});
	const buildQueryIndex = () => run(async (owner, signal, current) => {
		let processed = 0, readBytes = 0, writtenBytes = 0;
		const v2 = isMetadataQuery(current.query ?? DEFAULT_QUERY);
		while (true) {
			check(signal);
			const next = v2 ? await owner.rebuildQueryStepV2({ signal }) : { ...await owner.rebuildQueryStep({ signal }), writtenBytes: 0 }; check(signal);
			processed += next.processed; readBytes += next.readBytes;
			writtenBytes += next.writtenBytes;
			if (current.live) setQueryIndexProgress(Object.freeze({ processed, readBytes, ...(v2 ? { writtenBytes } : {}), ready: next.ready }));
			if (next.ready) { if (current.live) setNeedsQueryIndex(false); return; }
			await yieldTask(signal);
		}
	});
	const readDefinitions = useCallback(async (request: PhotoLibraryDefinitionPageRequestV1) => {
		const current = slot.current;
		if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession) throw new DOMException('Definition page generation is closed.', 'AbortError');
		const signal = request.signal ? AbortSignal.any([request.signal, current.lifetime.signal]) : current.lifetime.signal;
		check(signal);
		const owner = await acquire(current); check(signal);
		const result = await owner.readDefinitionPage({ ...request, signal }); check(signal); return result;
	}, [createSession, createDevelopProxyRuntime]);
	const readDefinition = useCallback(async (request: PhotoLibraryDefinitionReadRequestV1) => {
		const current = slot.current;
		if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession) throw new DOMException('Definition generation is closed.', 'AbortError');
		const signal = request.signal ? AbortSignal.any([request.signal, current.lifetime.signal]) : current.lifetime.signal;
		check(signal);
		const owner = await acquire(current); check(signal);
		const result = await owner.readDefinition({ ...request, signal }); check(signal); return result;
	}, [createSession, createDevelopProxyRuntime]);

	const readImportPresets = useCallback(async (options: Readonly<{ signal?: AbortSignal }> = {}) => {
		const current = slot.current;
		if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession) throw new DOMException('Import preset generation is closed.', 'AbortError');
		const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
		check(signal); const owner = await acquire(current); check(signal);
		const result = await owner.readImportPresets({ signal }); check(signal); return result;
	}, [createSession, createDevelopProxyRuntime]);
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
	const readImportDevelopPresets = useCallback(async (options: Readonly<{ signal?: AbortSignal }> = {}) => {
		const current = slot.current;
		if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession) throw new DOMException('Import preset generation is closed.', 'AbortError');
		const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
		check(signal); const owner = await acquire(current); check(signal);
		const capability = owner.developImport;
		if (!capability) throw new Error('Develop preset import is unavailable.');
		const result = await capability.listPresets({ signal }); check(signal); return result;
	}, [createSession, createDevelopProxyRuntime]);
	const importFiles = useCallback(async (files: readonly File[], options: PhotoLibraryImportGestureOptionsV2 = {}): Promise<PhotoLibraryImportGestureReceiptV1> => {
		const admission = slot.current;
		if (!admission?.live || admission.factory !== createSession || admission.factory !== factory.current || admission.proxyFactory !== createDevelopProxyRuntime || admission.proxyFactory !== renderer.current) return Object.freeze({ outcome: 'cancelled' });
		if (admission.active || controller.isPending() || originalRecovery.isPending()) return Object.freeze({ outcome: 'busy' });
		// Capture authored state and original source names before the lazy factory can yield.
		let draft, caller: AbortSignal | undefined;
		try {
			draft = detachPhotoLibraryImportGestureV2(files, options, signal => { caller = signal; });
		} catch (failure) {
			const current = slot.current;
			if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession) return Object.freeze({ outcome: 'cancelled' });
			if (current.active) return Object.freeze({ outcome: 'busy' });
			if (caller && Reflect.apply(nativeAborted, caller, []) === true && Object.is(failure, Reflect.apply(nativeReason, caller, []))) return Object.freeze({ outcome: 'cancelled' });
			setError(message(failure)); return Object.freeze({ outcome: 'failed' });
		}
		const { collector } = draft;
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
			try {
				await executePhotoLibraryImportGestureV2(owner, draft, signal, publish);
				receipt = Object.freeze({ outcome: 'acknowledged', items: collector.snapshot(), completion: 'finished', notice: 'refresh-failed' });
			} catch (failure) {
				if (collector.hasAcknowledgement()) receipt = Object.freeze({ outcome: 'acknowledged', items: collector.snapshot(),
					completion: Reflect.apply(nativeAborted, signal, []) === true && Object.is(failure, Reflect.apply(nativeReason, signal, [])) ? 'cancelled' : 'failed', notice: 'refresh-failed' });
				publish(); throw failure;
			}
			publish(); check(signal);
			const next = await readVisiblePage(owner, current, null, signal);
			check(signal);
			if (publishPage(current, next)) receipt = Object.freeze({ outcome: 'acknowledged', items: collector.snapshot(), completion: 'finished', notice: null });
		}, draft.signal);
		if (publication.generation?.live && slot.current === publication.generation && publication.generation.factory === factory.current) setImportReceipt(receipt);
		return receipt ?? Object.freeze({ outcome: status === 'completed' ? 'failed' : status });
	}, [createSession, createDevelopProxyRuntime, perform, publishPage, controller, originalRecovery]);
	const refreshQuery = async (owner: PhotoLibrarySessionPortV2, signal: AbortSignal, current: SessionSlot) => {
		if (!current.query && !current.stackCollapsed && current.savedCollectionId === null) return current.live ? current.page : null;
		const next = await readVisiblePage(owner, current, null, signal);
		return publishPage(current, next);
	};
	const updateRow = (updated: PhotoLibraryRowV1, current: SessionSlot) => {
		const previous = current.page;
		return publishPage(current, previous ? Object.freeze({ ...previous, cursor: null,
			rows: Object.freeze(previous.rows.map(row => row.id === updated.id ? updated : row)) }) : null);
	};
	const editAttributes = async (save: (owner: PhotoLibrarySessionPortV2, signal: AbortSignal) => Promise<PhotoLibraryRowV1>,
		options: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryCullReceiptV1> => {
		let receipt: PhotoLibraryCullReceiptV1 | null = null;
		const status = await perform(async (owner, signal, current) => {
			const updated = await save(owner, signal);
			// The durable acknowledgement remains saved even if refresh or cancellation follows.
			receipt = Object.freeze({ outcome: 'saved', photoId: updated.id, page: null, notice: 'refresh-failed' });
			try {
				// A successful query publishes one final page; an intermediate page would
				// invalidate the culling observer's captured page identity while awaiting it.
				const next = current.query || current.stackCollapsed || current.savedCollectionId !== null ? await refreshQuery(owner, signal, current) : updateRow(updated, current);
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
	return { ...originalWorkflow, retireAndJoin, registerExportDestination, backupSaveRuntime: backupRuntime, importCubeLut, loadDevelopProxyRuntime, executeDevelop, executeStack, executeSavedFilters, savedCollectionId, queryIdentity, page, metadata, memberships, batchRenameSnapshot, batchRenameReceipt, batchRenameUndo,
		prepareBackupSave, saveBackup, backupReceipt, backupReady: backupRuntime !== null, maximumBackupStreamingBytes: backupRuntime?.maximumStreamingBytes ?? null,
		cancelBackup: () => { if (controller.isPending()) slot.current?.active?.abort(); },
		readBatchRenameSelection, planBatchRename, renamePhotos, undoBatchRename, readExportMetadata, readPreview, withOriginalFrame, query, stackCollapsed, setStackCollapsed, needsQueryIndex, queryIndexProgress, applyQuery, probeQuery, buildQueryIndex, readDefinitions,
		readDefinition, applyDefinition, readMemberships, applyMemberships, readImportPresets, readImportDevelopPresets, applyImportPreset, receipts, importReceipt, busy, error, readMetadata, applyMetadata, readPage, importFiles, setRating, applyAttributes,
		cancel: () => { slot.current?.active?.abort(); } };
}
