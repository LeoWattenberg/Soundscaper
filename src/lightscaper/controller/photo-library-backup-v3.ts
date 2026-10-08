/* SPDX-License-Identifier: AGPL-3.0-only */

import { exportPhotoCatalogArchiveV3, type PhotoCatalogArchiveExportResultV3 } from '../archive/catalog-archive-export-v3.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import { withPhotoSmartCollectionWriteSignalV1 } from '../catalog/photo-smart-collection-repository-v1.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import { normalizePhotoStackStateV1 } from '../catalog/photo-stack-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { field, id, record } from '../catalog/value-validation.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';
import { capturePhotoLibraryBackupSourceV1, type PhotoLibraryBackupSourcePortsV1 } from './photo-library-backup-source-v1.ts';
import { capturePhotoLibraryBackupStacksV1, type PhotoLibraryBackupStackPortsV1 } from './photo-library-backup-stacks-v1.ts';

export interface PhotoLibraryBackupPortsV3 extends PhotoLibraryBackupSourcePortsV1 {
	readonly catalog: PhotoLibraryBackupSourcePortsV1['catalog'] & Pick<PhotoCatalogRepositoryV1, 'captureSmartCollectionArchiveV1'>;
	readonly stacks: PhotoLibraryBackupStackPortsV1;
}

/** Borrow one existing session/lease; authenticate saved inventory before originals or output. */
export async function exportPhotoLibraryBackupV3(catalogValue: unknown, ports: PhotoLibraryBackupPortsV3,
	optionsValue: unknown = {}): Promise<PhotoCatalogArchiveExportResultV3> {
	const catalogId = id(catalogValue, 'backup catalog ID'), options = admitPhotoLibraryBackupRequestV1(optionsValue);
	return withPhotoSmartCollectionWriteSignalV1(options.signal, async signal => {
		const catalogPort = ports.catalog, stacksPort = ports.stacks, captureMethod = catalogPort.captureSmartCollectionArchiveV1;
		if (typeof captureMethod !== 'function' || !stacksPort || typeof stacksPort.readStackState !== 'function'
			|| typeof stacksPort.readStackPage !== 'function' || typeof stacksPort.loadStack !== 'function') {
			throw new TypeError('Saved catalog backup requires stack and saved inventory capabilities.');
		}
		const sourcePorts = { catalog: { readSnapshot: catalogPort.readSnapshot.bind(catalogPort),
			readSummaryPage: catalogPort.readSummaryPage.bind(catalogPort), loadPhoto: catalogPort.loadPhoto.bind(catalogPort) },
			loadOriginal: ports.loadOriginal.bind(ports) };
		const readStackState = stacksPort.readStackState.bind(stacksPort), readStackPage = stacksPort.readStackPage.bind(stacksPort),
			loadStack = stacksPort.loadStack.bind(stacksPort);
		const source = await capturePhotoLibraryBackupSourceV1(catalogId, sourcePorts, signal);
		const capture = await captureMethod.call(catalogPort, catalogId, { signal }); signal?.throwIfAborted();
		const context = record(capture.context, 'saved backup context', ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'state']);
		if (field(context, 'schemaVersion') !== 1 || field(context, 'kind') !== 'photo-smart-collection-archive-context'
			|| field(context, 'catalogId') !== catalogId || field(context, 'catalogRevision') !== source.initial.catalog.revision
			|| field(context, 'indexRevision') !== source.initial.indexRevision) throw new PhotoCatalogRevisionConflictError('catalog');
		const rawState = field(context, 'state'), state = rawState === null ? null : normalizePhotoSmartCollectionsStateV1(rawState);
		if (state !== null && state.catalogId !== catalogId) throw new TypeError('Saved backup state belongs to another catalog.');
		if (typeof capture.verify !== 'function') throw new TypeError('Saved backup requires final inventory verification.');
		const verifySaved = capture.verify.bind(capture), verifyCatalog = source.verifyCatalog;
		const capturedStack = normalizePhotoStackStateV1(await readStackState(catalogId, { signal })); signal?.throwIfAborted();
		let initialStateLent = false;
		const stacks = await capturePhotoLibraryBackupStacksV1(source.initial, {
			async readStackState(...args) {
				if (!initialStateLent) { initialStateLent = true; return capturedStack; }
				return readStackState(...args);
			}, readStackPage, loadStack,
		}, verifyCatalog, signal);
		return exportPhotoCatalogArchiveV3(source.initial.catalog, source.originals, stacks, state, capture.definitions, {
			...options, signal, async verifySource() {
				await verifyCatalog(); await verifySaved();
				const finalStack = normalizePhotoStackStateV1(await readStackState(catalogId, { signal })); signal?.throwIfAborted();
				if (JSON.stringify(finalStack) !== JSON.stringify(capturedStack)) throw new PhotoCatalogRevisionConflictError('catalog');
				await verifyCatalog();
			},
		});
	});
}
