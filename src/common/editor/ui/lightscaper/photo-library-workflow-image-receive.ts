/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, type RefObject } from 'react';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import type { PhotoLibraryImageReceivePortV1, PhotoLibraryImageReceiveReceiptV1, PhotoLibraryImageReceiveRequestV1 } from '../../photo-library-image-receive-port-v1.ts';
import type { PhotoLibraryImageReceivePortV2, PhotoLibraryImageReceiveReceiptV2 } from '../../photo-library-image-receive-port-v2.ts';
import type { CreatePhotoLibrarySessionV3, PhotoLibrarySessionPortV2 } from '../../photo-library-session-port-v2.ts';
import type { PhotoLibraryWorkflowSlotCurrentV1 } from '../../controller/shared/photo-library-workflow-slot-current-v1.ts';
import type { CreatePhotoLibrarySessionCurrentV1, PhotoLibrarySessionPortCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV3 } from '../../photo-library-develop-proxy-port-v3.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2 } from '../../photo-library-develop-proxy-port-v2.ts';
import type { LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../controller/shared/photo-library-workflow-slot.ts';
import type { PhotoLibraryWorkflowSlotV2 } from '../../controller/shared/photo-library-workflow-slot-v2.ts';
import { readVisiblePage } from '../../controller/shared/photo-library-query-navigation.ts';
import type { PhotoLibraryPageV1 } from '../../photo-library-session-port-v1.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../../../../lightscaper/storage/photo-develop-preset-read-v2.ts';

export interface PhotoImageReceiveOutcome {
	readonly receipt: Readonly<PhotoLibraryImageReceiveReceiptV1 | PhotoLibraryImageReceiveReceiptV2>;
	readonly refresh: 'complete' | 'failed'; readonly failure?: unknown;
}
export interface CapturedPhotoImageReceive {
	/** Selects the explicit Current scalar inspector in the menu-owned dialog. */
	readonly schemaVersion?: 2;
	receive(request: Readonly<PhotoLibraryImageReceiveRequestV1 & { imageClipId?: string }>, signal: AbortSignal): Promise<Readonly<PhotoImageReceiveOutcome>>;
	reload(signal: AbortSignal): Promise<void>;
}
type SessionSlot = PhotoLibraryWorkflowSlotV2 | PhotoLibraryWorkflowSlotCurrentV1;
type SessionFactory = CreatePhotoLibrarySessionV3 | CreatePhotoLibrarySessionCurrentV1;
type RendererFactory = CreatePhotoLibraryDevelopProxyRuntimeV2 | CreatePhotoLibraryDevelopProxyRuntimeV3;
interface Owners {
	readonly slot: RefObject<SessionSlot | null>; readonly factory: RefObject<SessionFactory | undefined>;
	readonly loader: RefObject<LoadPhotoLibraryBackupSaveRuntimeV1 | undefined>; readonly renderer: RefObject<RendererFactory | undefined>;
	readonly createSession: SessionFactory | undefined; readonly loadBackupSaveRuntime: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined;
	readonly createDevelopProxyRuntime: RendererFactory | undefined;
	readonly perform: (action: (owner: Omit<PhotoLibrarySessionPortV2, 'develop'>, signal: AbortSignal, current: SessionSlot) => Promise<void>, signal?: AbortSignal) => Promise<'completed' | 'failed' | 'cancelled' | 'busy'>;
	readonly publishPage: (current: SessionSlot, page: PhotoLibraryPageV1 | null) => PhotoLibraryPageV1 | null;
}
const CHECK = AbortSignal.prototype.throwIfAborted, SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, SLICE = Blob.prototype.slice;
type PinnedNativeReceive = (request: Parameters<PhotoLibraryImageReceivePortV1['receive']>[0],
	options?: Parameters<PhotoLibraryImageReceivePortV1['receive']>[1]) => Promise<Readonly<PhotoLibraryImageReceiveReceiptV1 | PhotoLibraryImageReceiveReceiptV2>>;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }
function id(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Image receive requires a selected identity.'); return value;
}
function receipt(profile: 'legacy2' | 'current3', value: unknown): Readonly<PhotoLibraryImageReceiveReceiptV1 | PhotoLibraryImageReceiveReceiptV2> {
	const label = 'image receive acknowledgement', input = record(value, label, ['schemaVersion', 'status', 'catalogId', 'photoId', 'originalId', 'activeVersionId', 'revision', 'reusedOriginal', 'settlement', 'failure'],
		['schemaVersion', 'status', 'catalogId', 'photoId', 'originalId', 'activeVersionId', 'revision', 'reusedOriginal', 'settlement']);
	const settlement = field(input, 'settlement', label), reusedOriginal = field(input, 'reusedOriginal', label);
	const schemaVersion = profile === 'current3' ? 2 : 1;
	if (field(input, 'schemaVersion', label) !== schemaVersion || field(input, 'status', label) !== 'imported' || field(input, 'revision', label) !== 0
		|| typeof reusedOriginal !== 'boolean' || (settlement !== 'complete' && settlement !== 'recovery-pending')
		|| (settlement === 'complete' && Object.hasOwn(input, 'failure'))) throw new TypeError('Image receive returned no admitted publication acknowledgement.');
	return Object.freeze({ schemaVersion, status: 'imported', catalogId: id(field(input, 'catalogId', label)), photoId: id(field(input, 'photoId', label)),
		originalId: id(field(input, 'originalId', label)), activeVersionId: id(field(input, 'activeVersionId', label)), revision: 0, reusedOriginal, settlement,
		...(Object.hasOwn(input, 'failure') ? { failure: field(input, 'failure', label) } : {}) });
}

/** Capture one existing Session generation in the menu gesture. Writes use its
 * maintained action owner; this is neither another mutation queue nor a new
 * resource lifetime. Publication ACK stays independent of later page refresh. */
export function usePhotoLibraryWorkflowImageReceive({ slot, factory, loader, renderer, createSession, loadBackupSaveRuntime, createDevelopProxyRuntime, perform, publishPage }: Owners, profile: 'legacy2' | 'current3' = 'legacy2') {
	if (profile !== 'legacy2' && profile !== 'current3') throw new TypeError('Unknown selected image receive profile.');
	return useCallback((): Readonly<CapturedPhotoImageReceive> => {
		const captured = slot.current; let nativeReceive: PinnedNativeReceive | null = null;
		const isCurrent = () => captured?.live && slot.current === captured && captured.factory === createSession && captured.factory === factory.current
			&& captured.proxyFactory === createDevelopProxyRuntime && captured.proxyFactory === renderer.current
			&& captured.backupLoader === loadBackupSaveRuntime && captured.backupLoader === loader.current;
		const checked = (signal: AbortSignal, current?: SessionSlot) => { check(signal); if (!captured || !isCurrent() || (current && current !== captured)) throw new DOMException('Photo receive generation is closed.', 'AbortError'); };
		const refresh = async (owner: Omit<PhotoLibrarySessionPortV2, 'develop'>, signal: AbortSignal, current: SessionSlot) => {
			checked(signal, current);
			if (current.page) publishPage(current, Object.freeze({ ...current.page, cursor: null }));
			const next = await readVisiblePage(owner, current, null, signal); checked(signal, current); publishPage(current, next);
		};
		const failedStatus = (status: string, signal: AbortSignal): never => {
			checked(signal); throw new Error(status === 'busy' ? 'A photo library change is already pending.' : 'Photo receive did not complete.');
		};
		return Object.freeze<CapturedPhotoImageReceive>({
			...(profile === 'current3' ? { schemaVersion: 2 as const } : {}),
			async receive(value, caller) {
				const input = record(value, 'image receive gesture', ['archive', 'sourceId', 'imageClipId'], ['archive', 'sourceId']);
				const { signal } = readPhotoDevelopSignalOptionsV2({ signal: caller }); if (!signal) throw new TypeError('Image receive requires its captured signal.'); checked(signal);
				const candidate = field(input, 'archive', 'image receive gesture'), size = Number(Reflect.apply(SIZE, candidate, []));
				if (size < 1 || size > 256 * 1024 * 1024) throw new RangeError('Image receive archive exceeds its fixed input byte bound.');
				const request = Object.freeze({ archive: Reflect.apply(SLICE, candidate, [0, size]) as Blob, sourceId: id(field(input, 'sourceId', 'image receive gesture')),
					...(Object.hasOwn(input, 'imageClipId') ? { imageClipId: id(field(input, 'imageClipId', 'image receive gesture')) } : {}) });
				const result: { ack?: Readonly<PhotoLibraryImageReceiveReceiptV1 | PhotoLibraryImageReceiveReceiptV2>; failed?: Readonly<{ value: unknown }>; refreshed: boolean } = { refreshed: false };
				const status = await perform(async (owner, joined, current) => {
					try {
						checked(joined, current);
						if (!nativeReceive) {
							const port = profile === 'current3' ? (owner as Omit<PhotoLibrarySessionPortCurrentV1, 'develop'>).imageReceiveCurrent : owner.imageReceive;
							const method = port && Object.getOwnPropertyDescriptor(port, 'receive')?.value as unknown;
							if (!port || typeof method !== 'function') throw new Error('Editable photo receive is unavailable.');
							nativeReceive = (request, options) => Reflect.apply(method, port, [request, options]) as ReturnType<PhotoLibraryImageReceivePortV1['receive'] | PhotoLibraryImageReceivePortV2['receive']>;
						}
						// Admit the native ACK before a late signal or generation fence.
						result.ack = receipt(profile, await nativeReceive(request, { signal: joined }));
						await refresh(owner, joined, current); result.refreshed = true;
					} catch (failure) { result.failed = { value: failure }; throw failure; }
				}, signal);
				if (result.ack) return Object.freeze({ receipt: result.ack, refresh: result.refreshed ? 'complete' : 'failed', ...(result.failed ? { failure: result.failed.value } : {}) });
				if (result.failed) throw result.failed.value; return failedStatus(status, signal);
			},
			async reload(caller) {
				const { signal } = readPhotoDevelopSignalOptionsV2({ signal: caller }); if (!signal) throw new TypeError('Image receive requires its captured signal.'); checked(signal);
				const result: { done: boolean; failure?: Readonly<{ value: unknown }> } = { done: false };
				const status = await perform(async (owner, joined, current) => {
					try { await refresh(owner, joined, current); result.done = true; } catch (failure) { result.failure = { value: failure }; throw failure; }
				}, signal);
				if (result.failure) throw result.failure.value; if (!result.done) failedStatus(status, signal);
			},
		});
	}, [profile, slot, factory, loader, renderer, createSession, loadBackupSaveRuntime, createDevelopProxyRuntime, perform, publishPage]);
}
