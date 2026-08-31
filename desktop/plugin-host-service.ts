/* SPDX-License-Identifier: AGPL-3.0-only */

import type { HelperPluginHostJobGrant } from './helper-job-grant.ts'
import {
	PluginHostIsolationRegistry,
	type PluginVendorUiOutcome,
} from './plugin-host-isolation.ts'
import {
	PLUGIN_HOST_BENIGN_STOP_REASONS,
	PLUGIN_HOST_FAULT_REASONS,
	PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES,
	PluginInstanceStateStore,
	type PluginContinuityDecision,
	type PluginHostStopReason,
	type PluginInstanceStateSnapshot,
	type PluginOpaqueStatePersistOutcome,
} from './plugin-instance-state.ts'
import type {
	DesktopPluginRegistry,
	PluginHostDescriptor,
} from './plugin-registry.ts'

export interface PluginStateBodyAuthority {
	persist(bytes: Uint8Array): Readonly<{
		kind: 'native-plugin-state'
		bodyId: string
		byteLength: number
		sha256: string
	}>
	read(bodyId: string): Readonly<{ bytes: Uint8Array; byteLength: number; sha256: string }> | null
}

export interface NativePluginOfflineRunner {
	run(request: Readonly<{
		grant: HelperPluginHostJobGrant
		instanceId: string
	}>): Promise<Readonly<{
		reportedLatencyFrames: number
		latencyStable: boolean
		blocksRendered: number
		renderedSha256: string
		stateBytes: number | null
		stateRefusal: string | null
	}>>
}

export interface DesktopPluginHostServiceOptions {
	readonly registry: DesktopPluginRegistry
	readonly isolation: PluginHostIsolationRegistry
	readonly states?: PluginInstanceStateStore
	readonly stateBodies: PluginStateBodyAuthority
	readonly offline: NativePluginOfflineRunner
	readonly isFormatActivated?: (format: string) => boolean
	readonly onLatencyChanged: (instanceId: string, latencySamples: number) => void
}

export interface NativePluginInstanceProjection {
	readonly instanceId: string
	readonly entryId: string
	readonly stablePluginId: string
	readonly format: string
	readonly binarySha256: string
	readonly inputChannels: number
	readonly outputChannels: number
	readonly state: string
	readonly enabled: boolean
	readonly bypassed: boolean
	readonly latencySamples: number
	readonly opaqueState: PluginInstanceStateSnapshot
}

export interface NativePluginProjectStateProjection {
	readonly instanceId: string
	readonly format: string
	readonly stablePluginId: string
	readonly binarySha256: string
	readonly stateBody: Readonly<{
		kind: 'native-plugin-state'
		bodyId: string
		byteLength: number
		sha256: string
	}>
	readonly enabled: boolean
	readonly bypassed: boolean
	readonly continuity: 'live' | 'bypass' | 'frozen'
	readonly latencySamples: number
}

interface InstanceEntry {
	readonly owner: object
	readonly installationId: string
	readonly descriptor: Readonly<PluginHostDescriptor>
	readonly grant: HelperPluginHostJobGrant
	instanceId: string
	enabled: boolean
	bypassed: boolean
	latencySamples: number
	generation: number
	continuity: 'live' | 'bypass' | 'frozen'
	stateBody: NativePluginProjectStateProjection['stateBody'] | null
}

/** Pathless main facade over registry, isolation, DSP probing, state, PDC and vendor UI. */
export class DesktopPluginHostService {
	readonly #registry: DesktopPluginRegistry
	readonly #isolation: PluginHostIsolationRegistry
	readonly #states: PluginInstanceStateStore
	readonly #stateBodies: PluginStateBodyAuthority
	readonly #offline: NativePluginOfflineRunner
	readonly #isFormatActivated: (format: string) => boolean
	readonly #onLatencyChanged: (instanceId: string, latencySamples: number) => void
	readonly #instances = new Map<string, InstanceEntry>()
	#disposed = false

	constructor(options: DesktopPluginHostServiceOptions) {
		this.#registry = options.registry
		this.#isolation = options.isolation
		this.#states = options.states ?? new PluginInstanceStateStore()
		this.#stateBodies = options.stateBodies
		this.#offline = options.offline
		this.#isFormatActivated = options.isFormatActivated ?? (() => true)
		this.#onLatencyChanged = options.onLatencyChanged
	}

	async instantiate(owner: object, value: unknown): Promise<Readonly<NativePluginInstanceProjection>> {
		this.#assertLive()
		const request = closedRecord(value, ['installationId', 'instanceId', 'sampleRate'], 'native plug-in instantiate request')
		const installationId = opaqueId(request.installationId, 'plug-in installation ID')
		const requestedId = request.instanceId === null
			? undefined
			: opaqueId(request.instanceId, 'plug-in instance ID')
		const sampleRate = nonNegativeInteger(request.sampleRate, 'plug-in sample rate')
		if (sampleRate < 8_000 || sampleRate > 768_000) {
			throw new RangeError('Native plug-in sample rate is outside its admitted range.')
		}
		const descriptor = this.#registry.hostDescriptorFor(installationId)
		this.#assertFormatActivated(descriptor.format)
		const grant = this.#registry.hostGrantFor(installationId)
		const acquisition = await this.#isolation.acquireInstance({
			owner,
			binarySha256: descriptor.binarySha256,
			format: descriptor.format,
			...(requestedId ? { instanceId: requestedId } : {}),
		})
		if (acquisition.status !== 'hosted') throw new Error(acquisition.message)
		const instanceId = acquisition.instance.instanceId
		if (!this.#isFormatActivated(descriptor.format)) {
			this.#isolation.releaseInstance(instanceId)
			throw new Error('That plug-in format activation changed while its host was starting.')
		}
		if (this.#instances.has(instanceId)) throw new Error('That native plug-in instance is already active.')
		const latencySamples = latency(descriptor.reportedLatencyFrames ?? 0)
		const entry: InstanceEntry = {
			owner,
			installationId,
			descriptor,
			grant,
			instanceId,
			enabled: true,
			bypassed: false,
			latencySamples,
			generation: 0,
			continuity: 'live',
			stateBody: null,
		}
		this.#instances.set(instanceId, entry)
		this.#onLatencyChanged(instanceId, latencySamples)
		return this.#project(entry)
	}

	realtimeGrant(owner: object, instanceId: unknown): Readonly<{
		grant: HelperPluginHostJobGrant
		format: string
		latencySamples: number
	}> {
		const entry = this.#owned(owner, instanceId)
		return Object.freeze({
			grant: entry.grant, format: entry.descriptor.format, latencySamples: entry.latencySamples,
		})
	}

	async runOffline(owner: object, instanceId: unknown): Promise<Readonly<{
		instance: NativePluginInstanceProjection
		blocksRendered: number
		renderedSha256: string
	}>> {
		const entry = this.#owned(owner, instanceId)
		const result = await this.#offline.run({ grant: entry.grant, instanceId: entry.instanceId })
		this.#assertFormatActivated(entry.descriptor.format)
		if (!result.latencyStable) {
			entry.bypassed = true
			entry.continuity = 'bypass'
			throw new Error('The native plug-in reported unstable latency and was bypassed.')
		}
		const nextLatency = latency(result.reportedLatencyFrames)
		if (nextLatency !== entry.latencySamples) {
			entry.latencySamples = nextLatency
			this.#onLatencyChanged(entry.instanceId, nextLatency)
		}
		if ((result.stateBytes !== null && result.stateBytes > PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES)
			|| result.stateRefusal === 'state-too-large') {
			this.#states.declareOversizeState({
				instanceId: entry.instanceId,
				generation: entry.generation + 1,
				declaredByteLength: result.stateBytes
					?? PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES + 1,
			})
		}
		return Object.freeze({
			instance: this.#project(entry),
			blocksRendered: nonNegativeInteger(result.blocksRendered, 'rendered block count'),
			renderedSha256: digest(result.renderedSha256),
		})
	}

	setBypassed(owner: object, value: unknown): Readonly<NativePluginInstanceProjection> {
		const request = closedRecord(value, ['instanceId', 'bypassed'], 'native plug-in bypass request')
		if (typeof request.bypassed !== 'boolean') throw new TypeError('A native plug-in bypass flag must be boolean.')
		const entry = this.#owned(owner, request.instanceId)
		entry.bypassed = request.bypassed
		entry.continuity = request.bypassed ? 'bypass' : 'live'
		return this.#project(entry)
	}

	persistState(owner: object, value: unknown): Readonly<{
		outcome: PluginOpaqueStatePersistOutcome
		projectState: NativePluginProjectStateProjection | null
	}> {
		const request = closedRecord(value, ['instanceId', 'generation', 'bytes'], 'native plug-in state request')
		const entry = this.#owned(owner, request.instanceId)
		const generation = nonNegativeInteger(request.generation, 'plug-in state generation')
		if (!(request.bytes instanceof Uint8Array)) throw new TypeError('Native plug-in state bytes are required.')
		const outcome = this.#states.persist({ instanceId: entry.instanceId, generation, bytes: request.bytes })
		if (outcome.status !== 'persisted') return Object.freeze({ outcome, projectState: null })
		const retained = this.#states.read(entry.instanceId)
		if (!retained) throw new Error('The admitted native plug-in state was not retained.')
		const stateBody = this.#stateBodies.persist(retained.bytes)
		if (stateBody.sha256 !== retained.sha256 || stateBody.byteLength !== retained.byteLength) {
			throw new Error('Desktop library persisted a different native plug-in state body.')
		}
		entry.generation = generation
		entry.stateBody = stateBody
		return Object.freeze({ outcome, projectState: this.#projectState(entry) })
	}

	restoreState(owner: object, value: unknown): Readonly<NativePluginProjectStateProjection> {
		const request = closedRecord(
			value,
			['instanceId', 'generation', 'stateBody'],
			'native plug-in state restore request',
		)
		const entry = this.#owned(owner, request.instanceId)
		const stateBody = stateBodyDescriptor(request.stateBody)
		const record = this.#stateBodies.read(stateBody.bodyId)
		if (!record || record.sha256 !== stateBody.sha256 || record.byteLength !== stateBody.byteLength) {
			throw new Error('The native plug-in state body is unavailable or failed identity validation.')
		}
		const outcome = this.#states.persist({
			instanceId: entry.instanceId,
			generation: nonNegativeInteger(request.generation, 'plug-in state generation'),
			bytes: record.bytes,
		})
		if (outcome.status !== 'persisted') throw new Error(outcome.message)
		entry.generation = outcome.retained.generation
		entry.stateBody = stateBody
		return this.#projectState(entry)
	}

	restoreStateForRuntime(owner: object, value: unknown): Readonly<{
		projectState: NativePluginProjectStateProjection
		bytes: Uint8Array
	}> {
		const projectState = this.restoreState(owner, value)
		const record = this.#stateBodies.read(projectState.stateBody.bodyId)
		if (!record || record.sha256 !== projectState.stateBody.sha256
			|| record.byteLength !== projectState.stateBody.byteLength) {
			throw new Error('The restored native plug-in state body changed before runtime delivery.')
		}
		return Object.freeze({ projectState, bytes: Uint8Array.from(record.bytes) })
	}

	openVendorUi(owner: object, instanceId: unknown): PluginVendorUiOutcome {
		const entry = this.#owned(owner, instanceId)
		return this.#isolation.openVendorUi(entry.instanceId)
	}

	closeVendorUi(owner: object, value: unknown): boolean {
		const request = closedRecord(value, ['instanceId', 'windowHandleId'], 'vendor UI close request')
		const entry = this.#owned(owner, request.instanceId)
		return this.#isolation.closeVendorUi(
			opaqueId(request.windowHandleId, 'vendor window ID'), entry.instanceId,
		)
	}

	reportHostStopped(value: unknown): readonly Readonly<PluginContinuityDecision>[] {
		const request = closedRecord(value, ['hostId', 'reason'], 'native plug-in host stop report')
		const reason = pluginHostStopReason(request.reason)
		const outcome = this.#isolation.reportHostStopped({
			hostId: opaqueId(request.hostId, 'plug-in host ID'),
			reason,
		})
		return Object.freeze(outcome.instanceIds.map((instanceId) => {
			const entry = this.#instances.get(instanceId)
			if (entry) {
				entry.bypassed = true
				entry.continuity = 'bypass'
			}
			return this.#isolation.continuityFor({
				instanceId,
				retainedOpaqueState: this.#states.describe(instanceId).retained,
			})
		}))
	}

	reportInstanceHostStopped(owner: object, instanceId: unknown, reason: PluginHostStopReason): readonly Readonly<PluginContinuityDecision>[] {
		const entry = this.#owned(owner, instanceId, true)
		const hosted = this.#isolation.describeInstance(entry.instanceId)
		if (!hosted?.hostId) return Object.freeze([])
		return this.reportHostStopped({ hostId: hosted.hostId, reason })
	}

	close(owner: object, instanceId: unknown): boolean {
		const entry = this.#owned(owner, instanceId, true)
		this.#instances.delete(entry.instanceId)
		// The retained opaque state goes with the instance, exactly as revoke
		// and close-all already do. Leaving it filled the 256-slot retention
		// ceiling with orphans until quiescence captures failed session-wide,
		// and let a re-acquired instance id inherit another plug-in's state.
		this.#states.forget(entry.instanceId)
		return this.#isolation.releaseInstance(entry.instanceId)
	}

	revokeOwner(owner: object): void {
		this.#isolation.revokeOwner(owner)
		for (const [instanceId, entry] of this.#instances) {
			if (entry.owner !== owner) continue
			this.#instances.delete(instanceId)
			this.#states.forget(instanceId)
		}
	}

	/** Stop every live host when the user turns the tier off without making re-enable terminal. */
	closeAll(): void {
		for (const [instanceId] of this.#instances) {
			this.#isolation.releaseInstance(instanceId)
			this.#states.forget(instanceId)
		}
		this.#instances.clear()
	}

	dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		this.closeAll()
		this.#isolation.dispose()
	}

	#project(entry: InstanceEntry): Readonly<NativePluginInstanceProjection> {
		const hosted = this.#isolation.describeInstance(entry.instanceId)
		return Object.freeze({
			instanceId: entry.instanceId,
			entryId: entry.descriptor.entryId,
			stablePluginId: entry.descriptor.stableId,
			format: entry.descriptor.format,
			binarySha256: entry.descriptor.binarySha256,
			inputChannels: entry.descriptor.inputChannels,
			outputChannels: entry.descriptor.outputChannels,
			state: hosted?.state ?? 'stopped',
			enabled: entry.enabled,
			bypassed: entry.bypassed,
			latencySamples: entry.latencySamples,
			opaqueState: this.#states.describe(entry.instanceId),
		})
	}

	#projectState(entry: InstanceEntry): Readonly<NativePluginProjectStateProjection> {
		if (!entry.stateBody) throw new Error('That native plug-in instance has no persisted state body.')
		return Object.freeze({
			instanceId: entry.instanceId,
			format: entry.descriptor.format,
			stablePluginId: entry.descriptor.stableId,
			binarySha256: entry.descriptor.binarySha256,
			stateBody: entry.stateBody,
			enabled: entry.enabled,
			bypassed: entry.bypassed,
			continuity: entry.continuity,
			latencySamples: entry.latencySamples,
		})
	}

	#owned(owner: object, instanceId: unknown, allowBlocked = false): InstanceEntry {
		const id = opaqueId(instanceId, 'plug-in instance ID')
		const entry = this.#instances.get(id)
		if (!entry || entry.owner !== owner) throw new Error('That native plug-in instance belongs to another renderer.')
		if (!allowBlocked) this.#assertFormatActivated(entry.descriptor.format)
		return entry
	}

	#assertFormatActivated(format: string): void {
		if (!this.#isFormatActivated(format)) {
			throw new Error('That plug-in format remains behind its production activation gate.')
		}
	}

	#assertLive(): void {
		if (this.#disposed) throw new Error('Native plug-in hosting is shut down.')
	}
}

function stateBodyDescriptor(value: unknown): NativePluginProjectStateProjection['stateBody'] {
	const record = closedRecord(value, ['kind', 'bodyId', 'byteLength', 'sha256'], 'native plug-in state body')
	if (record.kind !== 'native-plugin-state') throw new TypeError('The native plug-in state body kind is invalid.')
	const sha256 = digest(record.sha256)
	if (record.bodyId !== `native-plugin-state:${sha256}`) {
		throw new TypeError('The native plug-in state body ID does not match its digest.')
	}
	const byteLength = nonNegativeInteger(record.byteLength, 'plug-in state byte length')
	if (byteLength > 16 * 1024 * 1024) throw new RangeError('Native plug-in state exceeds 16 MiB.')
	return Object.freeze({ kind: 'native-plugin-state', bodyId: record.bodyId, byteLength, sha256 })
}

function closedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`)
	}
	const keys = Reflect.ownKeys(value)
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${label} must contain exactly its schema fields.`)
	return value as Readonly<Record<Field, unknown>>
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError(`A bounded opaque ${label} is required.`)
	}
	return value
}

function latency(value: unknown): number {
	const result = nonNegativeInteger(value, 'plug-in latency')
	if (result > 1_048_576) throw new RangeError('Native plug-in latency exceeds the PDC ceiling.')
	return result
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`Native ${label} is invalid.`)
	return Number(value)
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError('A lowercase SHA-256 digest is required.')
	}
	return value
}

function pluginHostStopReason(value: unknown): PluginHostStopReason {
	const values: readonly string[] = [
		...PLUGIN_HOST_FAULT_REASONS,
		...PLUGIN_HOST_BENIGN_STOP_REASONS,
	]
	if (typeof value !== 'string' || !values.includes(value)) {
		throw new TypeError('A closed native plug-in host stop reason is required.')
	}
	return value as PluginHostStopReason
}
