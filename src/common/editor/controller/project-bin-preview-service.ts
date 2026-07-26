/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV5 } from '../project-v5.js';
import type {
	EngineChunkSourceInput,
	EngineLoadProjectOptions,
	EngineSourceBufferInput,
} from '../engine/public-api.ts';
import type { EngineProject, EngineSourceResolver } from '../engine/types.ts';
import type {
	EditorControllerLifetime,
	EditorProjectToken,
	EditorTaskScope,
} from './lifecycle.ts';
import {
	findProjectBinClip,
	findProjectBinSource,
	projectBinClips,
	type ProjectBinCopy,
	type ProjectBinPreview,
	type ProjectBinProject,
	type ProjectBinVisualData,
} from './project-bin-types.ts';

const PROJECT_BIN_PREVIEW_TASK = 'project-bin-preview';

export interface ProjectBinPlaybackEngine {
	getState(): Readonly<{ state: string }>;
	stop(): void;
}

export interface ProjectBinPreviewEngine {
	loadProject(
		project: EngineProject | null,
		sourceBuffers?: EngineSourceBufferInput,
		options?: EngineLoadProjectOptions,
	): unknown;
	setSourceResolver?(resolver?: EngineSourceResolver | null): unknown;
	play(): Promise<void>;
	pause(): void;
	stop?(): void;
	dispose?(): Promise<void> | void;
}

export interface ProjectBinPreviewDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly copy: Pick<ProjectBinCopy, 'audioClipNotFound' | 'localSourcesMissing'>;
	readonly playbackEngine: ProjectBinPlaybackEngine;
	readonly sourceBuffers: EngineSourceBufferInput;
	readonly sourceChunkProviders: EngineChunkSourceInput;
	readonly sourceResolver?: EngineSourceResolver | null;
	createPreviewEngine(options: Readonly<{ onState(state: string): void }>): ProjectBinPreviewEngine;
	createId(prefix: string): string;
	captureProject(): EditorProjectToken;
	assertProject(token: EditorProjectToken): void;
	getProject(): ProjectBinProject;
	getPreview(): ProjectBinPreview | null;
	setPreview(preview: ProjectBinPreview | null): void;
	isSourceMissing(sourceId: string): boolean;
	getVisualData(clipId: string): ProjectBinVisualData | null;
	publish(): void;
}

export interface ProjectBinPreviewService {
	playPauseProjectBinClip(clipId: string): Promise<ProjectBinPreview>;
	stopProjectBinPreview(options?: Readonly<{ dispose?: boolean }>): Promise<boolean>;
}

export function createProjectBinPreviewService(
	dependencies: ProjectBinPreviewDependencies,
): Readonly<ProjectBinPreviewService> {
	let previewEngine: ProjectBinPreviewEngine | null = null;

	return Object.freeze({
		playPauseProjectBinClip,
		stopProjectBinPreview,
	});

	async function playPauseProjectBinClip(clipId: string): Promise<ProjectBinPreview> {
		dependencies.lifetime.assertActive();
		const project = dependencies.getProject();
		const clip = findProjectBinClip(project, clipId);
		if (!clip) throw new Error(dependencies.copy.audioClipNotFound);
		const itemClips = project.schemaVersion >= 4
			? projectBinClips(project).filter((candidate) => candidate.binItemId === clip.binItemId)
			: [clip];
		const videoClip = itemClips.find((candidate) => candidate.kind === 'video') ?? null;
		const active = dependencies.getPreview();
		if (active?.clipId === clipId) return toggleActivePreview(active, Boolean(videoClip));

		await stopProjectBinPreview();
		const projectToken = dependencies.captureProject();
		dependencies.assertProject(projectToken);
		if (dependencies.playbackEngine.getState().state === 'playing') dependencies.playbackEngine.stop();
		if (videoClip) {
			const visual = dependencies.getVisualData(clipId);
			const preview = Object.freeze({
				clipId,
				binItemId: clip.binItemId || clip.id,
				state: 'playing' as const,
				kind: 'video' as const,
				mediaUrl: visual?.mediaUrl || null,
			});
			dependencies.setPreview(preview);
			dependencies.publish();
			return preview;
		}

		const audioClip = itemClips.find((candidate) => candidate.kind !== 'video') ?? clip;
		const source = findProjectBinSource(project, audioClip.sourceId);
		if (!source || dependencies.isSourceMissing(source.id)) {
			throw new Error(dependencies.copy.localSourcesMissing);
		}
		const task = dependencies.lifetime.startTask(PROJECT_BIN_PREVIEW_TASK);
		try {
			previewEngine ??= dependencies.createPreviewEngine({ onState: handlePreviewState });
			previewEngine.setSourceResolver?.(dependencies.sourceResolver);
			const previewTrackId = dependencies.createId('project-bin-preview-track');
			const previewClip = {
				...audioClip,
				id: dependencies.createId('project-bin-preview-clip'),
				timelineStartFrame: 0,
				groupId: null,
				avLinkId: null,
				binItemId: null,
			};
			const previewProject = createAudioEditorProjectV5({
				title: 'Project Bin preview',
				sampleRate: project.sampleRate,
				sources: [source],
				clips: [previewClip],
				tracks: [{
					type: 'audio',
					id: previewTrackId,
					name: previewClip.title,
					clipIds: [previewClip.id],
					armed: false,
				}],
				projectBin: { clips: [] },
			}) as EngineProject;
			previewEngine.loadProject(previewProject, dependencies.sourceBuffers, {
				chunkSources: dependencies.sourceChunkProviders,
			});
			const preview = Object.freeze({
				clipId,
				binItemId: clip.binItemId || clip.id,
				state: 'playing' as const,
				kind: 'audio' as const,
			});
			dependencies.setPreview(preview);
			dependencies.publish();
			await previewEngine.play();
			assertCurrent(task, projectToken);
			return dependencies.getPreview() ?? preview;
		} finally {
			task.finish();
		}
	}

	async function toggleActivePreview(
		active: ProjectBinPreview,
		video: boolean,
	): Promise<ProjectBinPreview> {
		if (active.state === 'playing') {
			previewEngine?.pause();
			const paused = Object.freeze({ ...active, state: 'paused' as const });
			dependencies.setPreview(paused);
			dependencies.publish();
			return paused;
		}
		if (video) {
			const playing = Object.freeze({ ...active, state: 'playing' as const });
			dependencies.setPreview(playing);
			dependencies.publish();
			return playing;
		}
		const projectToken = dependencies.captureProject();
		const task = dependencies.lifetime.startTask(PROJECT_BIN_PREVIEW_TASK);
		try {
			await previewEngine?.play();
			assertCurrent(task, projectToken);
			const playing = Object.freeze({ ...active, state: 'playing' as const });
			dependencies.setPreview(playing);
			dependencies.publish();
			return playing;
		} finally {
			task.finish();
		}
	}

	async function stopProjectBinPreview(
		{ dispose = false }: Readonly<{ dispose?: boolean }> = {},
	): Promise<boolean> {
		dependencies.lifetime.cancelTask(PROJECT_BIN_PREVIEW_TASK);
		const changed = Boolean(dependencies.getPreview());
		dependencies.setPreview(null);
		if (changed && !dependencies.lifetime.inactive) dependencies.publish();
		const engineToStop = previewEngine;
		if (!engineToStop) return changed;
		if (dispose) previewEngine = null;
		engineToStop.stop?.();
		if (dispose) await engineToStop.dispose?.();
		return changed;
	}

	function handlePreviewState(state: string): void {
		const active = dependencies.getPreview();
		if (dependencies.lifetime.inactive || !active || active.kind !== 'audio' || state === 'playing') return;
		dependencies.setPreview(Object.freeze({
			...active,
			state: state === 'paused' ? 'paused' : 'stopped',
		}));
		dependencies.publish();
	}

	function assertCurrent(task: EditorTaskScope, projectToken: EditorProjectToken): void {
		task.assertCurrent();
		dependencies.assertProject(projectToken);
	}
}
