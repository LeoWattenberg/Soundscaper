/* SPDX-License-Identifier: AGPL-3.0-only */

import { isProjectFileName } from '../../../project-file-extensions.ts';
import { isWorkspaceImportFile, partitionWorkspaceFiles } from './workspace-file-routing.js';
import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';

interface ProjectFileController {
	readonly ready: PromiseLike<unknown>;
	readonly actions: {
		readonly project: {
			openAudacityProject(file: File): unknown;
			openDawproject(file: File): unknown;
			openSesx?(file: File): unknown;
			create?(options: Readonly<{ title: string }>): unknown;
			importFiles?(files: readonly File[], options: Readonly<{ destination: 'timeline' }>): unknown;
		};
		readonly labels?: { readonly importFile: (file: File) => unknown };
	};
}

export function openWorkspaceProjectFile(...args: Parameters<typeof routeWorkspaceProjectFile>): Promise<unknown> {
	return withWebFileLoadLimitContext(() => routeWorkspaceProjectFile(...args));
}

async function routeWorkspaceProjectFile(
	controller: ProjectFileController,
	file: File,
	openScape: (file: File) => unknown,
	openLegacyAup?: (file: File) => unknown,
	desktopSesx = false,
	openCueFile?: (file: File) => unknown,
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
	if (/\.aup[34]$/iu.test(file.name)) return controller.actions.project.openAudacityProject(file);
	if (!isWorkspaceImportFile(file)) throw new TypeError('Choose a supported project or import file.');
	const routed = partitionWorkspaceFiles([file]);
	if (!controller.actions.project.create) throw new TypeError('Creating a project for File Open is unavailable.');
	if (routed.media.length && !controller.actions.project.importFiles) throw new TypeError('Media import is unavailable.');
	if (routed.labels.length && !controller.actions.labels?.importFile) throw new TypeError('Label import is unavailable.');
	if (routed.cues.length && !openCueFile) throw new TypeError('CUE import is unavailable.');
	const title = file.name.replace(/\.[^.]+$/u, '') || file.name;
	await controller.actions.project.create({ title });
	if (routed.labels.length) return controller.actions.labels?.importFile(file);
	if (routed.cues.length) return openCueFile?.(file);
	return controller.actions.project.importFiles?.([file], { destination: 'timeline' });
}
