/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeProjectImportOptions,
	normalizeProjectImportTimelineStartFrame,
} from './project-import-options.ts';
import { setLocalizedStatus } from '../../../../i18n/presentation-message.ts';

import type { ProjectImportRuntime } from './project-import-runtime.ts';
import type { createProjectImportServiceRuntime } from './project-import-service-runtime.ts';

export type { ProjectImportRuntime } from './project-import-runtime.ts';

type ProjectImportServiceRuntime = ReturnType<typeof createProjectImportServiceRuntime>;
type ImportFilesArguments = Parameters<ProjectImportServiceRuntime['importFiles']>;

export type ProjectImportServiceRuntimeLoader = () => Promise<Readonly<{
	createProjectImportServiceRuntime: typeof createProjectImportServiceRuntime;
}>>;

const loadProjectImportServiceRuntime: ProjectImportServiceRuntimeLoader = () => (
	import('./project-import-service-runtime.ts')
);

/** Keep option normalization synchronous while deferring import execution until first use. */
export function createProjectImportService(
	runtime: ProjectImportRuntime,
	loadRuntime: ProjectImportServiceRuntimeLoader = loadProjectImportServiceRuntime,
) {
	let servicePromise: Promise<ProjectImportServiceRuntime> | null = null;
	const service = () => {
		servicePromise ??= loadRuntime().then(({ createProjectImportServiceRuntime: createRuntime }) => (
			createRuntime(runtime)
		));
		return servicePromise;
	};
	const importFile: ProjectImportServiceRuntime['importFile'] = async (...args) => (
		(await service()).importFile(...args)
	);
	const importFiles = async (
		fileList: ImportFilesArguments[0],
		requestedOptions?: ImportFilesArguments[1],
	) => {
		const files = [...(fileList || [])];
		if (files.length && !runtime.editingBlocked()) {
			setLocalizedStatus(runtime.setStatus, runtime.copy, 'importing');
		}
		return (await service()).importFiles(files, requestedOptions, true);
	};
	return Object.freeze({
		importFile,
		importFiles,
		normalizeImportOptions: (value: unknown = {}) => (
			normalizeProjectImportOptions(value, runtime.copy.timelineFramesFinite)
		),
		normalizeImportTimelineStartFrame: (value: unknown) => (
			normalizeProjectImportTimelineStartFrame(value, runtime.copy.timelineFramesFinite)
		),
	});
}
