/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_V31_COMPATIBILITY_CONTRACT } from './desktop-project-transport-v31.ts';
import { editorProjectStorageProfileNames } from '../common/editor/storage/project-storage-profile.ts';
import { FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v31.ts';
import type { FramescaperProjectV31 } from './editor-project-v31.ts';

export const FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_HANDSHAKE = Object.freeze({
	kind: 'framescaper-project-library-handshake',
	version: 1,
	owner: 'framescaper',
	projectSchemaVersion: FRAMESCAPER_V31_COMPATIBILITY_CONTRACT.projectSchemaVersion,
	storageDatabaseName: editorProjectStorageProfileNames(
		FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE,
	).databaseName,
	desktopLibrarySchemaVersion: FRAMESCAPER_V31_COMPATIBILITY_CONTRACT.desktopLibrarySchemaVersion,
	desktopDatabaseUserVersion: FRAMESCAPER_V31_COMPATIBILITY_CONTRACT.desktopDatabaseUserVersion,
	desktopLibraryScope: FRAMESCAPER_V31_COMPATIBILITY_CONTRACT.desktopLibraryScope,
	scapeFormatVersions: Object.freeze([1, 2]),
	attachedScapeFormatVersion: 2,
});

/** Public renderer contract; main/preload registration remains activation-owned. */
export interface FramescaperDesktopProjectLibraryV20Renderer {
	listProjects(): Promise<readonly Readonly<{
		readonly id: string;
		readonly title: string;
		readonly revision: number;
		readonly updatedAt: string;
	}>[]>;
	readProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<FramescaperProjectV31 | null>;
	publishProject(request: Readonly<{
		readonly project: unknown;
		readonly signal?: AbortSignal;
		readonly beforeFinish?: () => PromiseLike<void> | void;
	}>): Promise<FramescaperProjectV31>;
	deleteProject(projectId: string): Promise<void>;
	duplicateProject(sourceProjectId: string, options: Readonly<{
		readonly id: string;
		readonly title: string;
		readonly timestamp: string;
	}>): Promise<FramescaperProjectV31>;
}
