/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import test from 'node:test'

import type { NativePluginRackEffect } from '../src/common/editor/native-plugin-effect.ts'
import { createSoundscaperNativePluginActions } from '../src/soundscaper/editor-native-plugin-actions.ts'
import {
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand,
} from '../src/soundscaper/editor-project-history.ts'
import type { SoundscaperNativePluginBindingCommand } from '../src/soundscaper/editor-project-commands.ts'
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts'

const NOW = '2026-08-24T00:00:00.000Z'

test('native plug-in authoring publishes the rack slot and state in one undoable V29 revision', () => {
	const initial = project()
	const history = createSoundscaperProjectHistory(initial)
	const authored = executeSoundscaperProjectCommand(history, binding('author'), { now: NOW })

	assert.equal(authored.present.revision, initial.revision + 1)
	assert.deepEqual(nativeEffects(authored.present), [effect()])
	assert.deepEqual(authored.present.nativePluginStates, [state()])
	assert.equal(authored.undoStack.length, 1)

	const undone = undoSoundscaperProjectCommand(authored)
	assert.deepEqual(nativeEffects(undone.present), [])
	assert.deepEqual(undone.present.nativePluginStates, [])
	assert.equal(undone.undoStack.length, 0)

	const redone = redoSoundscaperProjectCommand(undone)
	assert.deepEqual(nativeEffects(redone.present), [effect()])
	assert.deepEqual(redone.present.nativePluginStates, [state()])
})

test('the product binding action dispatches exactly one playback-visible canonical commit', () => {
	let history = createSoundscaperProjectHistory(project())
	const calls: Array<Readonly<{ command: unknown; options: unknown }>> = []
	const controller = {
		get project() { return history.present },
		actions: { edit: { commit: (
			command: unknown,
			_selection: Readonly<Record<string, never>>,
			options: Readonly<{ skipPlaybackEngine?: boolean }>,
		) => {
			calls.push({ command, options })
			history = executeSoundscaperProjectCommand(history, command as never, { now: NOW })
			return history.present
		} } },
	}
	const actions = createSoundscaperNativePluginActions(controller)
	const result = actions.commitBinding({
		operation: 'author', trackId: 'track-1',
		effect: effect() as unknown as Readonly<Record<string, unknown>>, state: state(),
	})

	assert.equal(calls.length, 1)
	assert.deepEqual(calls[0]?.options, {}, 'rack publication must reach the playback engine')
	assert.equal(result.project, history.present)
	assert.equal(result.effectId, 'native-effect-1')
	assert.deepEqual(nativeEffects(history.present), [effect()])
	assert.deepEqual(history.present.nativePluginStates, [state()])
})

test('a late native state failure cannot publish the otherwise valid rack mutation', () => {
	const history = createSoundscaperProjectHistory(project())
	const invalid = binding('author', {
		state: state({ stateBody: {
			...state().stateBody,
			bodyId: `native-plugin-state:${'d'.repeat(64)}`,
		} }),
	})

	assert.throws(
		() => executeSoundscaperProjectCommand(history, invalid),
		/derived from its SHA-256/iu,
	)
	assert.deepEqual(nativeEffects(history.present), [])
	assert.deepEqual(history.present.nativePluginStates, [])
	assert.equal(history.undoStack.length, 0)
})

test('a generic rack command cannot bypass the atomic native plug-in binding', () => {
	const initial = project()
	const history = createSoundscaperProjectHistory(initial)

	assert.throws(() => executeSoundscaperProjectCommand(history, {
		type: 'effect/add', scope: 'track', trackId: 'track-1', effect: effect(),
	} as never), /native plug-in.*binding|atomic native/iu)
	assert.throws(() => executeSoundscaperProjectCommand(history, {
		type: 'track/add',
		track: {
			...structuredClone(initial.tracks[0]),
			id: 'track-2', name: 'Track 2', effects: [effect({ id: 'native-effect-2' })],
		},
	} as never), /native plug-in.*binding|atomic native/iu)
	assert.deepEqual(nativeEffects(history.present), [])
	assert.deepEqual(history.present.nativePluginStates, [])
	assert.equal(history.undoStack.length, 0)
})

test('native plug-in restore updates the exact rack slot and state in one reversible revision', () => {
	const authored = executeSoundscaperProjectCommand(
		createSoundscaperProjectHistory(project()), binding('author'), { now: NOW },
	)
	const restoredEffect = effect({ bypassed: true, params: {
		instanceId: 'native-instance-1', latencyFrames: 256,
	} })
	const restoredState = state({
		stateBody: body('e'), bypassed: true, continuity: 'bypass', latencySamples: 256,
	})
	const restored = executeSoundscaperProjectCommand(authored, binding('restore', {
		effect: restoredEffect, state: restoredState,
	}), { now: '2026-08-24T00:00:01.000Z' })

	assert.equal(restored.present.revision, authored.present.revision + 1)
	assert.deepEqual(nativeEffects(restored.present), [restoredEffect])
	assert.deepEqual(restored.present.nativePluginStates, [restoredState])
	assert.equal(restored.undoStack.length, authored.undoStack.length + 1)

	const undone = undoSoundscaperProjectCommand(restored)
	assert.deepEqual(nativeEffects(undone.present), [effect()])
	assert.deepEqual(undone.present.nativePluginStates, [state()])
})

test('a failed restore leaves both the prior rack projection and prior state untouched', () => {
	const authored = executeSoundscaperProjectCommand(
		createSoundscaperProjectHistory(project()), binding('author'), { now: NOW },
	)
	const before = JSON.stringify(authored)
	assert.throws(() => executeSoundscaperProjectCommand(authored, binding('restore', {
		effect: effect({ params: { instanceId: 'native-instance-1', latencyFrames: 256 } }),
		state: state({ latencySamples: 128 }),
	})), /runtime projection/iu)
	assert.equal(JSON.stringify(authored), before)
	assert.deepEqual(nativeEffects(authored.present), [effect()])
	assert.deepEqual(authored.present.nativePluginStates, [state()])
})

test('a state-only restore still owns one revision while an exact restore remains a no-op', () => {
	const authored = executeSoundscaperProjectCommand(
		createSoundscaperProjectHistory(project()), binding('author'), { now: NOW },
	)
	const restoredState = state({ stateBody: body('f') })
	const restored = executeSoundscaperProjectCommand(authored, binding('restore', {
		state: restoredState,
	}), { now: '2026-08-24T00:00:01.000Z' })
	assert.equal(restored.present.revision, authored.present.revision + 1)
	assert.deepEqual(nativeEffects(restored.present), [effect()])
	assert.deepEqual(restored.present.nativePluginStates, [restoredState])

	const noOp = executeSoundscaperProjectCommand(restored, binding('restore', {
		state: restoredState,
	}))
	assert.equal(noOp, restored)
})

test('the narrow native binding command does not widen V29 generic mixed batches', () => {
	const history = createSoundscaperProjectHistory(project())
	assert.throws(() => executeSoundscaperProjectCommand(history, {
		type: 'batch',
		commands: [
			{ type: 'effect/add', scope: 'track', trackId: 'track-1', effect: effect() },
			{ type: 'native-plugin-state/upsert', state: state() },
		],
	} as never), /native-plugin-state|unsupported editor command/iu)
	assert.deepEqual(nativeEffects(history.present), [])
	assert.deepEqual(history.present.nativePluginStates, [])
})

function project() {
	return createSoundscaperProject({
		id: 'native-binding-v29', title: 'Atomic native binding', now: NOW,
		tracks: [{ type: 'audio', id: 'track-1', name: 'Track' }],
	} as never)
}

function binding(
	operation: SoundscaperNativePluginBindingCommand['operation'],
	overrides: Readonly<Record<string, unknown>> = {},
): SoundscaperNativePluginBindingCommand {
	return {
		type: 'native-plugin/bind', operation, trackId: 'track-1',
		effect: effect(), state: state(), ...overrides,
	} as SoundscaperNativePluginBindingCommand
}

function effect(overrides: Readonly<Record<string, unknown>> = {}): NativePluginRackEffect {
	return {
		id: 'native-effect-1', type: 'native-plugin', enabled: true, bypassed: false,
		params: { instanceId: 'native-instance-1', latencyFrames: 128 },
		context: {
			format: 'clap', stablePluginId: 'org.example.effect', binarySha256: 'b'.repeat(64),
		},
		...overrides,
	} as NativePluginRackEffect
}

function state(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		instanceId: 'native-instance-1', format: 'clap', stablePluginId: 'org.example.effect',
		binarySha256: 'b'.repeat(64), stateBody: body('c'), enabled: true, bypassed: false,
		continuity: 'live', latencySamples: 128, ...overrides,
	}
}

function body(digit: string) {
	const sha256 = digit.repeat(64)
	return {
		kind: 'native-plugin-state' as const,
		bodyId: `native-plugin-state:${sha256}`,
		byteLength: 1,
		sha256,
	}
}

function nativeEffects(projectValue: ReturnType<typeof project>): readonly unknown[] {
	return projectValue.tracks[0]?.type === 'audio' ? projectValue.tracks[0].effects : []
}
