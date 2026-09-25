/* SPDX-License-Identifier: AGPL-3.0-only */

import { isProjectFileName } from '../../../project-file-extensions.ts';

interface ProjectFileController {
	readonly ready: PromiseLike<unknown>;
	readonly actions: {
		readonly project: {
			openAudacityProject(file: File): unknown;
			openDawproject(file: File): unknown;
			openSesx?(file: File): unknown;
		};
	};
}

export async function openWorkspaceProjectFile(
	controller: ProjectFileController,
	file: File,
	openScape: (file: File) => unknown,
	openLegacyAup?: (file: File) => unknown,
	desktopSesx = false,
): Promise<unknown> {
	// The file picker and drop target mount before the initial project exists.
	await controller.ready;
	if (/\.aup$/iu.test(file.name) && openLegacyAup) return openLegacyAup(file);
	if (isProjectFileName(file.name)) return openScape(file);
	if (/\.dawproject$/iu.test(file.name)) return controller.actions.project.openDawproject(file);
	if (/\.sesx$/iu.test(file.name)) {
		if (!desktopSesx) throw new Error('Adobe Audition SESX import requires the desktop app.');
		if (!controller.actions.project.openSesx) throw new Error('Adobe Audition SESX import is unavailable.');
		return controller.actions.project.openSesx(file);
	}
	return controller.actions.project.openAudacityProject(file);
}
