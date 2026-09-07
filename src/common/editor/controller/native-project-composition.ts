/* SPDX-License-Identifier: AGPL-3.0-only */

import { withProjectFileExtension } from '../../project-file-extensions.ts';
import { createStableId } from '../project.js';
import { SCAPE_MIME_TYPE } from '../scape-project-format.ts';
import { loadStoredSourceChannels } from '../clip-time-pitch-cache-channels.js';
import { applicationVersion } from '../application-version.ts';
import { aup4ReportHasMissingPcm, ensureAup4FileName, normalizeAup4CompatibilityReport } from './app-helpers.ts';
import { deferredArchiveRuntime } from './deferred-archive-runtime.ts';
import { createNativeProjectService, type NativeProjectServiceRuntime } from './native-project-service.ts';
import type { EditorTaskProgressCoordinator } from './task-progress.ts';
import { SOURCE_CHUNK_FRAMES, sourcePcmBytes } from './source-audio.ts';

type DefaultPort =
	| 'createStableId' | 'ensureAup4FileName' | 'ensureProjectFileName' | 'sourcePcmBytes'
	| 'loadStoredSourceChannels' | 'requestAup4FileHandle' | 'saveAup4Result' | 'createAup4Client'
	| 'normalizeCompatibilityReport' | 'reportHasMissingPcm' | 'sourceChunkFrames'
	| 'scapeMimeType' | 'applicationVersion';

export type NativeProjectCompositionDependencies = Omit<NativeProjectServiceRuntime, DefaultPort | 'taskProgress' | 'copy'> & Readonly<{
	taskProgress: EditorTaskProgressCoordinator;
	copy: NativeProjectServiceRuntime['copy'] & Readonly<{ projectSaving: string }>;
}>;

/** Bind shared archive machinery once; product-specific publication remains injected. */
export function createNativeProjectComposition(dependencies: NativeProjectCompositionDependencies) {
	const service = createNativeProjectService({
		...dependencies,
		createStableId, ensureAup4FileName, ensureProjectFileName: withProjectFileExtension,
		sourcePcmBytes, loadStoredSourceChannels,
		requestAup4FileHandle: deferredArchiveRuntime.requestAup4FileHandle,
		saveAup4Result: deferredArchiveRuntime.saveAup4Result,
		createAup4Client: deferredArchiveRuntime.createAup4Client,
		normalizeCompatibilityReport: normalizeAup4CompatibilityReport,
		reportHasMissingPcm: aup4ReportHasMissingPcm,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES, scapeMimeType: SCAPE_MIME_TYPE,
		applicationVersion: applicationVersion(),
	});
	const { taskProgress, copy } = dependencies;
	const openAudacityProject = (...args: Parameters<typeof service.openAudacityProject>) => (
		taskProgress.run('project-io', copy.importing, () => service.openAudacityProject(...args))
	);
	return Object.freeze({
		...service, openAudacityProject, openAup4: openAudacityProject,
		openScape: (...args: Parameters<typeof service.openScape>) => (
			taskProgress.run('project-io', copy.importing, () => service.openScape(...args))
		),
		saveScape: (...args: Parameters<typeof service.saveScape>) => (
			taskProgress.run('project-io', copy.projectSaving, () => service.saveScape(...args))
		),
		saveAup4: (...args: Parameters<typeof service.saveAup4>) => (
			taskProgress.run('project-io', copy.aup4Saving, () => service.saveAup4(...args))
		),
	});
}
