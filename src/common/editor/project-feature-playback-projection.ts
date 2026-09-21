/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	projectFeatureAudioEffectPlaybackBypass,
	type ProjectFeatureAudioEffectBypassMetadata,
} from './project-feature-audio-effect-bypass.ts';
import {
	projectFeatureAudioRenderedFallbackPlayback,
	type ProjectFeatureAudioRenderedFallbackMetadata,
} from './project-feature-audio-rendered-fallback.ts';
import type { ProjectFeatureRequirementsReport } from './project-feature-requirement-types.ts';
import {
	projectFeatureVideoEffectPlaybackBypass,
	type ProjectFeatureVideoEffectBypassMetadata,
} from './project-feature-video-effect-bypass.ts';
import {
	projectFeatureVideoRenderedFallbackPlayback,
	type ProjectFeatureVideoRenderedFallbackMetadata,
} from './project-feature-video-rendered-fallback.ts';

export interface ComposedProjectFeaturePlaybackProjection<Project extends object> {
	readonly project: Project;
	readonly audioRenderedFallback: ProjectFeatureAudioRenderedFallbackMetadata | null;
	readonly videoRenderedFallback: ProjectFeatureVideoRenderedFallbackMetadata | null;
	readonly audioEffectPlaybackBypass: ProjectFeatureAudioEffectBypassMetadata | null;
	readonly videoEffectPlaybackBypass: ProjectFeatureVideoEffectBypassMetadata | null;
}

export interface ComposedProjectFeatureAudioPlaybackProjection<Project extends object> {
	readonly project: Project;
	readonly audioRenderedFallback: ProjectFeatureAudioRenderedFallbackMetadata | null;
	readonly audioEffectPlaybackBypass: ProjectFeatureAudioEffectBypassMetadata | null;
}

export interface ProjectFeaturePlaybackProjectionOptions<Project extends object> {
	readonly productProjection?: (
		project: Project,
		context: Readonly<{
			readonly report: ProjectFeatureRequirementsReport | null | undefined;
			readonly audioRenderedFallback: ProjectFeatureAudioRenderedFallbackMetadata | null;
			readonly videoRenderedFallback: ProjectFeatureVideoRenderedFallbackMetadata | null;
		}>,
	) => Project;
}

export interface ProjectFeatureAudioPlaybackProjectionOptions<Project extends object> {
	readonly productProjection?: (
		project: Project,
		context: Readonly<{
			readonly report: ProjectFeatureRequirementsReport | null | undefined;
			readonly audioRenderedFallback: ProjectFeatureAudioRenderedFallbackMetadata | null;
		}>,
	) => Project;
}

/** Compose audio/video fallbacks, an optional product projection, then both bypasses. */
export function composeProjectFeaturePlaybackProjection<Project extends object>(
	project: Project,
	report: ProjectFeatureRequirementsReport | null | undefined,
	options: ProjectFeaturePlaybackProjectionOptions<Project> = {},
): ComposedProjectFeaturePlaybackProjection<Project> {
	const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(project, report);
	const renderedVideo = projectFeatureVideoRenderedFallbackPlayback(renderedAudio.project, report);
	const productProject = options.productProjection?.(renderedVideo.project, Object.freeze({
		report,
		audioRenderedFallback: renderedAudio.metadata,
		videoRenderedFallback: renderedVideo.metadata,
	})) ?? renderedVideo.project;
	const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(productProject, report);
	const bypassedVideo = projectFeatureVideoEffectPlaybackBypass(bypassedAudio.project, report);
	return Object.freeze({
		project: bypassedVideo.project,
		audioRenderedFallback: renderedAudio.metadata,
		videoRenderedFallback: renderedVideo.metadata,
		audioEffectPlaybackBypass: bypassedAudio.metadata,
		videoEffectPlaybackBypass: bypassedVideo.metadata,
	});
}

/** Compose the audio-only delivery path with the product projection in the same slot. */
export function composeProjectFeatureAudioPlaybackProjection<Project extends object>(
	project: Project,
	report: ProjectFeatureRequirementsReport | null | undefined,
	options: ProjectFeatureAudioPlaybackProjectionOptions<Project> = {},
): ComposedProjectFeatureAudioPlaybackProjection<Project> {
	const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(project, report);
	const productProject = options.productProjection?.(renderedAudio.project, Object.freeze({
		report,
		audioRenderedFallback: renderedAudio.metadata,
	})) ?? renderedAudio.project;
	const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(productProject, report);
	return Object.freeze({
		project: bypassedAudio.project,
		audioRenderedFallback: renderedAudio.metadata,
		audioEffectPlaybackBypass: bypassedAudio.metadata,
	});
}
