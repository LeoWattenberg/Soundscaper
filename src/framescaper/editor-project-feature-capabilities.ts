/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectFeatureCapabilityProfile } from
	'../common/editor/project-feature-capability-profile.ts';

const FEATURE_PREFIX = 'org.soundscaper.capability.';

/** Closed capability truth for the Framescaper 1.0 document family. */
export const FRAMESCAPER_PROJECT_FEATURE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: [
			capability('assistanceAssets', 'assistance-assets', true),
			capability('audioAnalysis', 'audio-analysis', false),
			capability('audioAutomation', 'audio-automation', true),
			capability('audioEffects', 'audio-effects', false),
			capability('audioGenerators', 'audio-generators', false),
			capability('audioImport', 'audio-import', true),
			capability('audioMacros', 'audio-macros', false),
			capability('audioMixerGraph', 'audio-mixer-graph', true),
			capability('audioMixing', 'audio-mixing', true),
			capability('audioPlayback', 'audio-playback', true),
			capability('audioRecording', 'audio-recording', false),
			capability('audioSampleEditing', 'audio-sample-editing', false),
			capability('audioSpectralEditing', 'audio-spectral-editing', false),
			capability('audioTimelineEditing', 'audio-timeline-editing', true),
			capability('audioTrackFreeze', 'audio-track-freeze', false),
			capability('audioWarp', 'audio-warp', false),
			capability('immersiveAdm', 'immersive-adm', false),
			capability('masteringSequences', 'mastering-sequences', false),
			capability('multicamera', 'multicamera', true),
			capability('musicalTimeline', 'musical-timeline', false),
			capability('nestedSequences', 'nested-sequences', true),
			capability('ofxEffects', 'openfx-effects', true),
			capability('project', 'project', true),
			capability('projectBin', 'project-bin', true),
			capability('sequenceTiming', 'sequence-timing', true),
			capability('sourceCharacteristics', 'source-characteristics', true),
			capability('takeComp', 'take-comp', false),
			capability('timelineAnnotations', 'timeline-annotations', true),
			capability('timelineImages', 'timeline-images-v1', true),
			capability('trackFolders', 'track-folders', false),
			capability('videoAdjustmentLayers', 'video-adjustment-layers', true),
			capability('videoCaptions', 'video-captions', true),
			capability('videoColorManagement', 'video-color-management', true),
			capability('videoCompositing', 'video-compositing', true),
			capability('videoDenoise', 'video-denoise', true),
			capability('videoEffects', 'video-effects', true),
			capability('videoExport', 'video-export', true),
			capability('videoFreeze', 'video-freeze', true),
			capability('videoGenerators', 'video-generators', true),
			capability('videoGeometry', 'video-geometry', true),
			capability('videoGrading', 'video-grading', true),
			capability('videoImport', 'video-import', true),
			capability('videoKeyframes', 'video-keyframes', true),
			capability('videoMasksMattes', 'video-masks-mattes', true),
			capability('videoMotionTracking', 'video-motion-tracking', true),
			capability('videoPlayback', 'video-playback', true),
			capability('videoProxy', 'video-proxy', true),
			capability('videoRetime', 'video-retime', true),
			capability('videoStabilization', 'video-stabilization', true),
			capability('videoStills', 'video-stills', true),
			capability('videoTimelineEditing', 'video-timeline-editing', true),
			capability('videoTimingAssets', 'video-timing-assets', true),
			capability('videoTransitionDissolve', 'video-transition.dissolve', true),
			capability('videoTransitions', 'video-transitions', true),
		],
	});

function capability(key: string, suffix: string, available: boolean) {
	return Object.freeze({ key, featureId: `${FEATURE_PREFIX}${suffix}`, available });
}
