/* SPDX-License-Identifier: AGPL-3.0-only */

import { isProjectFileName } from '../../../project-file-extensions.ts';

interface ProjectFileController {
	readonly ready: PromiseLike<unknown>;
	readonly actions: {
		readonly project: {
			openAudacityProject(file: File): unknown;
			openDawproject(file: File): unknown;
		};
	};
}

export async function openWorkspaceProjectFile(
	controller: ProjectFileController,
	file: File,
	openScape: (file: File) => unknown,
): Promise<unknown> {
	// The file picker and drop target mount before the initial project exists.
	await controller.ready;
	if (isProjectFileName(file.name)) return openScape(file);
	if (/\.dawproject$/iu.test(file.name)) return controller.actions.project.openDawproject(file);
	return controller.actions.project.openAudacityProject(file);
}
