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
	createSoundscaperProjectFeatureCompatibilityServiceV23,
} from './editor-project-feature-compatibility-v23.ts'
import { validateSoundscaperProjectV23 } from './editor-project-v23-validation.ts'

/** Apply exact V23 compatibility before any transient playback or delivery projection. */
export function createSoundscaperPlaybackProjectServiceV23(): PlaybackProjectService {
	const compatibility = createSoundscaperProjectFeatureCompatibilityServiceV23()
	return Object.freeze({
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery,
		projectForVideoRenderedFallbackDelivery,
	})

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		validateSoundscaperProjectV23(project)
		const featureRequirementsReport = compatibility.evaluate(project)
		const mediaProject = projectTrackFolderMediaStateV12(project)
		const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(mediaProject, featureRequirementsReport)
		const renderedVideo = projectFeatureVideoRenderedFallbackPlayback(
			renderedAudio.project,
			featureRequirementsReport,
		)
		const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(
			renderedVideo.project,
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
	// effect bypasses playback applied, so a bypassed effect never reappears
	// in the delivered file.
	function projectForAudioRenderedFallbackDelivery<Project extends object>(project: Project) {
		validateSoundscaperProjectV23(project)
		const featureRequirementsReport = compatibility.evaluate(project)
		const mediaProject = projectTrackFolderMediaStateV12(project)
		const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(
			mediaProject,
			featureRequirementsReport,
		)
		const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(
			renderedAudio.project,
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
		validateSoundscaperProjectV23(project)
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
		const bypassedAudio = projectFeatureAudioEffectPlaybackBypass(
			renderedVideo.project,
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
