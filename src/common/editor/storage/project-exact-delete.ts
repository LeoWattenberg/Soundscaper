/* SPDX-License-Identifier: AGPL-3.0-only */

import { compactProjectSourceMetadata } from '../retention.js';
import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
	readStoredLinkedOriginalProvisionalRootInventory,
} from './linked-original-provisional-root.ts';
import {
	LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME,
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
} from './linked-video-original-schema.ts';
import type { ProjectDocument } from './project-repository.ts';
import { sameProjectSnapshot } from './project-snapshot-equality.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

/** Atomically delete only the exact current project and its local lifecycle rows. */
export async function deleteExactProject(
	port: StorageRepositoryPort,
	project: ProjectDocument,
): Promise<boolean> {
	const snapshot = compactProjectSourceMetadata(structuredClone(project)) as ProjectDocument;
	const database = await port.database();
	if (!database) throw new Error('Exact project deletion requires durable IndexedDB storage.');
	return transact(database, [
		'projects', 'revisions', LINKED_VIDEO_ORIGINAL_STORE_NAME,
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
	], 'readwrite', async (stores) => {
		const current = await request(stores.projects.get(snapshot.id));
		if (!sameProjectSnapshot(current, snapshot)) return false;
		await readStoredLinkedOriginalProvisionalRootInventory(
			stores[LINKED_VIDEO_ORIGINAL_STORE_NAME],
			stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME],
		);
		stores.projects.delete(snapshot.id);
		await deleteByIndex(stores.revisions.index('projectId'), snapshot.id);
		await deleteByIndex(
			stores[LINKED_VIDEO_ORIGINAL_STORE_NAME].index(LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME),
			snapshot.id,
		);
		await deleteByIndex(stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].index(
			LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
		), snapshot.id);
		return true;
	});
}
