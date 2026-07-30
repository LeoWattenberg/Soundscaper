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
import type { PreparedRequiredProjectSources } from './source-lifecycle-service.ts';

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

export const PLAYBACK_PROJECT_APPLY_TASK = 'playback-project-apply';
const STALE_PLAYBACK_PROJECT_APPLY = Symbol('stale-playback-project-apply');

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
		options: Readonly<{
			readonly requiredAudioSourceIds: readonly string[];
			readonly signal?: AbortSignal;
		}>,
	) => PromiseLike<ReadonlyMap<unknown, unknown>> | ReadonlyMap<unknown, unknown>;
	readonly prepareRequiredProjectSources: (
		project: Project,
		options: Readonly<{
			readonly requiredAudioSourceIds: readonly string[];
			readonly signal?: AbortSignal;
		}>,
	) => PromiseLike<PreparedRequiredProjectSources> | PreparedRequiredProjectSources;
	readonly sourceBuffers: ReadonlyMap<unknown, unknown>;
	readonly sourceChunkProviders: ReadonlyMap<unknown, unknown>;
	readonly engine: PlaybackProjectEngine<Project>;
	readonly setReadyStatus: () => void;
}

export interface ApplyCanonicalProjectOptions {
	readonly signal?: AbortSignal;
}

export interface PlaybackProjectApplyServiceRuntime<Project extends object>
	extends ApplyCanonicalProjectRuntime<Project> {
	readonly lifetime: Readonly<{
		startTask(name: string): Readonly<{
			readonly signal: AbortSignal;
			finish(): void;
		}>;
	}>;
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

/** Own each playback reapply as one replaceable controller-lifetime task. */
export function createPlaybackProjectApplyService<Project extends object>(
	runtime: PlaybackProjectApplyServiceRuntime<Project>,
) {
	return Object.freeze({ apply });

	async function apply(project: Project): Promise<boolean> {
		const task = runtime.lifetime.startTask(PLAYBACK_PROJECT_APPLY_TASK);
		try {
			return await applyCanonicalProjectToPlaybackEngine(project, runtime, { signal: task.signal });
		} finally {
			task.finish();
		}
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
	options: ApplyCanonicalProjectOptions = {},
): Promise<boolean> {
	throwIfPlaybackProjectApplyAborted(options.signal);
	const previousPlayback = runtime.engine.getState();
	const projection = runtime.projectForPlayback(canonicalProject);
	const preparedSources = projection.requiredAudioSourceIds.length
		? await runtime.prepareRequiredProjectSources(projection.project, {
			requiredAudioSourceIds: projection.requiredAudioSourceIds,
			signal: options.signal,
		})
		: null;
	try {
		const transientBuffers = preparedSources
			? new Map<unknown, unknown>()
			: await runtime.ensureProjectSourcesAvailable(projection.project, {
				requiredAudioSourceIds: projection.requiredAudioSourceIds,
				signal: options.signal,
			});
		throwIfPlaybackProjectApplyAborted(options.signal);
		if (runtime.getCurrentProject() !== canonicalProject) return false;
		if (preparedSources) {
			await preparedSources.commit((inputs) => runtime.engine.applyProject(
				projection.project,
				inputs.sourceBuffers,
				{ chunkSources: inputs.chunkSources },
			), {
				assertCurrent() {
					if (runtime.getCurrentProject() !== canonicalProject) throw STALE_PLAYBACK_PROJECT_APPLY;
				},
			});
		} else {
			const playbackBuffers = transientBuffers.size
				? new Map([...runtime.sourceBuffers, ...transientBuffers])
				: runtime.sourceBuffers;
			await runtime.engine.applyProject(projection.project, playbackBuffers, {
				chunkSources: runtime.sourceChunkProviders,
			});
		}
		throwIfPlaybackProjectApplyAborted(options.signal);
		if (runtime.getCurrentProject() !== canonicalProject) return false;
		if (
			previousPlayback.state === 'playing'
			&& previousPlayback.playbackMode === 'staffpad'
			&& runtime.engine.getState().state !== 'playing'
		) runtime.setReadyStatus();
		return true;
	} catch (error) {
		if (error === STALE_PLAYBACK_PROJECT_APPLY) return false;
		throw error;
	} finally {
		preparedSources?.discard();
	}
}

function throwIfPlaybackProjectApplyAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason;
}
