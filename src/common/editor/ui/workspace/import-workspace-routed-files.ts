/* SPDX-License-Identifier: AGPL-3.0-only */

import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';
import { partitionWorkspaceFiles } from './workspace-file-routing.js';

interface RoutedImportController {
	readonly actions: Readonly<{
		readonly project: Readonly<{
			importFiles(files: readonly File[], options: Readonly<Record<string, unknown>>): PromiseLike<unknown> | unknown;
		}>;
		readonly labels: Readonly<{ importFile(file: File): PromiseLike<unknown> | unknown }>;
	}>;
}

/** One load boundary for picker, drop, launch, and desktop file handoff routes. */
export function importWorkspaceRoutedFiles({
	controller, files, importOptions, openProjectFile, projectBinVisible, requestCueImport,
}: Readonly<{
	controller: RoutedImportController;
	files: readonly File[];
	importOptions: Readonly<Record<string, unknown>>;
	openProjectFile(file: File): PromiseLike<unknown> | unknown;
	projectBinVisible: boolean;
	requestCueImport(file: File): PromiseLike<unknown> | unknown;
}>): Promise<number> {
	return withWebFileLoadLimitContext(async () => {
		const routed = partitionWorkspaceFiles(files);
		for (const file of routed.projects) await openProjectFile(file);
		if (routed.media.length) await controller.actions.project.importFiles(routed.media, {
			destination: 'auto', projectBinVisible, ...importOptions,
		});
		for (const file of routed.labels) await controller.actions.labels.importFile(file);
		for (const file of routed.cues) await requestCueImport(file);
		return files.length;
	});
}
