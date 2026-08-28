/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	PlaybackProjectProjection,
	PlaybackProjectService,
} from '../common/editor/controller/playback-project-service.ts'
import { projectFeatureAudioEffectPlaybackBypass } from '../common/editor/project-feature-audio-effect-bypass.ts'
import { projectFeatureAudioRenderedFallbackPlayback } from '../common/editor/project-feature-audio-rendered-fallback.ts'
import { projectFeatureVideoEffectPlaybackBypass } from '../common/editor/project-feature-video-effect-bypass.ts'
import { projectFeatureVideoRenderedFallbackPlayback } from '../common/editor/project-feature-video-rendered-fallback.ts'
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
		const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(mediaProject, featureRequirementsReport)
		const renderedVideo = projectFeatureVideoRenderedFallbackPlayback(
			renderedAudio.project,
			featureRequirementsReport,
		)
		const nativePlugins = projectNativePluginPlayback(
			renderedVideo.project,
			featureRequirementsReport,
			renderedAudio.metadata?.role === 'audio-track-render-v1'
				? renderedAudio.metadata.targetTrackId : null,
			mediaProject,
		)
		const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(
			nativePlugins,
			featureRequirementsReport,
		)
		const bypassedVideo = projectFeatureVideoEffectPlaybackBypass(
			bypassedAudio.project,
			featureRequirementsReport,
		)
		return Object.freeze({
			project: inheritTrackFolderMediaStateProjectionV12(mediaProject, bypassedVideo.project),
			featureRequirementsReport,
			audioEffectPlaybackBypass: bypassedAudio.metadata,
			audioRenderedFallback: renderedAudio.metadata,
			videoEffectPlaybackBypass: bypassedVideo.metadata,
			videoRenderedFallback: renderedVideo.metadata,
			requiredAudioSourceIds: Object.freeze(
				renderedAudio.metadata ? [renderedAudio.metadata.sourceId] : [],
			),
			requiredVideoSourceIds: Object.freeze(
				renderedVideo.metadata ? [renderedVideo.metadata.sourceId] : [],
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
		const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(
			mediaProject,
			featureRequirementsReport,
		)
		const nativePlugins = projectNativePluginPlayback(
			renderedAudio.project,
			featureRequirementsReport,
			renderedAudio.metadata?.role === 'audio-track-render-v1'
				? renderedAudio.metadata.targetTrackId : null,
			mediaProject,
		)
		const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(
			nativePlugins,
			featureRequirementsReport,
		)
		return Object.freeze({
			project: inheritTrackFolderMediaStateProjectionV12(mediaProject, bypassedAudio.project),
			featureRequirementsReport,
			audioRenderedFallback: renderedAudio.metadata,
			requiredAudioSourceIds: Object.freeze(
				renderedAudio.metadata ? [renderedAudio.metadata.sourceId] : [],
			),
		})
	}

	function projectForVideoRenderedFallbackDelivery<Project extends object>(project: Project) {
		if (!isExactSoundscaperProject(project)) return opaque(project)
		validateSoundscaperProject(project)
		const featureRequirementsReport = compatibility.evaluate(project)
		const mediaProject = projectTrackFolderMediaStateV12(project)
		const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(
			mediaProject,
			featureRequirementsReport,
		)
		const renderedVideo = projectFeatureVideoRenderedFallbackPlayback(
			renderedAudio.project,
			featureRequirementsReport,
		)
		const nativePlugins = projectNativePluginPlayback(
			renderedVideo.project,
			featureRequirementsReport,
			renderedAudio.metadata?.role === 'audio-track-render-v1'
				? renderedAudio.metadata.targetTrackId : null,
			mediaProject,
		)
		const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(
			nativePlugins,
			featureRequirementsReport,
		)
		const bypassedVideo = projectFeatureVideoEffectPlaybackBypass(
			bypassedAudio.project,
			featureRequirementsReport,
		)
		return Object.freeze({
			project: inheritTrackFolderMediaStateProjectionV12(mediaProject, bypassedVideo.project),
			featureRequirementsReport,
			audioRenderedFallback: renderedAudio.metadata,
			videoRenderedFallback: renderedVideo.metadata,
			requiredAudioSourceIds: Object.freeze(
				renderedAudio.metadata ? [renderedAudio.metadata.sourceId] : [],
			),
			requiredVideoSourceIds: Object.freeze(
				renderedVideo.metadata ? [renderedVideo.metadata.sourceId] : [],
			),
		})
	}
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
