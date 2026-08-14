/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
	AUDIO_PRODUCTION_COMMAND_TYPES,
	createAudioProductionRuntimeHandlers,
} from '../src/common/editor/commands/audio-production.ts'
import {
	AUDIO_EDITOR_COMMAND_TYPES,
	type AudioEditorCommand,
} from '../src/common/editor/commands/protocol.ts'
import { createEditorCommandRuntime } from '../src/common/editor/commands/runtime-registry.ts'
import { assertEditorCommandCapabilities } from '../src/common/editor/controller/command-capability-policy.ts'
import { createSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts'

test('production command discriminants are registered in exactly one exhaustive domain', () => {
	assert.deepEqual(AUDIO_PRODUCTION_COMMAND_TYPES, [
		'automation-lane/set', 'mixer-graph/set',
		'audio-freeze/install', 'audio-freeze/remove', 'audio-freeze/commit',
	])
	for (const type of AUDIO_PRODUCTION_COMMAND_TYPES) {
		assert.equal(AUDIO_EDITOR_COMMAND_TYPES.filter((candidate) => candidate === type).length, 1)
	}
	const runtime = createEditorCommandRuntime(() => undefined)
	for (const type of AUDIO_PRODUCTION_COMMAND_TYPES) assert.equal(typeof runtime[type], 'function')
})

test('automation and mixer commands use complete expected-value CAS mutations', () => {
	const project = createSoundscaperProjectV21({
		tracks: [],
		automationLanes: [],
	}) as unknown as Record<string, unknown>
	const handlers = createAudioProductionRuntimeHandlers()
	const lane = {
		id: 'master-gain',
		address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
		timebase: 'absolute-samples',
		points: [{ id: 'start', position: 0, value: 1 }],
		segments: [],
	}
	handlers['automation-lane/set'](project, {
		type: 'automation-lane/set', laneId: lane.id, expected: null, lane,
	})
	assert.deepEqual((project.automationLanes as readonly unknown[])[0], lane)
	assert.throws(() => handlers['automation-lane/set'](project, {
		type: 'automation-lane/set', laneId: lane.id, expected: null, lane,
	}), /stale|expected|exists/iu)

	const currentMixer = structuredClone(project.mixer)
	const replacement = structuredClone(currentMixer) as Record<string, unknown>
	;(replacement.outputs as Array<Record<string, unknown>>)[0]!.name = 'Studio main'
	handlers['mixer-graph/set'](project, {
		type: 'mixer-graph/set', expected: currentMixer as Readonly<Record<string, unknown>>,
		mixer: replacement,
	})
	assert.equal(((project.mixer as { outputs: Array<{ name: string }> }).outputs[0]?.name), 'Studio main')
})

test('capability policy protects direct and nested production commands', () => {
	const command: AudioEditorCommand = {
		type: 'batch',
		commands: [{
			type: 'automation-lane/set', laneId: 'lane', expected: null, lane: null,
		}],
	}
	const base = {
		audioEffects: true, audioRecording: true, audioSpectralEditing: true, audioWarp: true,
		takeComp: true, timelineAnnotations: true, trackFolders: true, videoEffects: true,
	}
	assert.throws(
		() => assertEditorCommandCapabilities(command, {
			...base, audioAutomation: false, audioMixerGraph: true,
		}, 'Test product'),
		/audioAutomation|automation/iu,
	)
	assert.doesNotThrow(() => assertEditorCommandCapabilities(command, {
		...base, audioAutomation: true, audioMixerGraph: true, audioTrackFreeze: true,
	}, 'Test product'))
	const freezeCommand = {
		type: 'batch',
		commands: [{
			type: 'audio-freeze/remove',
			trackId: 'voice',
			expectedFreeze: {
				schemaVersion: 1,
				derivedSourceId: 'voice-freeze',
				inputDigestSha256: '0'.repeat(64),
				rackDigestSha256: '1'.repeat(64),
				automationDigestSha256: '2'.repeat(64),
				freshnessDigestSha256: '3'.repeat(64),
				renderStartFrame: 0,
				renderFrameCount: 1,
				capturePosition: 'post-insert-pre-strip',
			},
		}],
	} as AudioEditorCommand
	assert.throws(() => assertEditorCommandCapabilities(freezeCommand, {
		...base, audioAutomation: true, audioMixerGraph: true, audioTrackFreeze: false,
	}, 'Test product'), /audioTrackFreeze|freeze/iu)
	assert.doesNotThrow(() => assertEditorCommandCapabilities(freezeCommand, {
		...base, audioAutomation: true, audioMixerGraph: true, audioTrackFreeze: true,
	}, 'Test product'))
})
