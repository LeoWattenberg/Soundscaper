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
	createSoundscaperProjectFeatureCompatibilityServiceV30,
} from './editor-project-feature-compatibility-v30.ts'
import {
	createSoundscaperOpaqueCustodyConsumerProjectV30,
} from './editor-project-opaque-custody-v30.ts'
import { SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION } from './editor-project-v30.ts'
import { validateSoundscaperProjectV30 } from './editor-project-v30-validation.ts'
import { projectNativePluginPlaybackV30 } from './editor-native-plugin-playback-v30.ts'

const EMPTY = Object.freeze([]) as readonly string[]

/** Apply exact V30 compatibility before any transient playback or delivery projection. */
export function createSoundscaperPlaybackProjectServiceV30(): PlaybackProjectService {
	const compatibility = createSoundscaperProjectFeatureCompatibilityServiceV30()
	return Object.freeze({
		projectForPlayback,
		projectForAudioRenderedFallbackDelivery,
		projectForVideoRenderedFallbackDelivery,
	})

	function projectForPlayback<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
		if (!isExactV30(project)) return opaque(project)
		validateSoundscaperProjectV30(project)
		const featureRequirementsReport = compatibility.evaluate(project)
		const mediaProject = projectTrackFolderMediaStateV12(project)
		const renderedAudio = projectFeatureAudioRenderedFallbackPlayback(mediaProject, featureRequirementsReport)
		const renderedVideo = projectFeatureVideoRenderedFallbackPlayback(
			renderedAudio.project,
			featureRequirementsReport,
		)
		const nativePlugins = projectNativePluginPlaybackV30(
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
		if (!isExactV30(project)) return opaque(project)
		validateSoundscaperProjectV30(project)
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
		if (!isExactV30(project)) return opaque(project)
		validateSoundscaperProjectV30(project)
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

function isExactV30(project: unknown): boolean {
	if (!project || typeof project !== 'object' || Array.isArray(project)) return false
	const descriptor = Object.getOwnPropertyDescriptor(project, 'schemaVersion')
	return Boolean(descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& descriptor.value === SOUNDSCAPER_PROJECT_V30_SCHEMA_VERSION)
}

function opaque<Project extends object>(project: Project): PlaybackProjectProjection<Project> {
	const shell = createSoundscaperOpaqueCustodyConsumerProjectV30(project)
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
