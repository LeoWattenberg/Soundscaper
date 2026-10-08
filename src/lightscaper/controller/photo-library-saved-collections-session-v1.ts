/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySavedCollectionAcknowledgementV1, PhotoLibrarySavedCollectionPortV1 } from '../../common/editor/photo-library-saved-collection-port-v1.ts';
import { withPhotoSmartCollectionWriteSignalV1 } from '../catalog/photo-smart-collection-repository-v1.ts';
import { withPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { admitPhotoLibrarySavedCommandV1, admitPhotoLibrarySavedPageRequestV1, admitPhotoLibrarySavedQueryRequestV1,
	admitPhotoLibrarySavedSignalV1, admitPhotoLibrarySavedSnapshotRequestV1 } from './photo-library-saved-collection-admission-v1.ts';
import { readPhotoLibrarySavedPageV1, readPhotoLibrarySavedQueryStepV1, readPhotoLibrarySavedSnapshotV1 } from './photo-library-saved-collection-read-v1.ts';
import { applyPhotoLibrarySavedCollectionV1 } from './photo-library-saved-collection-write-v1.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';

export interface PhotoLibrarySavedCollectionsSessionHostV1 {
	readonly repositories: Pick<PhotoLibrarySessionPortsV1, 'smartCollections'>;
	readonly operation: <Result>(run: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly mutation: <Result>(run: (catalogId: string, signal: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;
	readonly ready: () => Promise<string>;
	readonly createId: () => string;
}

/** Four scalar methods borrow the Session's readiness, lifetime and single writer; no resource is allocated here. */
export function createPhotoLibrarySavedCollectionsSessionV1(host: PhotoLibrarySavedCollectionsSessionHostV1): Readonly<PhotoLibrarySavedCollectionPortV1> {
	const repository = () => {
		const selected = host.repositories.smartCollections;
		if (!selected) throw new Error('Saved photo collections are unavailable.');
		return selected;
	};
	return Object.freeze({
		async readPage(options = {}) {
			const request = admitPhotoLibrarySavedPageRequestV1(options), selected = repository();
			return withPhotoStackQuerySignalV1(request.signal, privateSignal => host.operation(async signal => {
				const catalogId = await host.ready(); signal.throwIfAborted();
				return readPhotoLibrarySavedPageV1(selected, catalogId, request, signal);
			}, privateSignal));
		},
		async readSnapshot(options) {
			const request = admitPhotoLibrarySavedSnapshotRequestV1(options), selected = repository();
			return withPhotoStackQuerySignalV1(request.signal, privateSignal => host.operation(async signal => {
				const catalogId = await host.ready(); signal.throwIfAborted();
				return readPhotoLibrarySavedSnapshotV1(selected, catalogId, request, signal);
			}, privateSignal));
		},
		async readQueryStep(options) {
			const request = admitPhotoLibrarySavedQueryRequestV1(options), selected = repository();
			return withPhotoStackQuerySignalV1(request.signal, privateSignal => host.operation(async signal => {
				const catalogId = await host.ready(); signal.throwIfAborted();
				return readPhotoLibrarySavedQueryStepV1(selected, catalogId, request, signal);
			}, privateSignal));
		},
		async apply(command, options = {}) {
			const request = admitPhotoLibrarySavedSignalV1(options), admitted = admitPhotoLibrarySavedCommandV1(command, host.createId), selected = repository();
			const completed: { result: PhotoLibrarySavedCollectionAcknowledgementV1 | null } = { result: null };
			try {
				return await withPhotoSmartCollectionWriteSignalV1(request.signal, privateSignal => host.mutation(async (catalogId, signal) => {
					completed.result = await applyPhotoLibrarySavedCollectionV1(selected, catalogId, admitted, signal);
					return completed.result;
				}, privateSignal));
			} catch (error) {
				if (completed.result === null) throw error;
				return Object.freeze({ ...completed.result, notices: Object.freeze(['cleanup-failed'] as const) });
			}
		},
	} satisfies PhotoLibrarySavedCollectionPortV1);
}
