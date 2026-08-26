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
	resolveLocalAssistanceSelectedVideoAuthority,
	type LocalAssistanceSelectedVideoPrepared,
} from './local-assistance-selected-video.ts';
import {
	createLocalAssistanceSelectedVideoSourceTimeDescriptorV1,
	type LocalAssistanceSelectedVideoSourceTimeDescriptorV1,
} from './local-assistance-selected-video-source-time.ts';
import type { AssistanceSelectionFence } from '../assistance/proposal-session.ts';
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
	LocalAssistanceSelectedVideoPrepared,
	Readonly<{ readonly descriptor: LocalAssistanceSelectedVideoSourceTimeDescriptorV1;
		readonly selectionFence: AssistanceSelectionFence }>
>> {
	const audio = createLocalAssistanceSelectedMediaPreparation({
		...dependencies,
		getSelectedClipId: () => selectedOrLinkedAudioClipId(
			dependencies.getProject(), dependencies.getSelectedClipId(),
		),
	});
	const video = dependencies.videoStore ? videoPreparation(dependencies) : null;
	return createLocalAssistanceSelectedMediaPreparationRouter({ audio, video });
}

function videoPreparation(dependencies: LocalAssistanceSelectedPreparationDependencies) {
	const base = createLocalAssistanceSelectedVideoPreparation({
		getProject: dependencies.getProject,
		getSelectedClipId: dependencies.getSelectedClipId,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		store: dependencies.videoStore!,
	});
	return Object.freeze({ ...base, async describeSelectedVideoSourceTime() {
		const token = dependencies.captureProject();
		const authority = resolveLocalAssistanceSelectedVideoAuthority(dependencies);
		const descriptor = createLocalAssistanceSelectedVideoSourceTimeDescriptorV1(authority);
		dependencies.assertProject(token);
		return Object.freeze({ descriptor, selectionFence: authority.fence });
	} });
}

function selectedOrLinkedAudioClipId(projectValue: unknown, selectedId: string | null): string | null {
	if (typeof selectedId !== 'string' || selectedId.length < 1 || !projectValue
		|| typeof projectValue !== 'object' || Array.isArray(projectValue)) return selectedId;
	const clipsValue = (projectValue as Readonly<Record<string, unknown>>).clips;
	if (!Array.isArray(clipsValue)) return selectedId;
	const clips = clipsValue.filter((candidate): candidate is Readonly<Record<string, unknown>> => (
		Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate)
	));
	const selected = clips.filter(({ id }) => id === selectedId);
	if (selected.length !== 1 || selected[0]!.kind !== 'video') return selectedId;
	const linkId = selected[0]!.avLinkId;
	if (typeof linkId !== 'string' || linkId.length < 1) return selectedId;
	const linked = clips.filter(({ kind, avLinkId }) => kind === 'audio' && avLinkId === linkId);
	return linked.length === 1 && typeof linked[0]!.id === 'string' ? linked[0]!.id : selectedId;
}
