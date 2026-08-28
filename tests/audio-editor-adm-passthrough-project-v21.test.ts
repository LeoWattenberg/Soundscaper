/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'
import { isNeutralAdmSignalPath } from '../src/common/editor/adm-passthrough-project.ts'
import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts'
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts'

function projectWithAudioTrack() {
	return createSoundscaperProject({
		id: 'adm-v21',
		title: 'ADM V21',
		now: '2026-08-14T00:00:00.000Z',
		tracks: [{
			id: 'track-1',
			type: 'audio',
			name: 'Track 1',
			clipIds: [],
		}],
		mixer: createDefaultMixerGraphV21([{ id: 'track-1', channelCount: 2 }], 2),
	})
}

test('exact V21 default routing is a neutral ADM passthrough signal path', () => {
	const project = projectWithAudioTrack()
	assert.equal(isNeutralAdmSignalPath(project), true)
})

test('exact V21 ADM neutrality rejects automation and non-default graph gain', () => {
	const project = projectWithAudioTrack()
	assert.equal(isNeutralAdmSignalPath({
		...project,
		automationLanes: [{ id: 'gain-lane' }],
	}), false)
	assert.equal(isNeutralAdmSignalPath({
		...project,
		mixer: {
			...project.mixer,
			edges: project.mixer.edges.map((edge) => (
				edge.source.kind === 'track' ? { ...edge, level: 0.5 } : edge
			)),
		},
	}), false)
})
