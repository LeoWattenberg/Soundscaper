/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts'
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts'
import { PROJECT_OWNED_FEATURE_REQUIREMENT_IDS } from '../src/common/editor/project-owned-feature-requirements.ts'
import { FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/framescaper/editor-project-feature-capability-profile-v20.ts'
import { SOUNDSCAPER_V21_PROJECT_FEATURE_CAPABILITY_PROFILE } from '../src/soundscaper/editor-project-feature-capability-profile-v21.ts'
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts'

test('registers V21 production capability IDs with product-isolated availability', () => {
	assert.deepEqual({
		audioAutomation: PROJECT_FEATURE_CAPABILITY_IDS.audioAutomation,
		audioMixerGraph: PROJECT_FEATURE_CAPABILITY_IDS.audioMixerGraph,
		audioTrackFreeze: PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze,
	}, {
		audioAutomation: 'org.soundscaper.capability.audio-automation',
		audioMixerGraph: 'org.soundscaper.capability.audio-mixer-graph',
		audioTrackFreeze: 'org.soundscaper.capability.audio-track-freeze',
	})
	const soundscaper = editorProjectFeatureCapabilityProfileDefinition(
		SOUNDSCAPER_V21_PROJECT_FEATURE_CAPABILITY_PROFILE,
	)
	const framescaper = editorProjectFeatureCapabilityProfileDefinition(
		FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE,
	)
	for (const key of ['audioAutomation', 'audioMixerGraph', 'audioTrackFreeze']) {
		assert.equal(soundscaper.registrations.find((item) => item.key === key)?.available, true)
		assert.equal(framescaper.registrations.find((item) => item.key === key)?.available, false)
	}
})

test('nonempty lanes and an authored graph own exact bypass-only requirements', () => {
	const neutral = createSoundscaperProjectV21()
	assert.equal(neutral.featureRequirements.requirements.some(({ id }) => (
		id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioAutomation
		|| id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioMixerGraph
	)), false)
	const mixer = structuredClone(neutral.mixer)
	;(mixer.vcas as unknown as Array<Record<string, unknown>>).push({
		id: 'master-vca', name: 'Master VCA', gain: 1, mute: false, members: [{ kind: 'master' }],
	})
	const authored = createSoundscaperProjectV21({
		mixer,
		automationLanes: [{
			id: 'master-gain',
			address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [{ id: 'start', position: 0, value: 1 }],
			segments: [],
		}],
	})
	assert.deepEqual(authored.featureRequirements.requirements.filter(({ id }) => (
		id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioAutomation
		|| id === PROJECT_OWNED_FEATURE_REQUIREMENT_IDS.audioMixerGraph
	)), [
		{
			id: 'soundscaper.audio-automation',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioAutomation,
			displayName: 'Audio automation', disposition: 'bypass', fallback: null,
		},
		{
			id: 'soundscaper.audio-mixer-graph',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioMixerGraph,
			displayName: 'Audio mixer graph', disposition: 'bypass', fallback: null,
		},
	])
})
