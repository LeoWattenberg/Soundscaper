/* SPDX-License-Identifier: AGPL-3.0-only */

export class NativePluginOfflineFreezeRequiredError extends Error {
	readonly code = 'NATIVE_PLUGIN_OFFLINE_FREEZE_REQUIRED'
	readonly instanceIds: readonly string[]

	constructor(instanceIds: readonly string[]) {
		super('Active native plug-ins require a verified fresh track freeze before offline export.')
		this.name = 'NativePluginOfflineFreezeRequiredError'
		this.instanceIds = Object.freeze([...instanceIds])
	}
}

/**
 * OfflineAudioContext owns a different graph and cannot consume the one live
 * helper port. Refuse an active native slot instead of rendering its worklet's
 * dry-bypass fallback. A verified V29 freeze projection replaces that track
 * before it reaches this boundary and therefore passes without special cases.
 */
export function assertNativePluginOfflineRenderAdmission(
	project: unknown,
	options: Readonly<{ trackId?: unknown; includeMaster?: boolean }> = {},
	runtimeProviderAvailable = false,
): void {
	const instances = nativePluginOfflineInstanceIds(project, options)
	if (instances.length && !runtimeProviderAvailable) throw new NativePluginOfflineFreezeRequiredError(instances)
}

/** Exact active instances reached by one track/mix render selection. */
export function nativePluginOfflineInstanceIds(
	project: unknown,
	options: Readonly<{ trackId?: unknown; includeMaster?: boolean }> = {},
): readonly string[] {
	const value = record(project)
	const selectedTrackId = options.trackId == null ? null : String(options.trackId)
	const instances: string[] = []
	for (const trackValue of array(value.tracks)) {
		const track = record(trackValue)
		if (track.type !== 'audio' || (selectedTrackId !== null && track.id !== selectedTrackId)) continue
		collect(track.effects, instances)
	}
	if (selectedTrackId === null) {
		const mixer = record(value.mixer)
		for (const key of ['groups', 'sends'] as const) {
			for (const owner of array(mixer[key])) collect(record(owner).effects, instances)
		}
	}
	if (options.includeMaster !== false) collect(record(value.master).effects, instances)
	return Object.freeze([...new Set(instances)])
}

function collect(value: unknown, instances: string[]): void {
	for (const effectValue of array(value)) {
		const effect = record(effectValue)
		if (effect.type !== 'native-plugin' || effect.enabled === false || effect.bypassed === true) continue
		const instanceId = record(effect.params).instanceId
		if (typeof instanceId !== 'string' || !instanceId) {
			throw new TypeError('An active native plug-in effect has no instance identity.')
		}
		instances.push(instanceId)
	}
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {}
}

function array(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
