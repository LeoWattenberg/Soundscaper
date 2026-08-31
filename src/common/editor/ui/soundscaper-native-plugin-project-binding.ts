/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	NativePluginInstanceProjectionV1,
	NativePluginProjectStateV1,
} from './soundscaper-native-services-bridge.ts'
import {
	createNativeEffectLatencyLedgerV21,
	NATIVE_EFFECT_LATENCY_MAX_CHANGES_PER_WINDOW,
	NATIVE_EFFECT_LATENCY_STABILITY_WINDOW_MS,
	type NativeEffectLatencyLedgerV21,
} from '../engine/native-effect-latency-v21.ts'
import type { EnginePublicApi } from '../engine/public-api.ts'
import { scheduleNativePluginRuntimeLatency } from '../native-plugin-realtime-node.js'
import type { SoundscaperNativeProjectOperation } from './soundscaper-native-renderer-project-operation.ts'

interface NativePluginController {
	readonly project?: unknown
	getSnapshot(): Readonly<{ readonly selectedTrackId?: string | null }>
	readonly actions: Readonly<{
		readonly effects: Readonly<{
			update(
				scope: string, trackId: string, effectId: string, changes: unknown,
				options?: Readonly<{ skipPlaybackEngine?: boolean }>,
			): unknown
		}>
		readonly nativePlugins: Readonly<{
			commitBinding(request: Readonly<{
				operation: 'author' | 'restore'
				trackId: string
				effect: Readonly<Record<string, unknown>>
				state: unknown
			}>): Readonly<{ readonly effectId: string }>
			upsert(state: unknown): unknown
			setBypassed(instanceId: string, bypassed: boolean): unknown
		}>
	}>
}

interface EffectLocation {
	readonly instanceId: string
	readonly trackId: string
	readonly effectId: string
	latencyFrames: number
	bypassed: boolean
	faulted: boolean
	changes: number[]
}

interface PdcTransition {
	readonly atFrame: number
	readonly contextTime: number | null
	readonly latencyFrames: number
	readonly pdcErrorSamples: 0
	readonly bypassed: boolean
}

/** Authors the opt-in hosted instance into the selected track and exact V29 state. */
export function createSoundscaperNativePluginProjectBinding(
	controller: NativePluginController,
	engine?: Pick<
		EnginePublicApi,
		'sampleRate' | 'getPositionFrames' | 'commitNativeEffectPdcRevision'
	> | null,
) {
	const locations = new Map<string, EffectLocation>()
	let ledger: NativeEffectLatencyLedgerV21 | null = null
	let lastBoundary = 0
	return Object.freeze({
		insert(
			instance: NativePluginInstanceProjectionV1,
			state: NativePluginProjectStateV1,
			operation: SoundscaperNativeProjectOperation,
		): void {
			const { selectedTrackId: trackId } = operation
			if (typeof trackId !== 'string' || !trackId) {
				throw new Error('Select an audio track before instantiating a native plug-in.')
			}
			assertProject()
			const binding = operation.commit(() => controller.actions.nativePlugins.commitBinding({
				operation: 'author', trackId, effect: effectOptions(instance), state,
			}))
			if (typeof binding.effectId !== 'string' || !binding.effectId) {
				throw new Error('The selected track refused the native plug-in effect.')
			}
			const location = createLocation(instance, trackId, binding.effectId)
			locations.set(instance.instanceId, location)
			reconcilePlan(instance.instanceId)
		},
		restore(
			instance: NativePluginInstanceProjectionV1,
			state: NativePluginProjectStateV1,
			operation: SoundscaperNativeProjectOperation,
		): void {
			operation.assertCurrent()
			const effect = locateProjectEffect(controller.project, instance)
			operation.commit(() => controller.actions.nativePlugins.commitBinding({
				operation: 'restore', trackId: effect.trackId,
				effect: effectOptions(instance, effect.effectId), state,
			}))
			const location = createLocation(instance, effect.trackId, effect.effectId)
			locations.set(instance.instanceId, location)
			reconcilePlan(instance.instanceId)
		},
		persist(state: NativePluginProjectStateV1, operation: SoundscaperNativeProjectOperation): void {
			operation.commit(() => controller.actions.nativePlugins.upsert(state))
		},
		admitBypassed(_instanceId: string, bypassed: boolean): boolean {
			return bypassed
		},
		setBypassed(instanceId: string, bypassed: boolean) {
			pruneRemovedLocations()
			const location = locations.get(instanceId)
			let transition = null
			if (location) {
				if (!bypassed && location.faulted) {
					location.faulted = false
					location.changes = []
				}
				location.bypassed = bypassed
				transition = reconcilePlan(instanceId)
				controller.actions.effects.update(
					'track', location.trackId, location.effectId, { bypassed }, { skipPlaybackEngine: true },
				)
			}
			try { controller.actions.nativePlugins.setBypassed(instanceId, bypassed) }
			catch { /* An instance has no V29 state until its first authenticated save. */ }
			return Object.freeze({ bypassed, transition })
		},
		runtime(instanceId: string, latencyFrames: number | null, state: string) {
			pruneRemovedLocations()
			const location = locations.get(instanceId)
			if (state === 'host-lost' || state === 'closed') {
				if (location) {
					location.faulted = true
					location.bypassed = true
					const transition = reconcilePlan(instanceId)
					controller.actions.effects.update(
						'track', location.trackId, location.effectId, { bypassed: true },
						{ skipPlaybackEngine: true },
					)
					try { controller.actions.nativePlugins.setBypassed(instanceId, true) } catch { /* no saved state */ }
					return transition ? Object.freeze({ ...transition, bypassed: true }) : null
				}
				try { controller.actions.nativePlugins.setBypassed(instanceId, true) } catch { /* no saved state */ }
				return null
			}
			if (!location || latencyFrames === null || latencyFrames === location.latencyFrames) return null
			const now = Date.now()
			location.changes = location.changes.filter(
				(stamp) => now - stamp < NATIVE_EFFECT_LATENCY_STABILITY_WINDOW_MS,
			)
			location.changes.push(now)
			if (!Number.isSafeInteger(latencyFrames) || Number(latencyFrames) < 0
				|| location.changes.length > NATIVE_EFFECT_LATENCY_MAX_CHANGES_PER_WINDOW) {
				location.faulted = true
				location.bypassed = true
			} else location.latencyFrames = Number(latencyFrames)
			const transition = reconcilePlan(instanceId)
			if (location.faulted) {
				controller.actions.effects.update(
					'track', location.trackId, location.effectId, { bypassed: true },
					{ skipPlaybackEngine: true },
				)
				try { controller.actions.nativePlugins.setBypassed(instanceId, true) } catch { /* no saved state */ }
				return transition ? Object.freeze({ ...transition, bypassed: true }) : null
			}
			controller.actions.effects.update('track', location.trackId, location.effectId, {
				params: { latencyFrames: location.latencyFrames },
			}, { skipPlaybackEngine: true })
			return transition
		},
		pdc(instanceId: string) {
			pruneRemovedLocations()
			return locations.has(instanceId) ? ledger?.authoritative ?? null : null
		},
	})

	function createLocation(
		instance: NativePluginInstanceProjectionV1, trackId: string, effectId: string,
	): EffectLocation {
		assertProject()
		return {
			instanceId: instance.instanceId, trackId, effectId,
			latencyFrames: instance.latencySamples, bypassed: instance.bypassed,
			faulted: false, changes: [],
		}
	}

	function assertProject(): void {
		if (!controller.project || typeof controller.project !== 'object') {
			throw new Error('A project is required for native plug-in latency compensation.')
		}
	}

	function reconcilePlan(instanceId: string): PdcTransition | null {
		if (!controller.project || typeof controller.project !== 'object') return null
		pruneRemovedLocations()
		ledger = createNativeEffectLatencyLedgerV21({
			project: controller.project,
			instances: [...locations.values()].map((location) => ({
				instanceId: location.instanceId,
				strip: { kind: 'track' as const, id: location.trackId },
				effectId: location.effectId,
			})),
			sampleRate: engine?.sampleRate,
		})
		for (const location of locations.values()) {
			if (location.faulted) ledger.reportHostLoss(location.instanceId)
			else {
				ledger.report(location.instanceId, location.latencyFrames)
				if (location.bypassed) ledger.setBypassed(location.instanceId, true)
			}
		}
		if (ledger.pending === null) return null
		const current = Math.max(0, Number(engine?.getPositionFrames?.()) || 0)
		const requested = Math.ceil((current + 1) / ledger.blockFrames) * ledger.blockFrames
		const boundary = Math.max(requested, lastBoundary + ledger.blockFrames)
		const swap = ledger.commitAtBlockBoundary(boundary)
		if (swap.status !== 'swapped' || ledger.authoritative.pdcErrorSamples !== 0) {
			throw new Error('The native plug-in PDC revision did not swap atomically at a safe block boundary.')
		}
		const committed = engine?.commitNativeEffectPdcRevision({
			atFrame: boundary,
			blockFrames: ledger.blockFrames,
			pdcErrorSamples: ledger.authoritative.pdcErrorSamples,
			plan: ledger.authoritative.plan,
		})
		for (const location of locations.values()) scheduleNativePluginRuntimeLatency(
			location.instanceId,
			ledger.authoritative.contributedFrames.get(location.instanceId) ?? 0,
			committed?.publicationDelayMs ?? 0,
		)
		lastBoundary = boundary
		const latencyFrames = ledger.authoritative.contributedFrames.get(instanceId) ?? 0
		return Object.freeze({
			atFrame: boundary, contextTime: committed?.contextTime ?? null,
			latencyFrames, pdcErrorSamples: 0 as const,
			bypassed: ledger.authoritative.instanceStates.get(instanceId) !== 'active',
		})
	}

	function pruneRemovedLocations(): void {
		for (const [instanceId, location] of locations) {
			if (!projectHasNativeEffectAtLocation(controller.project, location)) locations.delete(instanceId)
		}
	}
}

function projectHasNativeEffectAtLocation(project: unknown, location: EffectLocation): boolean {
	const tracks = (project as { readonly tracks?: unknown } | null)?.tracks
	if (!Array.isArray(tracks)) return false
	const track = tracks.find((candidate) => (
		candidate && typeof candidate === 'object'
		&& (candidate as { readonly id?: unknown }).id === location.trackId
	)) as { readonly effects?: unknown } | undefined
	if (!Array.isArray(track?.effects)) return false
	return track.effects.some((candidate) => {
		if (!candidate || typeof candidate !== 'object') return false
		const effect = candidate as {
			readonly id?: unknown
			readonly type?: unknown
			readonly params?: { readonly instanceId?: unknown }
		}
		return effect.id === location.effectId && effect.type === 'native-plugin'
			&& effect.params?.instanceId === location.instanceId
	})
}

function effectOptions(
	instance: NativePluginInstanceProjectionV1,
	effectId?: string,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		...(effectId === undefined ? {} : { id: effectId }),
		enabled: instance.enabled,
		bypassed: instance.bypassed,
		params: Object.freeze({
			instanceId: instance.instanceId,
			latencyFrames: instance.latencySamples,
		}),
		context: Object.freeze({
			format: instance.format,
			stablePluginId: instance.stablePluginId,
			binarySha256: instance.binarySha256,
		}),
	})
}

function locateProjectEffect(
	project: unknown,
	instance: NativePluginInstanceProjectionV1,
): Readonly<{ trackId: string; effectId: string }> {
	const tracks = (project as { readonly tracks?: unknown } | null)?.tracks
	if (!Array.isArray(tracks)) throw new Error('The restored project has no audio tracks.')
	const matches: { trackId: string; effectId: string }[] = []
	for (const track of tracks) {
		if (!track || typeof track !== 'object' || (track as { type?: unknown }).type !== 'audio') continue
		const trackId = (track as { id?: unknown }).id
		const effects = (track as { effects?: unknown }).effects
		if (typeof trackId !== 'string' || !Array.isArray(effects)) continue
		for (const effect of effects) {
			const value = effect as { id?: unknown; type?: unknown; params?: { instanceId?: unknown }; context?: Record<string, unknown> }
			if (value?.type !== 'native-plugin' || value.params?.instanceId !== instance.instanceId) continue
			if (value.context?.format !== instance.format
				|| value.context?.stablePluginId !== instance.stablePluginId
				|| value.context?.binarySha256 !== instance.binarySha256
				|| typeof value.id !== 'string') {
				throw new Error('The persisted native plug-in rack binding changed identity.')
			}
			matches.push({ trackId, effectId: value.id })
		}
	}
	if (matches.length !== 1) {
		throw new Error('A persisted native plug-in state must bind exactly one authored rack effect.')
	}
	return Object.freeze(matches[0]!)
}
