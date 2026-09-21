/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/source/playback-project-service.ts'
import type { ProjectFeatureAudioRenderedFallbackMetadata } from '../common/editor/project-feature-audio-rendered-fallback.ts'
import {
	composeProjectFeatureAudioPlaybackProjection,
	composeProjectFeaturePlaybackProjection,
} from '../common/editor/project-feature-playback-projection.ts'
import type { ProjectFeatureRequirementsReport } from '../common/editor/project-feature-requirements.ts'
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../common/editor/track-folder-media-runtime.ts'
import {
	createSoundscaperProjectFeatureCompatibilityService,
} from './editor-project-feature-compatibility.ts'
import {
	createSoundscaperOpaqueCustodyConsumerProject,
} from './editor-project-opaque-custody.ts'
import {
	SOUNDSCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from '../common/editor/project-schema-identity.ts'
import { validateSoundscaperProject } from './editor-project-validation.ts'
import { projectNativePluginPlayback } from './editor-native-plugin-playback.ts'

const EMPTY = Object.freeze([]) as readonly string[]

/** Apply exact baseline compatibility before any transient playback or delivery projection. */
export function createSoundscaperPlaybackProjectService(): PlaybackProjectService {
	const compatibility = createSoundscaperProjectFeatureCompatibilityService()
	return Object.freeze({
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery,
		projectForVideoRenderedFallbackDelivery,
	})

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!isExactSoundscaperProject(project)) return opaque(project)
		validateSoundscaperProject(project)
		const featureRequirementsReport = compatibility.evaluate(project)
		const mediaProject = projectTrackFolderMediaStateV12(project)
		const features = composeProjectFeaturePlaybackProjection(mediaProject, featureRequirementsReport, {
			productProjection: nativePluginPlaybackProjection(mediaProject, featureRequirementsReport),
		})
		return Object.freeze({
			project: inheritTrackFolderMediaStateProjectionV12(mediaProject, features.project),
			featureRequirementsReport,
			audioEffectPlaybackBypass: features.audioEffectPlaybackBypass,
			audioRenderedFallback: features.audioRenderedFallback,
			videoEffectPlaybackBypass: features.videoEffectPlaybackBypass,
			videoRenderedFallback: features.videoRenderedFallback,
			requiredAudioSourceIds: Object.freeze(
				features.audioRenderedFallback ? [features.audioRenderedFallback.sourceId] : [],
			),
			requiredVideoSourceIds: Object.freeze(
				features.videoRenderedFallback ? [features.videoRenderedFallback.sourceId] : [],
			),
		}) as PlaybackProjectProjection<Project>
	}

	// Playback and export are the same render: delivery reapplies the exact
	// native-plug-in and effect bypasses playback applied, so a bypassed effect
	// never reappears in the delivered file.
	function projectForAudioRenderedFallbackDelivery<Project extends object>(project: Project) {
		if (!isExactSoundscaperProject(project)) return opaque(project)
		validateSoundscaperProject(project)
		const featureRequirementsReport = compatibility.evaluate(project)
		const mediaProject = projectTrackFolderMediaStateV12(project)
		const features = composeProjectFeatureAudioPlaybackProjection(mediaProject, featureRequirementsReport, {
			productProjection: nativePluginPlaybackProjection(mediaProject, featureRequirementsReport),
		})
		return Object.freeze({
			project: inheritTrackFolderMediaStateProjectionV12(mediaProject, features.project),
			featureRequirementsReport,
			audioRenderedFallback: features.audioRenderedFallback,
			requiredAudioSourceIds: Object.freeze(
				features.audioRenderedFallback ? [features.audioRenderedFallback.sourceId] : [],
			),
		})
	}

	function projectForVideoRenderedFallbackDelivery<Project extends object>(project: Project) {
		if (!isExactSoundscaperProject(project)) return opaque(project)
		validateSoundscaperProject(project)
		const featureRequirementsReport = compatibility.evaluate(project)
		const mediaProject = projectTrackFolderMediaStateV12(project)
		const features = composeProjectFeaturePlaybackProjection(mediaProject, featureRequirementsReport, {
			productProjection: nativePluginPlaybackProjection(mediaProject, featureRequirementsReport),
		})
		return Object.freeze({
			project: inheritTrackFolderMediaStateProjectionV12(mediaProject, features.project),
			featureRequirementsReport,
			audioRenderedFallback: features.audioRenderedFallback,
			videoRenderedFallback: features.videoRenderedFallback,
			requiredAudioSourceIds: Object.freeze(
				features.audioRenderedFallback ? [features.audioRenderedFallback.sourceId] : [],
			),
			requiredVideoSourceIds: Object.freeze(
				features.videoRenderedFallback ? [features.videoRenderedFallback.sourceId] : [],
			),
		})
	}
}

function nativePluginPlaybackProjection<Project extends object>(
	canonicalProject: Project,
	report: ProjectFeatureRequirementsReport | null,
): (
	project: Project,
	context: Readonly<{
		readonly audioRenderedFallback: ProjectFeatureAudioRenderedFallbackMetadata | null;
	}>,
) => Project {
	return (project, { audioRenderedFallback }) => projectNativePluginPlayback(
		project,
		report,
		audioRenderedFallback?.role === 'audio-track-render-v1'
			? audioRenderedFallback.targetTrackId : null,
		canonicalProject,
	)
}

function isExactSoundscaperProject(project: unknown): boolean {
	return isCurrentProjectSchemaIdentity(project, SOUNDSCAPER_PROJECT_SCHEMA_FAMILY)
}

function opaque<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
	const shell = createSoundscaperOpaqueCustodyConsumerProject(project)
	return Object.freeze({
		project: shell as unknown as Project,
		featureRequirementsReport: null,
		audioEffectPlaybackBypass: null,
		audioRenderedFallback: null,
		videoEffectPlaybackBypass: null,
		videoRenderedFallback: null,
		requiredAudioSourceIds: EMPTY,
		requiredVideoSourceIds: EMPTY,
	})
}
