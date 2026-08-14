/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createAudioTrackV10 } from '../src/common/editor/project-v10.ts'
import {
	SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION,
	cloneSoundscaperProjectV21,
	createSoundscaperProjectV21,
	loadSoundscaperProjectV21,
} from '../src/soundscaper/editor-project-v21.ts'
import { validateSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21-validation.ts'

const NOW = '2026-08-14T10:00:00.000Z'

test('V21 factory replaces legacy strip envelopes and flat routing with exact production authority', () => {
	const project = createSoundscaperProjectV21({
		id: 'production-project',
		title: 'Production project',
		now: NOW,
		tracks: [createAudioTrackV10({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
	})

	assert.equal(SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION, 21)
	assert.equal(project.schemaVersion, 21)
	assert.deepEqual(project.automationLanes, [])
	assert.equal(Object.hasOwn(project.tracks[0]!, 'envelope'), false)
	assert.equal(Object.hasOwn(project.master as object, 'envelope'), false)
	assert.equal(Object.hasOwn(project.mixer, 'routes'), false)
	assert.deepEqual(project.mixer.edges.map(({ id }) => id), [
		'assignment:track:voice:master',
		'assignment:master:output:main',
	])
	assert.equal(validateSoundscaperProjectV21(project), true)
})

test('automation lanes and graph state detach, freeze, clone, and load without semantic loss', () => {
	const project = createSoundscaperProjectV21({
		id: 'automation-project',
		title: 'Automation project',
		now: NOW,
		tracks: [createAudioTrackV10({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		automationLanes: [{
			id: 'voice-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [
				{ id: 'start', position: 0, value: 0.5 },
				{ id: 'end', position: 48_000, value: 1 },
			],
			segments: [{ kind: 'linear' }],
		}],
	})
	const clone = cloneSoundscaperProjectV21(project)
	const loaded = loadSoundscaperProjectV21(clone)

	assert.notStrictEqual(clone, project)
	assert.deepEqual(clone, project)
	assert.deepEqual(loaded, {
		project: clone,
		readOnly: false,
		intrinsicReadOnly: false,
		reason: null,
	})
	assert.notStrictEqual(loaded.project, clone)
	assert.equal(Object.isFrozen(project.automationLanes), true)
	assert.equal(Object.isFrozen(project.automationLanes[0]), true)
	assert.equal(validateSoundscaperProjectV21(loaded.project), true)
})

test('V21 contextual validation rejects dangling lane and graph identities without repair', () => {
	const project = createSoundscaperProjectV21({
		id: 'validation-project', title: 'Validation project', now: NOW,
		tracks: [createAudioTrackV10({ id: 'voice', name: 'Voice', clipIds: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		automationLanes: [{
			id: 'missing-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples',
			points: [{ id: 'point', position: 0, value: 1 }],
			segments: [],
		}],
	})
	const danglingLane = structuredClone(project)
	;(danglingLane.automationLanes[0] as unknown as Record<string, unknown>).address = {
		kind: 'strip', strip: { kind: 'track', id: 'missing' }, parameterId: 'gain',
	}
	assert.throws(() => validateSoundscaperProjectV21(danglingLane), /lane|missing|track/iu)

	const legacyEnvelope = structuredClone(project)
	;(legacyEnvelope.tracks[0] as Record<string, unknown>).envelope = []
	assert.throws(() => validateSoundscaperProjectV21(legacyEnvelope), /envelope|forbidden/iu)
	const legacyMixer = structuredClone(project)
	;(legacyMixer.mixer as unknown as Record<string, unknown>).routes = {}
	assert.throws(() => validateSoundscaperProjectV21(legacyMixer), /mixer|unsupported field|routes/iu)
	const openProject = { ...structuredClone(project), privateProductionCache: true }
	assert.throws(() => validateSoundscaperProjectV21(openProject), /unsupported field|privateProductionCache/iu)
	const openTrack = structuredClone(project)
	;(openTrack.tracks[0] as Record<string, unknown>).privateAutomation = []
	assert.throws(() => validateSoundscaperProjectV21(openTrack), /unsupported field|privateAutomation/iu)
})

test('V21 contextual validation admits only canonical automatable parameter descriptors', () => {
	const track = createAudioTrackV10({
		id: 'voice', name: 'Voice', clipIds: [],
		effects: [
			{
				id: 'voice-filter', type: 'highpass', enabled: true,
				params: { frequency: 120, q: 1 },
			},
			{
				id: 'voice-limiter', type: 'limiter', enabled: true,
				params: { ceiling: -1, lookahead: 0.005, release: 0.1 },
			},
		],
	})
	const options = {
		id: 'descriptor-project', title: 'Descriptor project', now: NOW,
		tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
	}
	const effectLane = (effectId: string, parameterId: string, value: number) => ({
		id: `${effectId}-${parameterId}`,
		address: {
			kind: 'effect', strip: { kind: 'track', id: 'voice' },
			effectId, parameterId,
		},
		timebase: 'absolute-samples',
		points: [{ id: 'point', position: 0, value }],
		segments: [],
	})
	assert.doesNotThrow(() => createSoundscaperProjectV21({
		...options, automationLanes: [effectLane('voice-filter', 'frequency', 1_000)],
	}))
	assert.throws(() => createSoundscaperProjectV21({
		...options, automationLanes: [effectLane('voice-filter', 'frequency', 30_000)],
	}), /range|outside/iu)
	assert.throws(() => createSoundscaperProjectV21({
		...options, automationLanes: [effectLane('voice-limiter', 'missing', 0)],
	}), /unavailable|parameter/iu)
	assert.throws(() => createSoundscaperProjectV21({
		...options, automationLanes: [effectLane('voice-limiter', 'ceiling', -6)],
	}), /nonautomatable|worklet|queue/iu)
	assert.throws(() => createSoundscaperProjectV21({
		...options, automationLanes: [effectLane('voice-limiter', 'lookahead', 0.005)],
	}), /nonautomatable|latency/iu)
	assert.throws(() => createSoundscaperProjectV21({
		...options,
		automationLanes: [{
			id: 'master-mute',
			address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'mute' },
			timebase: 'absolute-samples',
			points: [{ id: 'start', position: 0, value: 0 }, { id: 'end', position: 1, value: 1 }],
			segments: [{ kind: 'linear' }],
		}],
	}), /discrete|hold/iu)
})

test('V21 load preserves future documents opaquely and refuses earlier product schemas', () => {
	const current = createSoundscaperProjectV21({ now: NOW })
	const future = { ...structuredClone(current), schemaVersion: 22, futureState: { retained: true } }
	const loaded = loadSoundscaperProjectV21(future)
	assert.equal(loaded.readOnly, true)
	assert.equal(loaded.intrinsicReadOnly, true)
	assert.equal(loaded.reason, 'newer-schema')
	assert.deepEqual(loaded.project, future)
	assert.notStrictEqual(loaded.project, future)
	assert.throws(
		() => loadSoundscaperProjectV21({ ...structuredClone(current), schemaVersion: 17 }),
		/re-import|schema|V21/iu,
	)
})
