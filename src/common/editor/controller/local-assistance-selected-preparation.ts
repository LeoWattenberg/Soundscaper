/* SPDX-License-Identifier: AGPL-3.0-only */

/** Controller composition for exact selected audio and authenticated selected video. */

import {
	createLocalAssistanceSelectedMediaPreparation,
	type LocalAssistanceSelectedMediaPrepared,
	type LocalAssistanceSelectedMediaPreparationDependencies,
} from './local-assistance-selected-media.ts';
import {
	createLocalAssistanceSelectedMediaPreparationRouter,
	type LocalAssistanceSelectedMediaPreparationRouter,
} from './local-assistance-selected-media-router.ts';
import {
	createLocalAssistanceSelectedVideoPreparation,
	type LocalAssistanceSelectedVideoPrepared,
} from './local-assistance-selected-video.ts';
import type { VideoExportOriginalStore } from './video-export-original-loader.ts';

export type LocalAssistanceSelectedVideoStore = VideoExportOriginalStore;

export interface LocalAssistanceSelectedPreparationDependencies
	extends LocalAssistanceSelectedMediaPreparationDependencies {
	readonly videoStore?: VideoExportOriginalStore;
}

export function createLocalAssistanceSelectedPreparation(
	dependencies: LocalAssistanceSelectedPreparationDependencies,
): Readonly<LocalAssistanceSelectedMediaPreparationRouter<
	LocalAssistanceSelectedMediaPrepared,
	LocalAssistanceSelectedVideoPrepared
>> {
	const audio = createLocalAssistanceSelectedMediaPreparation(dependencies);
	const video = dependencies.videoStore ? createLocalAssistanceSelectedVideoPreparation({
		getProject: dependencies.getProject,
		getSelectedClipId: dependencies.getSelectedClipId,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		store: dependencies.videoStore,
	}) : null;
	return createLocalAssistanceSelectedMediaPreparationRouter({ audio, video });
}
