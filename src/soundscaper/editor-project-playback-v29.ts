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
	createSoundscaperProjectFeatureCompatibilityServiceV29,
} from './editor-project-feature-compatibility-v29.ts'
import { validateSoundscaperProjectV29 } from './editor-project-v29-validation.ts'
import { projectNativePluginPlaybackV29 } from './editor-native-plugin-playback-v29.ts'

/** Apply exact V29 compatibility before any transient playback or delivery projection. */
export function createSoundscaperPlaybackProjectServiceV29(): PlaybackProjectService {
	const compatibility = createSoundscaperProjectFeatureCompatibilityServiceV29()
	return Object.freeze({
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery,
		projectForVideoRenderedFallbackDelivery,
	})

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		validateSoundscaperProjectV29(project)
		const featureRequirementsReport = compatibility.evaluate(project)
		const mediaProject = projectTrackFolderMediaStateV12(project)
		const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(mediaProject, featureRequirementsReport)
		const renderedVideo = projectFeatureVideoRenderedFallbackPlayback(
			renderedAudio.project,
			featureRequirementsReport,
		)
		const nativePlugins = projectNativePluginPlaybackV29(
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

	function projectForAudioRenderedFallbackDelivery<Project extends object>(project: Project) {
		validateSoundscaperProjectV29(project)
		const featureRequirementsReport = compatibility.evaluate(project)
		const mediaProject = projectTrackFolderMediaStateV12(project)
		const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(
			mediaProject,
			featureRequirementsReport,
		)
		return Object.freeze({
			project: inheritTrackFolderMediaStateProjectionV12(mediaProject, renderedAudio.project),
			featureRequirementsReport,
			audioRenderedFallback: renderedAudio.metadata,
			requiredAudioSourceIds: Object.freeze(
				renderedAudio.metadata ? [renderedAudio.metadata.sourceId] : [],
			),
		})
	}

	function projectForVideoRenderedFallbackDelivery<Project extends object>(project: Project) {
		validateSoundscaperProjectV29(project)
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
		return Object.freeze({
			project: inheritTrackFolderMediaStateProjectionV12(mediaProject, renderedVideo.project),
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
