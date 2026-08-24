/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
} from '../common/editor/project-feature-capability-profile.ts';
import {
	PROJECT_FEATURE_CAPABILITY_IDS,
	type ProjectFeatureCapabilityKey,
} from '../common/editor/project-feature-capabilities.ts';

/**
 * V29's available set is V21's plus the feature the revision exists for.
 *
 * Mastering sequences turn on here and nowhere else: V21 documents cannot hold
 * one, so its profile still reports the capability unavailable rather than
 * absent, and a V21 project that somehow demanded it is still refused.
 */
const AVAILABLE = new Set<ProjectFeatureCapabilityKey>([
	'project', 'projectBin', 'audioImport', 'audioPlayback', 'audioTimelineEditing',
	'audioMixing', 'videoImport', 'videoPlayback', 'videoTimelineEditing', 'videoExport',
	'audioRecording', 'audioGenerators', 'audioEffects', 'audioSpectralEditing',
	'audioAnalysis', 'audioMacros', 'audioSampleEditing', 'musicalTimeline',
	'timelineAnnotations', 'trackFolders', 'takeComp', 'audioWarp', 'sequenceTiming',
	'videoTimingAssets', 'sourceCharacteristics', 'audioAutomation', 'audioMixerGraph',
	'audioTrackFreeze', 'immersiveAdm', 'masteringSequences',
]);

/** Selected exact-V29 Soundscaper capabilities. */
export const SOUNDSCAPER_V29_PROJECT_FEATURE_CAPABILITY_PROFILE =
	createEditorProjectFeatureCapabilityProfile({
		owner: 'soundscaper',
		registrations: Object.entries(PROJECT_FEATURE_CAPABILITY_IDS)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, featureId]) => ({
				key,
				featureId,
				available: AVAILABLE.has(key as ProjectFeatureCapabilityKey),
			})),
	});
