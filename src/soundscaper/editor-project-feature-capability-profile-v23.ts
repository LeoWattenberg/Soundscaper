/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectFeatureCapabilityProfile,
} from '../common/editor/project-feature-capability-profile.ts';
import {
	PROJECT_FEATURE_CAPABILITY_IDS,
	type ProjectFeatureCapabilityKey,
} from '../common/editor/project-feature-capabilities.ts';

/**
 * V23's available set is V21's. Mastering sequences are deliberately absent, so
 * the capability registers as unavailable: the revision may exist and validate
 * long before the product offers the feature.
 */
const AVAILABLE = new Set<ProjectFeatureCapabilityKey>([
	'project', 'projectBin', 'audioImport', 'audioPlayback', 'audioTimelineEditing',
	'audioMixing', 'videoImport', 'videoPlayback', 'videoTimelineEditing', 'videoExport',
	'audioRecording', 'audioGenerators', 'audioEffects', 'audioSpectralEditing',
	'audioAnalysis', 'audioMacros', 'audioSampleEditing', 'musicalTimeline',
	'timelineAnnotations', 'trackFolders', 'takeComp', 'audioWarp', 'sequenceTiming',
	'videoTimingAssets', 'sourceCharacteristics', 'audioAutomation', 'audioMixerGraph',
	'audioTrackFreeze',
]);

/** Selected exact-V23 Soundscaper capabilities. */
export const SOUNDSCAPER_V23_PROJECT_FEATURE_CAPABILITY_PROFILE =
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
