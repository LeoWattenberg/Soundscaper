/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SoundscaperNativePluginState } from './editor-native-plugin-state.ts'
import { createSoundscaperNativePluginState } from './editor-native-plugin-state.ts'
import { createNativePluginEffect } from '../common/editor/native-plugin-effect.ts'
import { validateSoundscaperProject, type SoundscaperProject } from './editor-project-validation.ts'

export interface SoundscaperNativePluginBindingRequest {
	readonly operation: 'author' | 'restore'
	readonly trackId: string
	readonly effect: Readonly<Record<string, unknown>>
	readonly state: unknown
}

export interface SoundscaperNativePluginBindingResult {
	readonly project: SoundscaperProject
	readonly effectId: string
}

export interface SoundscaperNativePluginActions {
	commitBinding(request: SoundscaperNativePluginBindingRequest): SoundscaperNativePluginBindingResult
	upsert(state: unknown): SoundscaperProject
	remove(instanceId: string): SoundscaperProject
	setBypassed(instanceId: string, bypassed: boolean): SoundscaperProject
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

/** Product-owned commands keep opaque state and rack continuity in one baseline history. */
export function createSoundscaperNativePluginActions(
	controller: ControllerPort,
): Readonly<SoundscaperNativePluginActions> {
	const commit = (
		command: unknown,
		options: Readonly<{ skipPlaybackEngine?: boolean }> = { skipPlaybackEngine: true },
	): SoundscaperProject => {
		const result = controller.actions.edit.commit(command, {}, options)
		validateSoundscaperProject(result)
		return result as SoundscaperProject
	}
	return Object.freeze({
		commitBinding: (request: SoundscaperNativePluginBindingRequest) => {
			if (request.operation !== 'author' && request.operation !== 'restore') {
				throw new TypeError('A native plug-in binding operation must be author or restore.')
			}
			if (typeof request.trackId !== 'string' || !request.trackId) {
				throw new TypeError('A native plug-in binding track ID is required.')
			}
			const effect = createNativePluginEffect(request.effect)
			const state = createSoundscaperNativePluginState(request.state)
			return Object.freeze({
				project: commit({
					type: 'native-plugin/bind', operation: request.operation,
					trackId: request.trackId, effect, state,
				}, {}),
				effectId: effect.id,
			})
		},
		upsert: (state: unknown) => commit({
			type: 'native-plugin-state/upsert', state: createSoundscaperNativePluginState(state),
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

function currentState(projectValue: unknown, instanceId: string): SoundscaperNativePluginState {
	validateSoundscaperProject(projectValue)
	const project = projectValue as SoundscaperProject
	const state = project.nativePluginStates.find((entry) => entry.instanceId === instanceId)
	if (!state) throw new ReferenceError(`Native plug-in instance ${instanceId} has no project state.`)
	return state
}
