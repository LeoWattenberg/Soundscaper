/* SPDX-License-Identifier: AGPL-3.0-only */

import { acquireProjectLock } from '../../common/editor/project-lock.js';
import { createEditorProjectStorageProfile } from '../../common/editor/storage/project-storage-profile.ts';
import { id } from '../catalog/value-validation.ts';

const profile = createEditorProjectStorageProfile({ databaseName: 'lightscaper-photo-media-v2',
	opfsDirectoryName: 'lightscaper-photo-originals', opfsWorkerName: 'lightscaper-photo-opfs',
	projectLockPrefix: 'lightscaper-photo-catalog:' });

export type PhotoCatalogImportExclusiveV1 = <Result>(catalogId: string,
	operation: (signal?: AbortSignal) => Promise<Result>, signal?: AbortSignal) => Promise<Result>;

/** Shared single-writer authority for operations spanning catalog and media databases. */
export const withPhotoCatalogWriteLockV1: PhotoCatalogImportExclusiveV1 = async (catalogId, operation, signal) => {
	const catalog = id(catalogId, 'catalog ID');
	signal?.throwIfAborted();
	if (!globalThis.navigator?.locks?.request) throw new Error('Durable photo import requires browser project locks.');
	const lease = await acquireProjectLock(catalog, { projectStorageProfile: profile });
	try {
		if (lease.readOnly || lease.method !== 'navigator-locks') throw new Error('Another window is writing this photo catalog.');
		const lost = new AbortController();
		if ('lost' in lease) void lease.lost?.then(() => { lost.abort(); }).catch(() => { lost.abort(); });
		const admitted = signal ? AbortSignal.any([signal, lost.signal]) : lost.signal;
		admitted.throwIfAborted();
		return await operation(admitted);
	} finally {
		lease.release();
		if ('finished' in lease) await lease.finished;
	}
};
