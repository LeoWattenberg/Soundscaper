/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import { FRAMESCAPER_V31_COMPATIBILITY_CONTRACT } from './desktop-project-transport-v31.ts';
import type { FramescaperProjectV31 } from './editor-project-v31.ts';

export const FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_HANDSHAKE = Object.freeze({
	kind: 'framescaper-project-library-handshake',
	version: 1,
	owner: 'framescaper',
	projectSchemaVersion: FRAMESCAPER_V31_COMPATIBILITY_CONTRACT.projectSchemaVersion,
	desktopLibrarySchemaVersion: FRAMESCAPER_V31_COMPATIBILITY_CONTRACT.desktopLibrarySchemaVersion,
	desktopDatabaseUserVersion: FRAMESCAPER_V31_COMPATIBILITY_CONTRACT.desktopDatabaseUserVersion,
	desktopLibraryScope: FRAMESCAPER_V31_COMPATIBILITY_CONTRACT.desktopLibraryScope,
	scapeFormatVersions: Object.freeze([1, 2]),
	attachedScapeFormatVersion: 2,
});

/** Prepared renderer seam; main/preload registration remains an activation-owned change. */
export interface FramescaperDesktopProjectLibraryV20Renderer {
	listProjects(): Promise<readonly Readonly<{
		readonly id: string;
		readonly title: string;
		readonly revision: number;
		readonly updatedAt: string;
	}>[]>;
	readProject(projectId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<FramescaperProjectV31 | null>;
	publishProject(request: Readonly<{
		readonly project: ProjectDocument;
		readonly signal?: AbortSignal;
	}>): Promise<FramescaperProjectV31>;
	deleteProject(projectId: string): Promise<void>;
}
