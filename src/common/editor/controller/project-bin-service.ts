/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	collectClipTransformIds as collectLegacyClipTransformIds,
	collectRelatedClipIds as collectLegacyRelatedClipIds,
} from '../commands/clip-basic-runtime.js';
import { createAddTrackCommand } from '../commands/factories.ts';
import type { AudioEditorCommand } from '../commands/protocol.ts';
import {
	createProjectBinPreviewService,
	type ProjectBinPlaybackEngine,
	type ProjectBinPreviewDependencies,
	type ProjectBinPreviewEngine,
} from './project-bin-preview-service.ts';
import {
	createProjectBinReplacementService,
	type ProjectBinReplacementDependencies,
	type ProjectBinReplacementService,
} from './project-bin-replacement-service.ts';
import {
	findProjectBinClip,
	findProjectBinClipTrack,
	findProjectBinSource,
	findProjectBinTrack,
	projectBinClips,
	type ProjectBinCopy,
	type ProjectBinPreview,
	type ProjectBinProject,
	type ProjectBinVisualData,
} from './project-bin-types.ts';
import type { EngineChunkSourceInput, EngineSourceBufferInput } from '../engine/public-api.ts';
import type { EngineSourceResolver } from '../engine/types.ts';

type SelectionCommand = Extract<AudioEditorCommand, { readonly type: 'selection/set' }>;

interface CommitSelection {
	readonly selectTrackId?: string | null;
	readonly selectClipId?: string | null;
}

export interface ProjectBinServiceDependencies extends ProjectBinReplacementDependencies {
	readonly copy: ProjectBinCopy;
	readonly trackColors: readonly string[];
	readonly playbackEngine: ProjectBinPlaybackEngine;
	readonly sourceBuffers: Map<string, AudioBuffer>;
	readonly sourcePeaks: Map<string, unknown>;
	readonly missingSourceIds: Set<string>;
	readonly sourceResolver?: EngineSourceResolver | null;
	createPreviewEngine(options: Readonly<{ onState(state: string): void }>): ProjectBinPreviewEngine;
	getSelectedClipId(): string | null;
	getSelectedTrackId(): string | null;
	setSelectedClipId(clipId: string | null): void;
	setSelectedTrackId(trackId: string | null): void;
	getPreview(): ProjectBinPreview | null;
	setPreview(preview: ProjectBinPreview | null): void;
	commit(command: AudioEditorCommand, selection?: CommitSelection): unknown;
	updateSelection(command: SelectionCommand): unknown;
	getPositionFrames(): number;
	normalizeTimelineStartFrame(frame: unknown): number;
	getVisualData(clipId: string): ProjectBinVisualData | null;
}

export interface ProjectBinService extends ProjectBinReplacementService {
	moveClipsToProjectBin(clipId?: string | readonly (string | null | undefined)[] | null): readonly string[] | null;
	placeProjectBinClip(binClipId: string, placement?: Readonly<{ trackId?: string | null; timelineStartFrame?: unknown }>): string | null;
	renameProjectBinClip(clipId: string, requestedName: unknown): string | null;
	removeProjectBinClip(clipId: string): string | null;
	setProjectBinClipColor(clipId: string, color: string): string | null;
	projectBinInstanceCount(clipId: string): number;
	selectProjectBinInstances(clipId: string): readonly string[];
	removeProjectBinSource(clipId: string): readonly string[] | null;
	playPauseProjectBinClip(clipId: string): Promise<ProjectBinPreview>;
	stopProjectBinPreview(options?: Readonly<{ dispose?: boolean }>): Promise<boolean>;
	dispose(): Promise<void>;
}

export function createProjectBinService(
	dependencies: ProjectBinServiceDependencies,
): Readonly<ProjectBinService> {
	const replacement = createProjectBinReplacementService(dependencies);
	const preview = createProjectBinPreviewService(previewDependencies(dependencies));

	return Object.freeze({
		moveClipsToProjectBin,
		placeProjectBinClip,
		renameProjectBinClip,
		removeProjectBinClip,
		setProjectBinClipColor,
		projectBinInstanceCount,
		selectProjectBinInstances,
		removeProjectBinSource,
		...replacement,
		playPauseProjectBinClip: preview.playPauseProjectBinClip,
		stopProjectBinPreview: preview.stopProjectBinPreview,
		dispose,
	});

	function moveClipsToProjectBin(
		clipId: string | readonly (string | null | undefined)[] | null = dependencies.getSelectedClipId(),
	): readonly string[] | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const requestedIds = Array.isArray(clipId) ? clipId : [clipId];
		const participatingIds = new Set<string>();
		for (const requestedId of requestedIds) {
			if (!requestedId) continue;
			for (const participatingId of collectClipTransformIds(project, requestedId)) {
				participatingIds.add(participatingId);
			}
		}
		const clipIds = project.clips
			.filter((clip) => participatingIds.has(clip.id))
			.map((clip) => clip.id);
		if (!clipIds.length) throw new Error(dependencies.copy.audioClipNotFound);
		dependencies.commit({ type: 'project-bin/move-from-timeline', clipIds }, { selectClipId: null });
		return Object.freeze(clipIds);
	}

	function placeProjectBinClip(
		binClipId: string,
		placement: Readonly<{ trackId?: string | null; timelineStartFrame?: unknown }> = {},
	): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const project = dependencies.getProject();
		const binClip = findProjectBinClip(project, binClipId);
		if (!binClip) throw new Error(dependencies.copy.audioClipNotFound);
		const itemClips = project.schemaVersion >= 4
			? projectBinClips(project).filter((clip) => clip.binItemId === binClip.binItemId)
			: [binClip];
		for (const itemClip of itemClips) {
			const source = findProjectBinSource(project, itemClip.sourceId);
			if (!source || dependencies.missingSourceIds.has(source.id)) {
				throw new Error(dependencies.copy.localSourcesMissing);
			}
		}
		const videoClip = itemClips.find((clip) => clip.kind === 'video') ?? null;
		const audioClip = itemClips.find((clip) => clip.kind !== 'video') ?? null;
		const requestedTrack = findProjectBinTrack(
			project,
			placement.trackId ?? dependencies.getSelectedTrackId(),
		);
		const commands: AudioEditorCommand[] = [];
		let videoTrack = requestedTrack?.type === 'video' ? requestedTrack : null;
		let audioTrack = requestedTrack?.type === 'audio' ? requestedTrack : null;
		if (requestedTrack?.laneGroupId) {
			videoTrack ||= project.tracks.find((track) => (
				track.type === 'video' && track.laneGroupId === requestedTrack.laneGroupId
			)) ?? null;
			audioTrack ||= project.tracks.find((track) => (
				track.type === 'audio' && track.laneGroupId === requestedTrack.laneGroupId
			)) ?? null;
		}
		if (videoClip && audioClip && (
			!videoTrack?.laneGroupId || videoTrack.laneGroupId !== audioTrack?.laneGroupId
		)) {
			videoTrack = null;
			audioTrack = null;
		}
		if (videoClip && !videoTrack) {
			const laneGroupId = dependencies.createId('media-lane');
			const videoTrackId = dependencies.createId('video-track');
			const audioTrackId = dependencies.createId('track');
			const insertion = project.tracks.length;
			commands.push({
				...createAddTrackCommand({
					schemaVersion: 4,
					type: 'video',
					id: videoTrackId,
					name: binClip.title || 'Video',
					laneGroupId,
				}),
				index: insertion,
			}, {
				...createAddTrackCommand({
					schemaVersion: 4,
					type: 'audio',
					id: audioTrackId,
					name: `${binClip.title || dependencies.copy.track} Audio`,
					laneGroupId,
					armed: false,
				}),
				index: insertion + 1,
			});
			videoTrack = { id: videoTrackId, type: 'video', laneGroupId, clipIds: [] };
			audioTrack = { id: audioTrackId, type: 'audio', laneGroupId, clipIds: [] };
		} else if (audioClip && !audioTrack) {
			const audioTrackId = dependencies.createId('track');
			commands.push(createAddTrackCommand({
				schemaVersion: project.schemaVersion,
				type: 'audio',
				id: audioTrackId,
				name: binClip.title || `${dependencies.copy.track} ${project.tracks.length + 1}`,
			}));
			audioTrack = { id: audioTrackId, type: 'audio', laneGroupId: null, clipIds: [] };
		}
		const timelineStartFrame = dependencies.normalizeTimelineStartFrame(
			placement.timelineStartFrame ?? dependencies.getPositionFrames(),
		);
		const placements = itemClips.map((itemClip) => ({
			binClipId: itemClip.id,
			trackId: itemClip.kind === 'video' ? videoTrack?.id : audioTrack?.id,
			clipId: dependencies.createId('clip'),
			...(itemClip.kind === 'video' && itemClip.videoEffects?.length ? {
				videoEffectIds: itemClip.videoEffects.map(() => dependencies.createId('video-effect')),
			} : {}),
		}));
		const selectedPlacement = placements.find((candidate) => candidate.binClipId === videoClip?.id)
			?? placements[0];
		if (!selectedPlacement) throw new Error(dependencies.copy.audioClipNotFound);
		commands.push({
			type: 'project-bin/place',
			binClipId: binClip.id,
			timelineStartFrame,
			placements,
			...(itemClips.length === 2 ? { avLinkId: dependencies.createId('av-link') } : {}),
		});
		const selectedTrack = videoClip ? videoTrack : audioTrack;
		if (!selectedTrack) throw new Error(dependencies.copy.audioClipNotFound);
		dependencies.commit(commands.length === 1 ? commands[0] : { type: 'batch', commands }, {
			selectTrackId: selectedTrack.id,
			selectClipId: selectedPlacement.clipId,
		});
		return selectedPlacement.clipId;
	}

	function renameProjectBinClip(clipId: string, requestedName: unknown): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		if (!findProjectBinClip(dependencies.getProject(), clipId)) {
			throw new Error(dependencies.copy.audioClipNotFound);
		}
		const title = String(requestedName ?? '').trim();
		if (!title) throw new TypeError('A project-bin clip name is required.');
		dependencies.commit({ type: 'project-bin/update', clipId, changes: { title } });
		return title;
	}

	function removeProjectBinClip(clipId: string): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		if (!findProjectBinClip(dependencies.getProject(), clipId)) {
			throw new Error(dependencies.copy.audioClipNotFound);
		}
		dependencies.commit({ type: 'project-bin/remove', clipId });
		return clipId;
	}

	function setProjectBinClipColor(clipId: string, color: string): string | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		if (!findProjectBinClip(dependencies.getProject(), clipId)) {
			throw new Error(dependencies.copy.audioClipNotFound);
		}
		if (!dependencies.trackColors.includes(color)) throw new RangeError('Unsupported Project Bin color.');
		dependencies.commit({ type: 'project-bin/update', clipId, changes: { color } });
		return color;
	}

	function projectBinSourceIds(clipId: string, project = dependencies.getProject()): Set<string> {
		const clip = findProjectBinClip(project, clipId);
		if (!clip) throw new Error(dependencies.copy.audioClipNotFound);
		const itemClips = project.schemaVersion >= 4
			? projectBinClips(project).filter((candidate) => candidate.binItemId === clip.binItemId)
			: [clip];
		return new Set(itemClips.map((candidate) => candidate.sourceId));
	}

	function projectBinInstanceIds(clipId: string, project = dependencies.getProject()): string[] {
		const sourceIds = projectBinSourceIds(clipId, project);
		return project.clips.filter((clip) => sourceIds.has(clip.sourceId)).map((clip) => clip.id);
	}

	function projectBinInstanceCount(clipId: string): number {
		dependencies.lifetime.assertActive();
		return projectBinInstanceIds(clipId).length;
	}

	function selectProjectBinInstances(clipId: string): readonly string[] {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const clipIds = collectRelatedClipIds(project, projectBinInstanceIds(clipId, project));
		if (!clipIds.length) return Object.freeze([]);
		const trackIds = [...new Set(clipIds
			.map((id) => findProjectBinClipTrack(project, id)?.id)
			.filter((id): id is string => Boolean(id)))];
		dependencies.setSelectedClipId(clipIds[0] ?? null);
		dependencies.setSelectedTrackId(trackIds[0] ?? null);
		dependencies.updateSelection({
			type: 'selection/set',
			startFrame: 0,
			endFrame: 0,
			trackIds,
			clipIds,
			frequencyRange: null,
		});
		return Object.freeze(clipIds);
	}

	function removeProjectBinSource(clipId: string): readonly string[] | null {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) return null;
		const instanceIds = projectBinInstanceIds(clipId);
		dependencies.commit({ type: 'project-bin/remove-from-project', clipId }, { selectClipId: null });
		return Object.freeze(instanceIds);
	}

	async function dispose(): Promise<void> {
		await replacement.cancelAllProjectBinReplacements();
		await preview.stopProjectBinPreview({ dispose: true });
	}
}

function previewDependencies(
	dependencies: ProjectBinServiceDependencies,
): ProjectBinPreviewDependencies {
	return {
		lifetime: dependencies.lifetime,
		copy: dependencies.copy,
		playbackEngine: dependencies.playbackEngine,
		sourceBuffers: dependencies.sourceBuffers as EngineSourceBufferInput,
		sourceChunkProviders: dependencies.sourceChunkProviders as EngineChunkSourceInput,
		sourceResolver: dependencies.sourceResolver,
		createPreviewEngine: dependencies.createPreviewEngine,
		createId: dependencies.createId,
		captureProject: dependencies.captureProject,
		assertProject: dependencies.assertProject,
		getProject: dependencies.getProject,
		getPreview: dependencies.getPreview,
		setPreview: dependencies.setPreview,
		isSourceMissing: (sourceId) => dependencies.missingSourceIds.has(sourceId),
		getVisualData: dependencies.getVisualData,
		publish: dependencies.publish,
	};
}

function collectClipTransformIds(project: ProjectBinProject, activeClipId: string): string[] {
	return (collectLegacyClipTransformIds as (
		project: ProjectBinProject,
		activeClipId: string,
	) => string[])(project, activeClipId);
}

function collectRelatedClipIds(project: ProjectBinProject, clipIds: readonly string[]): string[] {
	return (collectLegacyRelatedClipIds as (
		project: ProjectBinProject,
		clipIds: readonly string[],
	) => string[])(project, clipIds);
}
