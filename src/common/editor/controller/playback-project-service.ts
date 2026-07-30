/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	projectFeatureAudioRenderedFallbackPlayback,
	type ProjectFeatureAudioRenderedFallbackMetadata,
} from '../project-feature-audio-rendered-fallback.ts';
import {
	projectFeatureAudioEffectPlaybackBypass,
	type ProjectFeatureAudioEffectBypassMetadata,
} from '../project-feature-audio-effect-bypass.ts';
import type { ProjectFeatureRequirementsReport } from '../project-feature-requirements.ts';
import {
	projectFeatureVideoEffectPlaybackBypass,
	type ProjectFeatureVideoEffectBypassMetadata,
} from '../project-feature-video-effect-bypass.ts';
import { createProjectFeatureCompatibilityService } from './project-feature-compatibility-service.ts';

export interface PlaybackProjectProjection<Project extends object> {
	readonly project: Project;
	readonly featureRequirementsReport: ProjectFeatureRequirementsReport | null;
	readonly audioEffectPlaybackBypass: ProjectFeatureAudioEffectBypassMetadata | null;
	readonly audioRenderedFallback: ProjectFeatureAudioRenderedFallbackMetadata | null;
	readonly videoEffectPlaybackBypass: ProjectFeatureVideoEffectBypassMetadata | null;
	readonly requiredAudioSourceIds: readonly string[];
}

export interface PlaybackProjectService {
	projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project>;
}

interface PlaybackEngineState {
	readonly state?: unknown;
	readonly playbackMode?: unknown;
}

interface PlaybackProjectEngine<Project extends object> {
	getState(): PlaybackEngineState;
	applyProject(
		project: Project,
		sourceBuffers: ReadonlyMap<unknown, unknown>,
		options: Readonly<{ chunkSources: ReadonlyMap<unknown, unknown> }>,
	): PromiseLike<unknown> | unknown;
}

export interface ApplyCanonicalProjectRuntime<Project extends object> {
	readonly projectForPlayback: (project: Project) => PlaybackProjectProjection<Project>;
	readonly getCurrentProject: () => Project | null;
	readonly ensureProjectSourcesAvailable: (
		project: Project,
		options: Readonly<{ requiredAudioSourceIds: readonly string[] }>,
	) => PromiseLike<ReadonlyMap<unknown, unknown>> | ReadonlyMap<unknown, unknown>;
	readonly sourceBuffers: ReadonlyMap<unknown, unknown>;
	readonly sourceChunkProviders: ReadonlyMap<unknown, unknown>;
	readonly engine: PlaybackProjectEngine<Project>;
	readonly setReadyStatus: () => void;
}

/** Compose every maintained transient project feature for editor playback. */
export function createPlaybackProjectService(
	capabilities: Readonly<Record<string, unknown>>,
): PlaybackProjectService {
	const compatibility = createProjectFeatureCompatibilityService(capabilities);
	return Object.freeze({ projectForPlayback });

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		const featureRequirementsReport = compatibility.evaluate(project);
		const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(project, featureRequirementsReport);
		const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(
			renderedAudio.project,
			featureRequirementsReport,
		);
		const bypassedVideo = projectFeatureVideoEffectPlaybackBypass(
			bypassedAudio.project,
			featureRequirementsReport,
		);
		return Object.freeze({
			project: bypassedVideo.project,
			featureRequirementsReport,
			audioEffectPlaybackBypass: bypassedAudio.metadata,
			audioRenderedFallback: renderedAudio.metadata,
			videoEffectPlaybackBypass: bypassedVideo.metadata,
			requiredAudioSourceIds: Object.freeze(
				renderedAudio.metadata ? [renderedAudio.metadata.sourceId] : [],
			),
		});
	}
}

/**
 * Reapply one canonical snapshot through the same transient feature projection
 * used during activation. The identity check remains against the canonical
 * object so a stale preparation can never overwrite a newer project.
 */
export async function applyCanonicalProjectToPlaybackEngine<Project extends object>(
	canonicalProject: Project,
	runtime: ApplyCanonicalProjectRuntime<Project>,
): Promise<boolean> {
	const previousPlayback = runtime.engine.getState();
	const projection = runtime.projectForPlayback(canonicalProject);
	const transientBuffers = await runtime.ensureProjectSourcesAvailable(projection.project, {
		requiredAudioSourceIds: projection.requiredAudioSourceIds,
	});
	if (runtime.getCurrentProject() !== canonicalProject) return false;
	const playbackBuffers = transientBuffers.size
		? new Map([...runtime.sourceBuffers, ...transientBuffers])
		: runtime.sourceBuffers;
	await runtime.engine.applyProject(projection.project, playbackBuffers, {
		chunkSources: runtime.sourceChunkProviders,
	});
	if (
		previousPlayback.state === 'playing'
		&& previousPlayback.playbackMode === 'staffpad'
		&& runtime.engine.getState().state !== 'playing'
	) runtime.setReadyStatus();
	return true;
}
