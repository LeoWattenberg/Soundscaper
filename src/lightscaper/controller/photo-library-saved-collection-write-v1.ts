/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySavedCollectionAcknowledgementV1 } from '../../common/editor/photo-library-saved-collection-port-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import type { PhotoSmartCollectionWriteOptionsV1 } from '../catalog/photo-smart-collection-repository-types-v1.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../catalog/photo-smart-collection-state-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { field, id, record } from '../catalog/value-validation.ts';
import { assertAdmittedPhotoLibrarySavedCommandV1, savedLibraryRevisionV1,
	type AdmittedPhotoLibrarySavedCommandV1 } from './photo-library-saved-collection-admission-v1.ts';

export interface PhotoLibrarySavedWriteRepositoryV1 {
	saveSmartCollection(value: unknown, expectedRevision: number | null, options: PhotoSmartCollectionWriteOptionsV1): Promise<unknown>;
	deleteSmartCollection(catalogId: string, collectionId: string, expectedRevision: number, options: PhotoSmartCollectionWriteOptionsV1): Promise<unknown>;
}

/** A successful native write stays acknowledged after late cancellation; the Session owns lease cleanup notices. */
export async function applyPhotoLibrarySavedCollectionV1(repository: PhotoLibrarySavedWriteRepositoryV1,
	catalogValue: string, command: AdmittedPhotoLibrarySavedCommandV1, signal?: AbortSignal): Promise<PhotoLibrarySavedCollectionAcknowledgementV1> {
	assertAdmittedPhotoLibrarySavedCommandV1(command);
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const catalogId = id(catalogValue, 'selected catalog ID');
	if (command.context.catalogId !== catalogId) throw new TypeError('Saved command belongs to another selected catalog.');
	const options = { expectedCatalogRevision: command.context.catalogRevision, expectedIndexRevision: command.context.indexRevision,
		expectedStateRevision: command.context.collectionStateRevision, ...(signal === undefined ? {} : { signal }) };
	const result: unknown = command.type === 'delete'
		? await repository.deleteSmartCollection(catalogId, command.collectionId, command.expectedDefinitionRevision!, options)
		: await repository.saveSmartCollection(command.definition, command.expectedDefinitionRevision, options);
	const receipt = record(result, 'saved durable receipt', ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'state', 'definition']);
	if (field(receipt, 'schemaVersion') !== 1 || field(receipt, 'kind') !== 'photo-smart-collection-write'
		|| field(receipt, 'catalogId') !== catalogId) throw new TypeError('Saved receipt belongs to another profile or catalog.');
	const catalogRevision = savedLibraryRevisionV1(field(receipt, 'catalogRevision')), indexRevision = savedLibraryRevisionV1(field(receipt, 'indexRevision'));
	const state = normalizePhotoSmartCollectionsStateV1(field(receipt, 'state'));
	const count = command.context.collectionCount + (command.type === 'create' ? 1 : command.type === 'delete' ? -1 : 0);
	if (catalogRevision !== command.context.catalogRevision + 1 || indexRevision !== command.context.indexRevision + 1
		|| state.catalogId !== catalogId || state.revision !== command.context.collectionStateRevision + 1 || state.collectionCount !== count) {
		throw new TypeError('Saved receipt does not acknowledge the expected atomic revision and count changes.');
	}
	const rawDefinition = field(receipt, 'definition'); let summary: PhotoLibrarySavedCollectionAcknowledgementV1['summary'] = null;
	if (command.type === 'delete') {
		if (rawDefinition !== null) throw new TypeError('Deleted receipt retains a definition.');
	} else {
		const definition = normalizePhotoSmartCollectionV1(rawDefinition), expected = command.definition!;
		if (definition.catalogId !== catalogId || definition.id !== command.collectionId || definition.name !== expected.name
			|| definition.revision !== (command.expectedDefinitionRevision === null ? 0 : command.expectedDefinitionRevision + 1)
			|| JSON.stringify(definition.query) !== JSON.stringify(expected.query)) throw new TypeError('Saved receipt differs from its exact admitted candidate.');
		summary = Object.freeze({ id: definition.id, revision: definition.revision, name: definition.name });
	}
	return Object.freeze({ outcome: command.type === 'create' ? 'created' : command.type === 'update' ? 'updated' : 'deleted',
		collectionId: command.collectionId, context: Object.freeze({ catalogId, catalogRevision, indexRevision,
			collectionStateRevision: state.revision, collectionCount: state.collectionCount }), summary, notices: Object.freeze([]) });
}
