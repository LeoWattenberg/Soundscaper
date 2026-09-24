/* SPDX-License-Identifier: AGPL-3.0-only */

interface StorageCurrentness<Project> {
	isPersistedSnapshotCurrent?: (projectId: string) => Promise<boolean>;
	isActivatedProjectCurrent?: (project: Project) => Promise<boolean>;
}

/** An explicit session adoption has its own newly published durable baseline. */
export async function verifyProjectSwitchStorageCurrent<Project>(
	storage: StorageCurrentness<Project>,
	projectId: string,
	project: Project,
	existingSession: boolean,
	options: Readonly<{ adoptSessionRevision?: boolean; save?: boolean }>,
): Promise<boolean> {
	if (existingSession && options.adoptSessionRevision !== true) {
		return storage.isPersistedSnapshotCurrent?.(projectId) ?? true;
	}
	if (options.adoptSessionRevision === true || !options.save) {
		return storage.isActivatedProjectCurrent?.(project) ?? true;
	}
	return true;
}
