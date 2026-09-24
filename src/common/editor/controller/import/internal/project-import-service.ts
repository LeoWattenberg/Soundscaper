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
	/** Pin the destination before first-use loading yields to a project switch. */
	const captureDestination = () => {
		const projectId = runtime.getProject()?.id ?? null;
		const token = projectId !== null
			&& typeof runtime.captureProject === 'function'
			&& typeof runtime.assertProject === 'function'
			? runtime.captureProject() : null;
		return () => {
			try { if (token !== null) runtime.assertProject(token); }
			catch (error) { throw new Error('The project changed during audio import.', { cause: error }); }
			if ((runtime.getProject()?.id ?? null) !== projectId) throw new Error('The project changed during audio import.');
		};
	};
	const service = () => {
		servicePromise ??= loadRuntime().then(({ createProjectImportServiceRuntime: createRuntime }) => (
			createRuntime(runtime)
		));
		return servicePromise;
	};
	const importFile: ProjectImportServiceRuntime['importFile'] = async (
		file, options, assertRequestedProjectCurrent,
	) => {
		const assertDestinationCurrent = captureDestination();
		const loaded = await service();
		assertDestinationCurrent();
		return loaded.importFile(file, options, () => {
			assertDestinationCurrent();
			assertRequestedProjectCurrent?.();
		});
	};
	const importFiles = async (
		fileList: ImportFilesArguments[0],
		requestedOptions?: ImportFilesArguments[1],
	) => {
		const files = [...(fileList || [])];
		const assertDestinationCurrent = files.length ? captureDestination() : null;
		if (files.length && !runtime.editingBlocked()) {
			setLocalizedStatus(runtime.setStatus, runtime.copy, 'importing');
		}
		const loaded = await service();
		assertDestinationCurrent?.();
		return loaded.importFiles(files, requestedOptions, true, assertDestinationCurrent ?? undefined);
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
