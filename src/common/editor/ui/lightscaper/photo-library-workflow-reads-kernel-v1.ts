/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, type RefObject } from 'react';
import { acquirePhotoLibraryWorkflowSlotV2, loadPhotoLibraryDevelopProxyV2,
	type PhotoLibraryWorkflowSlotV2 } from '../../controller/shared/photo-library-workflow-slot-v2.ts';
import { capturePhotoLibraryDevelopOriginalPortV1, capturePhotoLibraryDevelopPortV2 } from './photo-library-workflow-develop.ts';
import type { CreatePhotoLibrarySessionV3, PhotoLibrarySessionPortV2, ReadPhotoExportSidecar, PhotoLibraryExportJournalPort } from '../../photo-library-session-port-v2.ts';
import type { PhotoLibraryPreviewTierV1 } from '../../photo-library-session-port-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../../photo-library-develop-original-port-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2, LoadPhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { ReadPhotoExportMetadata } from '../../../../lightscaper/controller/photo-raster-export.ts';
import type { PhotoLibraryExportPresetsPortV1 } from '../../photo-library-export-presets-port-v1.ts';
import type { PreparePhotoFramescaperHandoffSelectedV1, PreparePhotoFramescaperHandoffCurrentV1 } from '../../../../lightscaper/controller/photo-framescaper-handoff-download-current-v1.ts';
import type { PreparePhotoFramescaperHandoff } from '../../../../lightscaper/controller/photo-framescaper-handoff-download.ts';
import type { PhotoLibraryImageHandoffPortV1 } from '../../photo-library-image-handoff-port-v1.ts';
import { acquirePhotoLibraryWorkflowSlotCurrentV1, loadPhotoLibraryDevelopProxyCurrentV1, type PhotoLibraryWorkflowSlotCurrentV1 } from '../../controller/shared/photo-library-workflow-slot-current-v1.ts';
import type { CreatePhotoLibrarySessionCurrentV1, PhotoLibrarySessionPortCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV3, LoadPhotoLibraryDevelopProxyRuntimeV3 } from '../../photo-library-develop-proxy-port-v3.ts';
import { capturePhotoLibraryDevelopPortV3 } from './photo-library-workflow-develop-current-v1.ts';
import { capturePhotoLibraryLegacyDevelopCurrentV1 } from './photo-library-workflow-legacy-develop-current-v1.ts';
import { preparePhotoLibraryImageHandoffCurrentV1 } from './photo-library-workflow-image-handoff-current-v1.ts';

type SessionSlot = PhotoLibraryWorkflowSlotV2 | PhotoLibraryWorkflowSlotCurrentV1;
interface ReadLoaderOwners {
	readonly loader: RefObject<LoadPhotoLibraryBackupSaveRuntimeV1 | undefined>;
	readonly loadBackupSaveRuntime: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined;
}
export interface PhotoLibraryWorkflowReadOwnersKernelV1 extends ReadLoaderOwners {
	readonly slot: RefObject<SessionSlot | null>;
	readonly factory: RefObject<CreatePhotoLibrarySessionV3 | CreatePhotoLibrarySessionCurrentV1 | undefined>;
	readonly renderer: RefObject<CreatePhotoLibraryDevelopProxyRuntimeV2 | CreatePhotoLibraryDevelopProxyRuntimeV3 | undefined>;
	readonly createSession: CreatePhotoLibrarySessionV3 | CreatePhotoLibrarySessionCurrentV1 | undefined;
	readonly createDevelopProxyRuntime: CreatePhotoLibraryDevelopProxyRuntimeV2 | CreatePhotoLibraryDevelopProxyRuntimeV3 | undefined;
}
export interface PhotoLibraryWorkflowReadOwnersLegacyV2 extends ReadLoaderOwners {
	readonly slot: RefObject<PhotoLibraryWorkflowSlotV2 | null>;
	readonly factory: RefObject<CreatePhotoLibrarySessionV3 | undefined>;
	readonly renderer: RefObject<CreatePhotoLibraryDevelopProxyRuntimeV2 | undefined>;
	readonly createSession: CreatePhotoLibrarySessionV3 | undefined;
	readonly createDevelopProxyRuntime: CreatePhotoLibraryDevelopProxyRuntimeV2 | undefined;
}
export interface PhotoLibraryWorkflowReadOwnersCurrentV1 extends ReadLoaderOwners {
	readonly slot: RefObject<PhotoLibraryWorkflowSlotCurrentV1 | null>;
	readonly factory: RefObject<CreatePhotoLibrarySessionCurrentV1 | undefined>;
	readonly renderer: RefObject<CreatePhotoLibraryDevelopProxyRuntimeV3 | undefined>;
	readonly createSession: CreatePhotoLibrarySessionCurrentV1 | undefined;
	readonly createDevelopProxyRuntime: CreatePhotoLibraryDevelopProxyRuntimeV3 | undefined;
}
const nativeCheck = AbortSignal.prototype.throwIfAborted;
const check = (signal: AbortSignal) => { Reflect.apply(nativeCheck, signal, []); };

function acquire(profile: 'legacy2' | 'current3', current: SessionSlot) {
	return profile === 'current3' ? acquirePhotoLibraryWorkflowSlotCurrentV1(current as PhotoLibraryWorkflowSlotCurrentV1) : acquirePhotoLibraryWorkflowSlotV2(current as PhotoLibraryWorkflowSlotV2);
}
function legacy(profile: 'legacy2' | 'current3', owner: PhotoLibrarySessionPortV2 | PhotoLibrarySessionPortCurrentV1, signal: AbortSignal) {
	return profile === 'current3' ? capturePhotoLibraryLegacyDevelopCurrentV1(owner as PhotoLibrarySessionPortCurrentV1, signal) : capturePhotoLibraryDevelopPortV2((owner as PhotoLibrarySessionPortV2).develop, signal);
}
async function admitCurrent(profile: 'legacy2' | 'current3', owner: PhotoLibrarySessionPortV2 | PhotoLibrarySessionPortCurrentV1, photoId: string, signal: AbortSignal) {
	if (profile !== 'current3') return null;
	return capturePhotoLibraryDevelopPortV3((owner as PhotoLibrarySessionPortCurrentV1).develop, signal).read({ schemaVersion: 3, photoId }, { signal });
}

/** Nonmutating reads borrow the existing selected generation, without a second action queue. */
function useReads(profile: 'legacy2' | 'current3', { slot, factory, loader, renderer, createSession, loadBackupSaveRuntime, createDevelopProxyRuntime }: PhotoLibraryWorkflowReadOwnersKernelV1) {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unknown selected photo read profile.');
	const readPreview = useCallback(async (photoId: string, tier: PhotoLibraryPreviewTierV1,
		options: Readonly<{ signal?: AbortSignal }> = {}) => {
		const current = slot.current;
		if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession || current.factory !== factory.current
			|| current.backupLoader !== loadBackupSaveRuntime || current.backupLoader !== loader.current || current.proxyFactory !== renderer.current) {
			throw new DOMException('Photo preview generation is closed.', 'AbortError');
		}
		const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
		check(signal);
		const owner = await acquire(profile, current); check(signal);
		const result = await owner.readPreview(photoId, tier, { signal }); check(signal);
		return result;
	}, [profile, createSession, createDevelopProxyRuntime, loadBackupSaveRuntime]);
	const withOriginalFrame = useCallback<PhotoLibraryDevelopOriginalPortV1['withFrame']>(async (request, consume, options = {}) => {
		const current = slot.current;
		if (!current?.live || current.proxyFactory !== createDevelopProxyRuntime || current.proxyFactory !== renderer.current || current.factory !== createSession || current.factory !== factory.current
			|| current.backupLoader !== loadBackupSaveRuntime || current.backupLoader !== loader.current || current.proxyFactory !== renderer.current) throw new DOMException('Photo original generation is closed.', 'AbortError');
		const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
		check(signal); const owner = await acquire(profile, current); check(signal);
		const original = owner.develop.original;
		if (!original) throw new Error('Full-resolution development is unavailable.');
		const captured = capturePhotoLibraryDevelopOriginalPortV1(original); check(signal);
		return captured.withFrame(request, consume, { signal });
	}, [profile, createSession, createDevelopProxyRuntime, loadBackupSaveRuntime]);


	const loadDevelopProxyRuntime = useCallback<LoadPhotoLibraryDevelopProxyRuntimeV2 | LoadPhotoLibraryDevelopProxyRuntimeV3>(() => {
		const current = slot.current;
		if (!current?.live || current.factory !== createSession || current.proxyFactory !== createDevelopProxyRuntime
			|| current.factory !== factory.current || current.proxyFactory !== renderer.current) return Promise.reject(new DOMException('Photo renderer generation is closed.', 'AbortError'));
		return profile === 'current3' ? loadPhotoLibraryDevelopProxyCurrentV1(current as PhotoLibraryWorkflowSlotCurrentV1) : loadPhotoLibraryDevelopProxyV2(current as PhotoLibraryWorkflowSlotV2);
	}, [profile, createSession, createDevelopProxyRuntime]);
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
		checked(); const owner = await acquire(profile, current); checked();
		const metadataRead = owner.readMetadata;
		const currentSnapshot = await admitCurrent(profile, owner, photoId, signal); checked();
		if (typeof metadataRead !== 'function') throw new TypeError('Photo metadata reader is unavailable.');
		const snapshot = await Reflect.apply(metadataRead, owner, [photoId, { signal }]) as Awaited<ReturnType<typeof metadataRead>>; checked();
		const selected = profile === 'current3'
			? await capturePhotoLibraryDevelopPortV3((owner as PhotoLibrarySessionPortCurrentV1).develop, signal).read({ schemaVersion: 3, photoId }, { signal })
			: await legacy(profile, owner, signal).read({ schemaVersion: 2, photoId }, { signal }); checked();
		if (snapshot.photoId !== photoId || selected.photoId !== photoId || selected.schemaVersion !== (profile === 'current3' ? 3 : 2)
			|| snapshot.revision !== expectedRevision || selected.revision !== expectedRevision) throw new Error('Photo metadata revision or identity changed.');
		if (currentSnapshot && (currentSnapshot.photoId !== selected.photoId || currentSnapshot.revision !== selected.revision || currentSnapshot.versionId !== selected.versionId)) throw new Error('Current photo selection changed.');
		return Object.freeze({ catalogId: selected.catalogId, snapshot });
	}, [profile, createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, slot, factory, loader, renderer]);
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
			checked(); const owner = await acquire(profile, current); checked();
			if (!capturedRead) {
				const read = profile === 'current3' ? (owner as PhotoLibrarySessionPortCurrentV1).readExportSidecarCurrent : owner.readExportSidecar;
				if (typeof read !== 'function') throw new TypeError('Photo sidecar reader is unavailable.');
				capturedRead = profile === 'current3' ? (request, options) => Reflect.apply(read, owner, [request, options]) as Promise<string>
					: Reflect.apply(Function.prototype.bind, read, [owner]) as ReadPhotoExportSidecar;
			}
			const result = await capturedRead(request, { signal }); checked(); return result;
		};
	}, [profile, createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, slot, factory, loader, renderer]);
	const captureExportJournalOpener = useCallback((): PhotoLibraryExportJournalPort['open'] => {
		const current = slot.current;
		const isCurrent = () => current?.live && slot.current === current && current.factory === createSession && current.factory === factory.current
			&& current.proxyFactory === createDevelopProxyRuntime && current.proxyFactory === renderer.current && current.backupLoader === loadBackupSaveRuntime && current.backupLoader === loader.current;
		return async (options = {}) => {
			if (!current || !isCurrent()) throw new DOMException('Photo export journal generation is closed.', 'AbortError');
			const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
			check(signal); const owner = await acquire(profile, current); check(signal);
			const journal = profile === 'current3' ? (owner as PhotoLibrarySessionPortCurrentV1).exportJournalCurrent : owner.exportJournal;
			if (!isCurrent() || !journal) throw new Error('Photo export journal is unavailable.');
			const open = journal.open;
			if (typeof open !== 'function') throw new TypeError('Photo export journal opener is unavailable.');
			const access = await Reflect.apply(open, journal, [{ signal }]) as Awaited<ReturnType<PhotoLibraryExportJournalPort['open']>>; check(signal);
			if (!isCurrent()) throw new DOMException('Photo export journal generation is closed.', 'AbortError'); return access;
		};
	}, [profile, createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, slot, factory, loader, renderer]);
	const captureExportPresetsOpener = useCallback((): PhotoLibraryExportPresetsPortV1['open'] => {
		const current = slot.current;
		const isCurrent = () => current?.live && slot.current === current && current.factory === createSession && current.factory === factory.current
			&& current.proxyFactory === createDevelopProxyRuntime && current.proxyFactory === renderer.current && current.backupLoader === loadBackupSaveRuntime && current.backupLoader === loader.current;
		return async (options = {}) => {
			if (!current || !isCurrent()) throw new DOMException('Photo export preset generation is closed.', 'AbortError');
			const signal = options.signal ? AbortSignal.any([options.signal, current.lifetime.signal]) : current.lifetime.signal;
			check(signal); const owner = await acquire(profile, current); check(signal);
			if (!isCurrent() || !owner.exportPresets) throw new Error('Photo export presets are unavailable.');
			const access = await owner.exportPresets.open({ signal }); check(signal);
			if (!isCurrent()) throw new DOMException('Photo export preset generation is closed.', 'AbortError'); return access;
		};
	}, [profile, createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, slot, factory, loader, renderer]);
	const captureImageHandoff = useCallback((): PreparePhotoFramescaperHandoffSelectedV1 => {
		const current = slot.current;
		const isCurrent = () => current?.live && slot.current === current && current.factory === createSession && current.factory === factory.current
			&& current.proxyFactory === createDevelopProxyRuntime && current.proxyFactory === renderer.current && current.backupLoader === loadBackupSaveRuntime && current.backupLoader === loader.current;
		return async (photoId, externalSignal) => {
			if (!current || !isCurrent()) throw new DOMException('Photo handoff generation is closed.', 'AbortError');
			const signal = AbortSignal.any([externalSignal, current.lifetime.signal]);
			const checked = () => { check(signal); if (!isCurrent()) throw new DOMException('Photo handoff generation is closed.', 'AbortError'); };
			checked(); const owner = await acquire(profile, current); checked();
			if (profile === 'current3') return preparePhotoLibraryImageHandoffCurrentV1(owner as PhotoLibrarySessionPortCurrentV1, photoId, signal, checked);
			const develop = legacy(profile, owner, signal), handoff = owner.imageHandoff;
			const currentSnapshot = await admitCurrent(profile, owner, photoId, signal); checked();
			if (!handoff || typeof handoff.withCapture !== 'function') throw new Error('Editable photo handoff is unavailable.');
			const method = handoff.withCapture;
			const snapshot = await develop.read({ schemaVersion: 2, photoId }, { signal }); checked();
			if (currentSnapshot && (currentSnapshot.photoId !== snapshot.photoId || currentSnapshot.revision !== snapshot.revision || currentSnapshot.versionId !== snapshot.versionId)) throw new Error('Current photo selection changed.');
			if (snapshot.photoId !== photoId || snapshot.versionId !== snapshot.activeVersionId) throw new Error('The active photo selection changed.');
			const binding = Object.freeze({ catalogId: snapshot.catalogId, photoId, versionId: snapshot.activeVersionId, expectedRevision: snapshot.revision });
			const checkCurrent = async (caller: AbortSignal) => {
				check(caller); checked(); const currentLatest = await admitCurrent(profile, owner, photoId, signal); checked(); const latest = await develop.read({ schemaVersion: 2, photoId }, { signal: AbortSignal.any([caller, signal]) }); checked(); check(caller);
				if (currentLatest && (currentLatest.photoId !== latest.photoId || currentLatest.revision !== latest.revision || currentLatest.versionId !== latest.versionId)) throw new Error('Current saved photo changed.');
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
	}, [profile, createSession, createDevelopProxyRuntime, loadBackupSaveRuntime, slot, factory, loader, renderer]);
	return { readPreview, withOriginalFrame, loadDevelopProxyRuntime, readExportMetadata, captureExportSidecarReader, captureExportJournalOpener, captureExportPresetsOpener, captureImageHandoff };
}

export type PhotoLibraryWorkflowReadsLegacyV2 = Omit<ReturnType<typeof useReads>, 'loadDevelopProxyRuntime' | 'captureImageHandoff'> & {
	loadDevelopProxyRuntime: LoadPhotoLibraryDevelopProxyRuntimeV2; captureImageHandoff: () => PreparePhotoFramescaperHandoff;
};
export type PhotoLibraryWorkflowReadsCurrentV1 = Omit<ReturnType<typeof useReads>, 'loadDevelopProxyRuntime' | 'captureImageHandoff'> & {
	loadDevelopProxyRuntime: LoadPhotoLibraryDevelopProxyRuntimeV3; captureImageHandoff: () => PreparePhotoFramescaperHandoffCurrentV1;
};
export function usePhotoLibraryWorkflowReadsForProfileV1(profile: 'legacy2', owners: PhotoLibraryWorkflowReadOwnersLegacyV2): PhotoLibraryWorkflowReadsLegacyV2;
export function usePhotoLibraryWorkflowReadsForProfileV1(profile: 'current3', owners: PhotoLibraryWorkflowReadOwnersCurrentV1): PhotoLibraryWorkflowReadsCurrentV1;
export function usePhotoLibraryWorkflowReadsForProfileV1(profile: 'legacy2' | 'current3', owners: PhotoLibraryWorkflowReadOwnersKernelV1): PhotoLibraryWorkflowReadsLegacyV2 | PhotoLibraryWorkflowReadsCurrentV1 {
	return useReads(profile, owners) as PhotoLibraryWorkflowReadsLegacyV2 | PhotoLibraryWorkflowReadsCurrentV1;
}
