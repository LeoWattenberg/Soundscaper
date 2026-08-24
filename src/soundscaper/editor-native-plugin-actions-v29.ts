/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SoundscaperNativePluginStateV29 } from './editor-native-plugin-state-v29.ts'
import { createSoundscaperNativePluginStateV29 } from './editor-native-plugin-state-v29.ts'
import { createNativePluginEffect } from '../common/editor/native-plugin-effect.ts'
import { validateSoundscaperProjectV29, type SoundscaperProjectV29 } from './editor-project-v29-validation.ts'

export interface SoundscaperNativePluginBindingRequestV29 {
	readonly operation: 'author' | 'restore'
	readonly trackId: string
	readonly effect: Readonly<Record<string, unknown>>
	readonly state: unknown
}

export interface SoundscaperNativePluginBindingResultV29 {
	readonly project: SoundscaperProjectV29
	readonly effectId: string
}

export interface SoundscaperNativePluginActionsV29 {
	commitBinding(request: SoundscaperNativePluginBindingRequestV29): SoundscaperNativePluginBindingResultV29
	upsert(state: unknown): SoundscaperProjectV29
	remove(instanceId: string): SoundscaperProjectV29
	setBypassed(instanceId: string, bypassed: boolean): SoundscaperProjectV29
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

/** Product-owned commands keep opaque state and rack continuity in one exact V29 history. */
export function createSoundscaperNativePluginActionsV29(
	controller: ControllerPort,
): Readonly<SoundscaperNativePluginActionsV29> {
	const commit = (
		command: unknown,
		options: Readonly<{ skipPlaybackEngine?: boolean }> = { skipPlaybackEngine: true },
	): SoundscaperProjectV29 => {
		const result = controller.actions.edit.commit(command, {}, options)
		validateSoundscaperProjectV29(result)
		return result as SoundscaperProjectV29
	}
	return Object.freeze({
		commitBinding: (request: SoundscaperNativePluginBindingRequestV29) => {
			if (request.operation !== 'author' && request.operation !== 'restore') {
				throw new TypeError('A native plug-in binding operation must be author or restore.')
			}
			if (typeof request.trackId !== 'string' || !request.trackId) {
				throw new TypeError('A native plug-in binding track ID is required.')
			}
			const effect = createNativePluginEffect(request.effect)
			const state = createSoundscaperNativePluginStateV29(request.state)
			return Object.freeze({
				project: commit({
					type: 'native-plugin/bind', operation: request.operation,
					trackId: request.trackId, effect, state,
				}, {}),
				effectId: effect.id,
			})
		},
		upsert: (state: unknown) => commit({
			type: 'native-plugin-state/upsert', state: createSoundscaperNativePluginStateV29(state),
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

function currentState(projectValue: unknown, instanceId: string): SoundscaperNativePluginStateV29 {
	validateSoundscaperProjectV29(projectValue)
	const project = projectValue as SoundscaperProjectV29
	const state = project.nativePluginStates.find((entry) => entry.instanceId === instanceId)
	if (!state) throw new ReferenceError(`Native plug-in instance ${instanceId} has no project state.`)
	return state
}
