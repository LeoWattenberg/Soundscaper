/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, type RefObject } from 'react';
import { acquirePhotoLibraryWorkflowSlotV2 as acquire, loadPhotoLibraryDevelopProxyV2,
	type PhotoLibraryWorkflowSlotV2 as SessionSlot } from '../../controller/shared/photo-library-workflow-slot-v2.ts';
import { capturePhotoLibraryDevelopOriginalPortV1, capturePhotoLibraryDevelopPortV2 } from './photo-library-workflow-develop.ts';
import type { CreatePhotoLibrarySessionV3, ReadPhotoExportSidecar, PhotoLibraryExportJournalPort } from '../../photo-library-session-port-v2.ts';
import type { PhotoLibraryPreviewTierV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2, LoadPhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { ReadPhotoExportMetadata } from '../../../../lightscaper/controller/photo-raster-export.ts';
import type { PhotoLibraryExportPresetsPortV1 } from '../../photo-library-export-presets-port-v1.ts';
import type { PreparePhotoFramescaperHandoff } from '../../../../lightscaper/controller/photo-framescaper-handoff-download.ts';
import type { PhotoLibraryImageHandoffPortV1 } from '../../photo-library-image-handoff-port-v1.ts';

interface ReadOwners {
	readonly slot: RefObject<SessionSlot | null>;
	readonly factory: RefObject<CreatePhotoLibrarySessionV3 | undefined>;
	readonly loader: RefObject<LoadPhotoLibraryBackupSaveRuntimeV1 | undefined>;
	readonly renderer: RefObject<CreatePhotoLibraryDevelopProxyRuntimeV2 | undefined>;
	readonly createSession: CreatePhotoLibrarySessionV3 | undefined;
	readonly loadBackupSaveRuntime: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined;
	readonly createDevelopProxyRuntime: CreatePhotoLibraryDevelopProxyRuntimeV2 | undefined;
}
const nativeCheck = AbortSignal.prototype.throwIfAborted;
const check = (signal: AbortSignal) => { Reflect.apply(nativeCheck, signal, []); };

/** Nonmutating reads borrow the existing selected generation, without a second action queue. */
export function usePhotoLibraryWorkflowReads({ slot, factory, loader, renderer, createSession, loadBackupSaveRuntime, createDevelopProxyRuntime }: ReadOwners) {
	const readPreview = useCallback(async (photoId: string, tier: PhotoLibraryPreviewTierV1,
		options: Readonly<{ signal?: AbortSignal }> = {}) => {
		const current = slot.current;
		if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession || current.factory !== factory.current
			|| current.backupLoader !== loadBackupSaveRuntime || current.backupLoader !== loader.current || current.proxyFactory !== renderer.current) {
			throw new DOMException('Photo preview generation is closed.', 'AbortError');
		}
		const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
		check(signal);
		const owner = await acquire(current); check(signal);
		const result = await owner.readPreview(photoId, tier, { signal }); check(signal);
		return result;
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime]);
	const withOriginalFrame = useCallback<PhotoLibraryDevelopOriginalPortV1['withFrame']>(async (request, consume, options = {}) => {
		const current = slot.current;
		if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession || current.factory !== factory.current
			|| current.backupLoader !== loadBackupSaveRuntime || current.backupLoader !== loader.current || current.proxyFactory !== renderer.current) throw new DOMException('Photo original generation is closed.', 'AbortError');
		const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
		check(signal); const owner = await acquire(current); check(signal);
		const original = owner.develop.original;
		if (!original) throw new Error('Full-resolution development is unavailable.');
		const captured = capturePhotoLibraryDevelopOriginalPortV1(original); check(signal);
		return captured.withFrame(request, consume, { signal });
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime]);


	const loadDevelopProxyRuntime = useCallback<LoadPhotoLibraryDevelopProxyRuntimeV2>(() => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession || current.proxyFactory !== createDevelopProxyRuntime
			|| current.factory !== factory.current || current.proxyFactory !== renderer.current) return Promise.reject(new DOMException('Photo renderer generation is closed.', 'AbortError'));
		return loadPhotoLibraryDevelopProxyV2(current);
	}, [createSession, createDevelopProxyRuntime]);
	const readExportMetadata = useCallback<ReadPhotoExportMetadata>(async (photoId, expectedRevision, options) => {
		// A retired export must never acquire a new same-factory generation.
		check(options.signal);
		const current = slot.current;
		const isCurrent = () => current?.live && slot.current === current && current.factory === createSession && current.factory === factory.current
			&& current.proxyFactory === createDevelopProxyRuntime && current.proxyFactory === renderer.current
			&& current.backupLoader === loadBackupSaveRuntime && current.backupLoader === loader.current;
		if (!current || !isCurrent()) throw new DOMException('Photo metadata generation is closed.', 'AbortError');
		const signal = AbortSignal.any([options.signal, current.lifetime.signal]);
		const checked = () => { check(signal); if (!isCurrent()) throw new DOMException('Photo metadata generation is closed.', 'AbortError'); };
		checked(); const owner = await acquire(current); checked();
		const metadataRead = owner.readMetadata, develop = capturePhotoLibraryDevelopPortV2(owner.develop, signal);
		if (typeof metadataRead !== 'function') throw new TypeError('Photo metadata reader is unavailable.');
		const snapshot = await Reflect.apply(metadataRead, owner, [photoId, { signal }]) as Awaited<ReturnType<typeof metadataRead>>; checked();
		const selected = await develop.read({ schemaVersion: 2, photoId }, { signal }); checked();
		if (snapshot.photoId !== photoId || selected.photoId !== photoId || selected.schemaVersion !== 2
			|| snapshot.revision !== expectedRevision || selected.revision !== expectedRevision) throw new Error('Photo metadata revision or identity changed.');
		return Object.freeze({ catalogId: selected.catalogId, snapshot });
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, slot, factory, loader, renderer]);
	const captureExportSidecarReader = useCallback((): ReadPhotoExportSidecar => {
		// Capture the exact generation in the Save gesture, including future sidecar-only retries.
		const current = slot.current; let capturedRead: ReadPhotoExportSidecar | null = null;
		const isCurrent = () => current?.live && slot.current === current && current.factory === createSession && current.factory === factory.current
			&& current.proxyFactory === createDevelopProxyRuntime && current.proxyFactory === renderer.current
			&& current.backupLoader === loadBackupSaveRuntime && current.backupLoader === loader.current;
		return async (request, options) => {
			check(options.signal);
			if (!current || !isCurrent()) throw new DOMException('Photo sidecar generation is closed.', 'AbortError');
			const signal = AbortSignal.any([options.signal, current.lifetime.signal]);
			const checked = () => { check(signal); if (!isCurrent()) throw new DOMException('Photo sidecar generation is closed.', 'AbortError'); };
			checked(); const owner = await acquire(current); checked();
			if (!capturedRead) {
				const read = owner.readExportSidecar;
				if (typeof read !== 'function') throw new TypeError('Photo sidecar reader is unavailable.');
				capturedRead = Reflect.apply(Function.prototype.bind, read, [owner]) as ReadPhotoExportSidecar;
			}
			const result = await capturedRead(request, { signal }); checked(); return result;
		};
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, slot, factory, loader, renderer]);
	const captureExportJournalOpener = useCallback((): PhotoLibraryExportJournalPort['open'] => {
		const current = slot.current;
		const isCurrent = () => current?.live && slot.current === current && current.factory === createSession && current.factory === factory.current
			&& current.proxyFactory === createDevelopProxyRuntime && current.proxyFactory === renderer.current && current.backupLoader === loadBackupSaveRuntime && current.backupLoader === loader.current;
		return async (options = {}) => {
			if (!current || !isCurrent()) throw new DOMException('Photo export journal generation is closed.', 'AbortError');
			const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
			check(signal); const owner = await acquire(current); check(signal);
			if (!isCurrent() || !owner.exportJournal) throw new Error('Photo export journal is unavailable.');
			const access = await owner.exportJournal.open({ signal }); check(signal);
			if (!isCurrent()) throw new DOMException('Photo export journal generation is closed.', 'AbortError'); return access;
		};
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, slot, factory, loader, renderer]);
	const captureExportPresetsOpener = useCallback((): PhotoLibraryExportPresetsPortV1['open'] => {
		const current = slot.current;
		const isCurrent = () => current?.live && slot.current === current && current.factory === createSession && current.factory === factory.current
			&& current.proxyFactory === createDevelopProxyRuntime && current.proxyFactory === renderer.current && current.backupLoader === loadBackupSaveRuntime && current.backupLoader === loader.current;
		return async (options = {}) => {
			if (!current || !isCurrent()) throw new DOMException('Photo export preset generation is closed.', 'AbortError');
			const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
			check(signal); const owner = await acquire(current); check(signal);
			if (!isCurrent() || !owner.exportPresets) throw new Error('Photo export presets are unavailable.');
			const access = await owner.exportPresets.open({ signal }); check(signal);
			if (!isCurrent()) throw new DOMException('Photo export preset generation is closed.', 'AbortError'); return access;
		};
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, slot, factory, loader, renderer]);
	const captureImageHandoff = useCallback((): PreparePhotoFramescaperHandoff => {
		const current = slot.current;
		const isCurrent = () => current?.live && slot.current === current && current.factory === createSession && current.factory === factory.current
			&& current.proxyFactory === createDevelopProxyRuntime && current.proxyFactory === renderer.current && current.backupLoader === loadBackupSaveRuntime && current.backupLoader === loader.current;
		return async (photoId, externalSignal) => {
			if (!current || !isCurrent()) throw new DOMException('Photo handoff generation is closed.', 'AbortError');
			const signal = AbortSignal.any([externalSignal, current.lifetime.signal]);
			const checked = () => { check(signal); if (!isCurrent()) throw new DOMException('Photo handoff generation is closed.', 'AbortError'); };
			checked(); const owner = await acquire(current); checked();
			const develop = capturePhotoLibraryDevelopPortV2(owner.develop, signal), handoff = owner.imageHandoff;
			if (!handoff || typeof handoff.withCapture !== 'function') throw new Error('Editable photo handoff is unavailable.');
			const method = handoff.withCapture;
			const snapshot = await develop.read({ schemaVersion: 2, photoId }, { signal }); checked();
			if (snapshot.photoId !== photoId || snapshot.versionId !== snapshot.activeVersionId) throw new Error('The active photo selection changed.');
			const binding = Object.freeze({ catalogId: snapshot.catalogId, photoId, versionId: snapshot.activeVersionId, expectedRevision: snapshot.revision });
			const checkCurrent = async (caller: AbortSignal) => {
				check(caller); checked(); const latest = await develop.read({ schemaVersion: 2, photoId }, { signal: AbortSignal.any([caller, signal]) }); checked(); check(caller);
				if (latest.catalogId !== binding.catalogId || latest.photoId !== binding.photoId || latest.activeVersionId !== binding.versionId
					|| latest.versionId !== binding.versionId || latest.revision !== binding.expectedRevision) throw new Error('The active saved photo changed.');
			};
			const capture: PhotoLibraryImageHandoffPortV1 = { async withCapture(request, consume, options = {}) {
				checked(); const joined = options.signal ? AbortSignal.any([options.signal, signal]) : signal;
				const result = await Reflect.apply(method, handoff, [request, consume, { signal: joined }]) as Awaited<ReturnType<typeof consume>>;
				checked(); check(joined); return result;
			} };
			return Object.freeze({ binding, capture: Object.freeze(capture), checkCurrent });
		};
	}, [createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, slot, factory, loader, renderer]);
	return { readPreview, withOriginalFrame, loadDevelopProxyRuntime, readExportMetadata, captureExportSidecarReader, captureExportJournalOpener, captureExportPresetsOpener, captureImageHandoff };
}
