/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SoundscaperNativePluginStateV30 } from './editor-native-plugin-state-v30.ts'
import { createSoundscaperNativePluginStateV30 } from './editor-native-plugin-state-v30.ts'
import { createNativePluginEffect } from '../common/editor/native-plugin-effect.ts'
import { validateSoundscaperProjectV30, type SoundscaperProjectV30 } from './editor-project-v30-validation.ts'

export interface SoundscaperNativePluginBindingRequestV30 {
	readonly operation: 'author' | 'restore'
	readonly trackId: string
	readonly effect: Readonly<Record<string, unknown>>
	readonly state: unknown
}

export interface SoundscaperNativePluginBindingResultV30 {
	readonly project: SoundscaperProjectV30
	readonly effectId: string
}

export interface SoundscaperNativePluginActionsV30 {
	commitBinding(request: SoundscaperNativePluginBindingRequestV30): SoundscaperNativePluginBindingResultV30
	upsert(state: unknown): SoundscaperProjectV30
	remove(instanceId: string): SoundscaperProjectV30
	setBypassed(instanceId: string, bypassed: boolean): SoundscaperProjectV30
}

interface ControllerPort {
	readonly project: unknown
	readonly actions: Readonly<{ readonly edit: Readonly<{
		commit(
			command: unknown,
			selection?: Readonly<Record<string, never>>,
			options?: Readonly<{ skipPlaybackEngine?: boolean }>,
		): unknown
	}> }>
}

/** Product-owned commands keep opaque state and rack continuity in one exact V30 history. */
export function createSoundscaperNativePluginActionsV30(
	controller: ControllerPort,
): Readonly<SoundscaperNativePluginActionsV30> {
	const commit = (
		command: unknown,
		options: Readonly<{ skipPlaybackEngine?: boolean }> = { skipPlaybackEngine: true },
	): SoundscaperProjectV30 => {
		const result = controller.actions.edit.commit(command, {}, options)
		validateSoundscaperProjectV30(result)
		return result as SoundscaperProjectV30
	}
	return Object.freeze({
		commitBinding: (request: SoundscaperNativePluginBindingRequestV30) => {
			if (request.operation !== 'author' && request.operation !== 'restore') {
				throw new TypeError('A native plug-in binding operation must be author or restore.')
			}
			if (typeof request.trackId !== 'string' || !request.trackId) {
				throw new TypeError('A native plug-in binding track ID is required.')
			}
			const effect = createNativePluginEffect(request.effect)
			const state = createSoundscaperNativePluginStateV30(request.state)
			return Object.freeze({
				project: commit({
					type: 'native-plugin/bind', operation: request.operation,
					trackId: request.trackId, effect, state,
				}, {}),
				effectId: effect.id,
			})
		},
		upsert: (state: unknown) => commit({
			type: 'native-plugin-state/upsert', state: createSoundscaperNativePluginStateV30(state),
		}),
		remove: (instanceId: string) => commit({ type: 'native-plugin-state/remove', instanceId }),
		setBypassed: (instanceId: string, bypassed: boolean) => {
			if (typeof bypassed !== 'boolean') throw new TypeError('A native plug-in bypass flag is required.')
			const state = currentState(controller.project, instanceId)
			return commit({
				type: 'native-plugin-state/upsert',
				state: { ...state, bypassed, continuity: bypassed ? 'bypass' : 'live' },
			})
		},
	})
}

function currentState(projectValue: unknown, instanceId: string): SoundscaperNativePluginStateV30 {
	validateSoundscaperProjectV30(projectValue)
	const project = projectValue as SoundscaperProjectV30
	const state = project.nativePluginStates.find((entry) => entry.instanceId === instanceId)
	if (!state) throw new ReferenceError(`Native plug-in instance ${instanceId} has no project state.`)
	return state
}
