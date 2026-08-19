/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
} from '../common/editor/project-feature-capability-profile.ts';

/** Unselected exact V20 capabilities; availability does not select a product route. */
export const FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'framescaper',
		registrations: [
			{ key: 'audioAnalysis', featureId: 'org.soundscaper.capability.audio-analysis', available: false },
			{ key: 'audioAutomation', featureId: 'org.soundscaper.capability.audio-automation', available: false },
			{ key: 'audioEffects', featureId: 'org.soundscaper.capability.audio-effects', available: false },
			{ key: 'audioGenerators', featureId: 'org.soundscaper.capability.audio-generators', available: false },
			{ key: 'audioImport', featureId: 'org.soundscaper.capability.audio-import', available: true },
			{ key: 'audioMacros', featureId: 'org.soundscaper.capability.audio-macros', available: false },
			{ key: 'audioMixerGraph', featureId: 'org.soundscaper.capability.audio-mixer-graph', available: false },
			{ key: 'audioMixing', featureId: 'org.soundscaper.capability.audio-mixing', available: true },
			{ key: 'audioPlayback', featureId: 'org.soundscaper.capability.audio-playback', available: true },
			{ key: 'audioRecording', featureId: 'org.soundscaper.capability.audio-recording', available: false },
			{ key: 'audioSampleEditing', featureId: 'org.soundscaper.capability.audio-sample-editing', available: false },
			{ key: 'audioSpectralEditing', featureId: 'org.soundscaper.capability.audio-spectral-editing', available: false },
			{ key: 'audioTimelineEditing', featureId: 'org.soundscaper.capability.audio-timeline-editing', available: true },
			{ key: 'audioTrackFreeze', featureId: 'org.soundscaper.capability.audio-track-freeze', available: false },
			{ key: 'audioWarp', featureId: 'org.soundscaper.capability.audio-warp', available: false },
			{ key: 'immersiveAdm', featureId: 'org.soundscaper.capability.immersive-adm', available: false },
			{ key: 'masteringSequences', featureId: 'org.soundscaper.capability.mastering-sequences', available: false },
			{ key: 'multicamera', featureId: 'org.soundscaper.capability.multicamera', available: true },
			{ key: 'musicalTimeline', featureId: 'org.soundscaper.capability.musical-timeline', available: false },
			{ key: 'nestedSequences', featureId: 'org.soundscaper.capability.nested-sequences', available: true },
			{ key: 'project', featureId: 'org.soundscaper.capability.project', available: true },
			{ key: 'projectBin', featureId: 'org.soundscaper.capability.project-bin', available: true },
			{ key: 'sequenceTiming', featureId: 'org.soundscaper.capability.sequence-timing', available: true },
			{ key: 'sourceCharacteristics', featureId: 'org.soundscaper.capability.source-characteristics', available: true },
			{ key: 'takeComp', featureId: 'org.soundscaper.capability.take-comp', available: false },
			{ key: 'timelineAnnotations', featureId: 'org.soundscaper.capability.timeline-annotations', available: false },
			{ key: 'trackFolders', featureId: 'org.soundscaper.capability.track-folders', available: false },
			{ key: 'videoCompositing', featureId: 'org.soundscaper.capability.video-compositing', available: true },
			{ key: 'videoEffects', featureId: 'org.soundscaper.capability.video-effects', available: true },
			{ key: 'videoExport', featureId: 'org.soundscaper.capability.video-export', available: true },
			{ key: 'videoGeometry', featureId: 'org.soundscaper.capability.video-geometry', available: true },
			{ key: 'videoImport', featureId: 'org.soundscaper.capability.video-import', available: true },
			{ key: 'videoKeyframes', featureId: 'org.soundscaper.capability.video-keyframes', available: false },
			{ key: 'videoPlayback', featureId: 'org.soundscaper.capability.video-playback', available: true },
			{ key: 'videoProxy', featureId: 'org.soundscaper.capability.video-proxy', available: true },
			{ key: 'videoRetime', featureId: 'org.soundscaper.capability.video-retime', available: false },
			{ key: 'videoTimelineEditing', featureId: 'org.soundscaper.capability.video-timeline-editing', available: true },
			{ key: 'videoTimingAssets', featureId: 'org.soundscaper.capability.video-timing-assets', available: true },
		],
	});
