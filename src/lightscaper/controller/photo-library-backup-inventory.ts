/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import { normalizePhotoStackStateV1 } from '../catalog/photo-stack-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { field, record } from '../catalog/value-validation.ts';
import { capturePhotoLibraryBackupSourceV1, type PhotoLibraryBackupSourcePortsV1 } from './photo-library-backup-source-v1.ts';
import { capturePhotoLibraryBackupStacksV1, type PhotoLibraryBackupStackPortsV1 } from './photo-library-backup-stacks-v1.ts';

export interface PhotoLibraryBackupInventoryPorts extends PhotoLibraryBackupSourcePortsV1 {
	readonly catalog: PhotoLibraryBackupSourcePortsV1['catalog'] & Pick<PhotoCatalogRepositoryV1, 'captureSmartCollectionArchiveV1'>;
	readonly stacks: PhotoLibraryBackupStackPortsV1;
}

/** Pin all borrowed method identities and receivers before a held read can replace them. */
export function borrowPhotoLibraryBackupInventoryPorts(ports: PhotoLibraryBackupInventoryPorts): PhotoLibraryBackupInventoryPorts {
	const catalog = ports.catalog, stacks = ports.stacks;
	const capture = catalog.captureSmartCollectionArchiveV1, readStackState = stacks?.readStackState,
		readStackPage = stacks?.readStackPage, loadStack = stacks?.loadStack;
	if (typeof capture !== 'function' || typeof readStackState !== 'function'
		|| typeof readStackPage !== 'function' || typeof loadStack !== 'function') {
		throw new TypeError('Saved catalog backup requires stack and saved inventory capabilities.');
	}
	return { catalog: { readSnapshot: catalog.readSnapshot.bind(catalog), readSummaryPage: catalog.readSummaryPage.bind(catalog),
		loadPhoto: catalog.loadPhoto.bind(catalog), captureSmartCollectionArchiveV1: capture.bind(catalog) },
		stacks: { readStackState: readStackState.bind(stacks), readStackPage: readStackPage.bind(stacks), loadStack: loadStack.bind(stacks) },
		loadOriginal: ports.loadOriginal.bind(ports) };
}

/** Shared V3 inventory audits stay under the caller's existing catalog writer, with no additional resource acquisition. */
export async function capturePhotoLibraryBackupInventory(catalogId: string, borrowed: PhotoLibraryBackupInventoryPorts,
	signal?: AbortSignal) {
	const source = await capturePhotoLibraryBackupSourceV1(catalogId, borrowed, signal);
	const capture = await borrowed.catalog.captureSmartCollectionArchiveV1(catalogId, { signal }); signal?.throwIfAborted();
	const context = record(capture.context, 'saved backup context', ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'state']);
	if (field(context, 'schemaVersion') !== 1 || field(context, 'kind') !== 'photo-smart-collection-archive-context'
		|| field(context, 'catalogId') !== catalogId || field(context, 'catalogRevision') !== source.initial.catalog.revision
		|| field(context, 'indexRevision') !== source.initial.indexRevision) throw new PhotoCatalogRevisionConflictError('catalog');
	const rawState = field(context, 'state'), state = rawState === null ? null : normalizePhotoSmartCollectionsStateV1(rawState);
	if (state !== null && state.catalogId !== catalogId) throw new TypeError('Saved backup state belongs to another catalog.');
	if (typeof capture.verify !== 'function') throw new TypeError('Saved backup requires final inventory verification.');
	const verifySaved = capture.verify.bind(capture), verifyCatalog = source.verifyCatalog;
	const readStackState = borrowed.stacks.readStackState.bind(borrowed.stacks);
	const capturedStack = normalizePhotoStackStateV1(await readStackState(catalogId, { signal })); signal?.throwIfAborted();
	let initialStateLent = false;
	const stacks = await capturePhotoLibraryBackupStacksV1(source.initial, {
		async readStackState(...args) {
			if (!initialStateLent) { initialStateLent = true; return capturedStack; }
			return readStackState(...args);
		}, readStackPage: borrowed.stacks.readStackPage.bind(borrowed.stacks), loadStack: borrowed.stacks.loadStack.bind(borrowed.stacks),
	}, verifyCatalog, signal);
	return Object.freeze({ source, stacks, state, definitions: capture.definitions,
		async verify(verifyCompanion?: () => Promise<void>) {
			await verifyCatalog(); await verifySaved(); await verifyCompanion?.();
			const finalStack = normalizePhotoStackStateV1(await readStackState(catalogId, { signal })); signal?.throwIfAborted();
			if (JSON.stringify(finalStack) !== JSON.stringify(capturedStack)) throw new PhotoCatalogRevisionConflictError('catalog');
			await verifyCatalog();
		} });
}
