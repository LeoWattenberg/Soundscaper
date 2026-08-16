/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeMixerGraphV21, type MixerEdgeV21 } from '../mixer-graph-v21.ts'
import { canonicalParameterAddressKey, type StripRef } from '../parameter-address.ts'
import { effectLatencyFrames } from './effect-rack.ts'
import {
	compileProjectPathPdcPlanV21,
	type ProjectPathPdcPlanV21,
} from './project-path-pdc-plan-v21.ts'
import type { EngineEffect } from './types.ts'

/**
 * Milestone 5A latency admission: what a hosted native effect claims about its
 * own delay, and how that claim reaches the exact V21 per-path compensation.
 *
 * The claim is never authoritative on arrival. A native instance reports into a
 * ledger that owns three separable decisions:
 *
 * 1. Admission. A value outside the bound, or one that keeps moving inside the
 *    stability window, faults the instance and bypasses it instead of being
 *    absorbed into the graph. A faulted instance contributes exactly zero until
 *    an explicit re-enable, so nonsense cannot make the compensation drift.
 * 2. Generation scope. An accepted change never edits the running plan. It
 *    compiles a whole new revision, staged as `pending` while the published one
 *    stays authoritative, and only a commit on a block boundary swaps the two in
 *    one assignment. `revisionAtFrame` is total over the frame axis for exactly
 *    this reason: every frame resolves to one revision, so no window exists in
 *    which neither plan is authoritative, and none in which both are.
 * 3. Projection. The V21 compiler derives latency from the project document, so
 *    an accepted value is materialized into a PDC-only projection of that
 *    document before compileProjectPathPdcPlanV21 sees it. The document's own
 *    gates win there: a slot the project disables contributes nothing however
 *    loudly the plug-in claims otherwise. Nothing here owns or publishes a
 *    project revision, and each projected record is marked as such.
 *
 * The ledger is scoped to one project revision; a project edit produces a new
 * ledger, which keeps this module out of the canonical revision path entirely.
 */

/** A plug-in claiming more delay than this is claiming a number, not a latency. */
export const NATIVE_EFFECT_LATENCY_MAX_SECONDS = 2
/** The same bound at the highest sample rate the compiler admits. */
export const NATIVE_EFFECT_LATENCY_HARD_MAX_FRAMES = 1_536_000
export const NATIVE_EFFECT_LATENCY_STABILITY_WINDOW_MS = 10_000
/**
 * "Unstable" is concrete: more than this many accepted *changes* inside one
 * trailing window. Changes are counted rather than distinct values, because the
 * worst offender alternates between two numbers forever — a plug-in that settles
 * reports once or twice, one that oscillates never converges.
 */
export const NATIVE_EFFECT_LATENCY_MAX_CHANGES_PER_WINDOW = 4
/** The render quantum: the smallest boundary a graph swap can be safe on. */
export const NATIVE_EFFECT_LATENCY_BLOCK_FRAMES = 128
/** Swap history is bounded; the oldest retained window always covers frame 0. */
export const NATIVE_EFFECT_LATENCY_RETAINED_REVISIONS = 8
/** Marks a projected effect record, so a projection can never pass as authored. */
export const NATIVE_EFFECT_LATENCY_PROJECTION_MARKER = 'nativeEffectLatencyProjectionV21'

const PROBE_PARAMETER = 'native-effect-latency-v21'
const PROJECTED_EFFECT_TYPE = 'limiter'
const MAX_INSTANCE_ID_LENGTH = 128
/** The mixer graph's own identifier bound, so no wider id reaches a message. */
const MAX_EFFECT_ID_LENGTH = 256
/** A drive-relative Windows path needs no separator, so it is refused as well. */
const DRIVE_SHAPED_ID = /^[a-z]:/iu
/** Stands in for an id that would not have been admitted in the first place. */
const REDACTED_INSTANCE_ID = '(rejected)'
const PATH_SHAPED_ID = /[\\/\u0000]/u

export type NativeEffectLatencyFaultCodeV21 =
	| 'latency-out-of-range'
	| 'latency-unstable'
	| 'host-lost'
	| 'plan-rejected'

export type NativeEffectLatencyStateV21 = 'active' | 'bypassed' | 'faulted'

export interface NativeEffectInstanceV21 {
	/** An opaque handle minted by main. Never a path, never a binary identity. */
	readonly instanceId: string
	readonly strip: StripRef
	readonly effectId: string
}

export interface NativeEffectLatencyRevisionV21 {
	readonly revision: number
	readonly plan: ProjectPathPdcPlanV21
	/** Independent check of the compiled plan; anything but zero is a defect. */
	readonly pdcErrorSamples: number
	readonly contributedFrames: ReadonlyMap<string, number>
	readonly reportedFrames: ReadonlyMap<string, number>
	readonly instanceStates: ReadonlyMap<string, NativeEffectLatencyStateV21>
	readonly faults: ReadonlyMap<string, NativeEffectLatencyFaultCodeV21>
}

export type NativeEffectLatencyReportV21 = Readonly<{
	status: 'accepted' | 'unchanged' | 'faulted' | 'ignored'
	instanceId: string
	detail: string
	fault: NativeEffectLatencyFaultCodeV21 | null
	pendingRevision: number | null
}>

export type NativeEffectLatencySwapV21 = Readonly<{
	status: 'swapped' | 'idle' | 'unsafe-boundary'
	atFrame: number
	revision: number
	previousRevision: number
}>

export interface NativeEffectLatencyProjectionV21 {
	/** A PDC-only document. It is never a project revision and never persisted. */
	readonly project: unknown
	/** What actually reached the compiler, which is zero for a gated slot. */
	readonly appliedFrames: ReadonlyMap<string, number>
	/** Slots the document's own enable or rack switch held at zero. */
	readonly suppressedEffects: ReadonlySet<string>
}

export interface NativeEffectLatencyLedgerOptionsV21 {
	readonly project: unknown
	readonly instances: readonly NativeEffectInstanceV21[]
	readonly sampleRate?: number
	readonly blockFrames?: number
	/** Injected so stability is decided by a clock the caller controls. */
	readonly now?: () => number
	readonly stabilityWindowMs?: number
	readonly maxChangesPerWindow?: number
	readonly maxLatencySeconds?: number
	/** The canonical compiler by default; a seam for a bounded or failing one. */
	readonly compile?: NativeEffectPlanCompilerV21
}

/** The canonical V21 compiler's own signature, so no caller widens its input. */
export type NativeEffectPlanCompilerV21 = typeof compileProjectPathPdcPlanV21

export interface NativeEffectLatencyLedgerV21 {
	readonly sampleRate: number
	readonly blockFrames: number
	readonly maxLatencyFrames: number
	readonly authoritative: NativeEffectLatencyRevisionV21
	readonly pending: NativeEffectLatencyRevisionV21 | null
	readonly instances: readonly NativeEffectInstanceV21[]
	revisionAtFrame(frame: number): NativeEffectLatencyRevisionV21
	report(instanceId: string, latencyFrames: number): NativeEffectLatencyReportV21
	setBypassed(instanceId: string, bypassed: boolean): NativeEffectLatencyReportV21
	reportHostLoss(instanceId: string): NativeEffectLatencyReportV21
	reinstate(instanceId: string): NativeEffectLatencyReportV21
	commitAtBlockBoundary(frame: number): NativeEffectLatencySwapV21
}

interface InstanceState {
	readonly instance: NativeEffectInstanceV21
	readonly key: string
	frames: number
	bypassed: boolean
	fault: NativeEffectLatencyFaultCodeV21 | null
	changes: number[]
}

interface RevisionWindow {
	readonly fromFrame: number
	readonly revision: NativeEffectLatencyRevisionV21
}

interface ProjectionSink {
	readonly applied: Map<string, number>
	readonly suppressed: Set<string>
}

type StageOutcome = Readonly<{ fault: 'plan-rejected' | null; detail: string }>

const STAGED: StageOutcome = Object.freeze({ fault: null, detail: 'staged' })
const REJECTED: StageOutcome = Object.freeze({ fault: 'plan-rejected', detail: 'plan-rejected' })
const UNBUILDABLE: StageOutcome = Object.freeze({ fault: 'plan-rejected', detail: 'plan-unbuildable' })

/** The collision-free identity of one effect slot, reused from parameter addressing. */
export function nativeEffectLatencyKeyV21(strip: unknown, effectId: unknown): string {
	return canonicalParameterAddressKey({ kind: 'effect', strip, effectId, parameterId: PROBE_PARAMETER })
}

/**
 * Rewrites the named effect slots into records declaring exactly the accepted
 * frame count — or zero where the document's own gates hold the slot off — and
 * leaves every other byte alone. Only the path down to a rewritten rack is
 * copied, so an untouched project comes back unchanged and nothing is mutated.
 */
export function projectNativeEffectLatencyV21(
	project: unknown, latencyFramesByEffect: ReadonlyMap<string, number>, sampleRate: number,
): NativeEffectLatencyProjectionV21 {
	if (!project || typeof project !== 'object') throw new TypeError('A V21 project is required')
	const sink: ProjectionSink = { applied: new Map(), suppressed: new Set() }
	const source = project as Record<string, unknown>
	const next: Record<string, unknown> = { ...source }
	const tracks = source.tracks
	if (Array.isArray(tracks)) {
		next.tracks = tracks.map((track) => {
			const record = track as Record<string, unknown> | null
			if (!record || typeof record !== 'object' || record.type !== 'audio' || typeof record.id !== 'string') return track
			return projectHost(record, { kind: 'track', id: record.id }, latencyFramesByEffect, sampleRate, sink)
		})
	}
	// Assigned only when the rack actually changed, so a project with no master
	// does not gain the key on the way through.
	const master = projectHost(source.master, { kind: 'master' }, latencyFramesByEffect, sampleRate, sink)
	if (master !== source.master) next.master = master
	const mixer = source.mixer as Record<string, unknown> | null | undefined
	if (mixer && typeof mixer === 'object') {
		const mixerNext: Record<string, unknown> = { ...mixer }
		for (const field of ['groups', 'sends', 'cues'] as const) {
			const nodes = mixer[field]
			if (!Array.isArray(nodes)) continue
			mixerNext[field] = nodes.map((node) => {
				const record = node as Record<string, unknown> | null
				if (!record || typeof record !== 'object' || typeof record.id !== 'string') return node
				return projectHost(record, { kind: 'mixer-node', id: record.id }, latencyFramesByEffect, sampleRate, sink)
			})
		}
		next.mixer = mixerNext
	}
	return Object.freeze({ project: next, appliedFrames: sink.applied, suppressedEffects: sink.suppressed })
}

/**
 * Re-derives every compensation the plan published and sums the misalignment. A
 * non-zero result means the solve and the routing it claims to have solved have
 * come apart — the one thing a latency change must never do silently.
 */
export function nativeEffectPdcErrorSamplesV21(project: unknown, plan: ProjectPathPdcPlanV21): number {
	const graph = normalizeMixerGraphV21((project as { readonly mixer?: unknown } | null)?.mixer)
	let error = 0
	for (const edge of graph.edges) {
		if (!edge.enabled) continue
		const arrival = (plan.nodeOutputLatencyFrames.get(endpointKey(edge.source)) ?? 0)
			+ (plan.edgeCompensationFrames.get(edge.id) ?? 0)
		error += Math.abs(alignedArrivalFrames(edge, plan) - arrival)
	}
	return error
}

export function createNativeEffectLatencyLedgerV21(options: NativeEffectLatencyLedgerOptionsV21): NativeEffectLatencyLedgerV21 {
	const project = options.project
	if (!project || typeof project !== 'object') throw new TypeError('A V21 project is required')
	const sampleRate = boundedInteger(
		options.sampleRate ?? (project as { readonly sampleRate?: unknown }).sampleRate ?? 48_000,
		'sampleRate', 8_000, 768_000,
	)
	const blockFrames = boundedInteger(options.blockFrames ?? NATIVE_EFFECT_LATENCY_BLOCK_FRAMES, 'blockFrames', 1, 65_536)
	const stabilityWindowMs = boundedInteger(
		options.stabilityWindowMs ?? NATIVE_EFFECT_LATENCY_STABILITY_WINDOW_MS, 'stabilityWindowMs', 1, 3_600_000,
	)
	const maxChanges = boundedInteger(
		options.maxChangesPerWindow ?? NATIVE_EFFECT_LATENCY_MAX_CHANGES_PER_WINDOW, 'maxChangesPerWindow', 1, 1_024,
	)
	const maxLatencySeconds = options.maxLatencySeconds ?? NATIVE_EFFECT_LATENCY_MAX_SECONDS
	if (typeof maxLatencySeconds !== 'number' || !Number.isFinite(maxLatencySeconds) || maxLatencySeconds <= 0) {
		throw new TypeError('maxLatencySeconds must be a positive finite number')
	}
	const maxLatencyFrames = Math.min(Math.floor(maxLatencySeconds * sampleRate), NATIVE_EFFECT_LATENCY_HARD_MAX_FRAMES)
	const now = options.now ?? (() => Date.now())
	const compile = options.compile ?? compileProjectPathPdcPlanV21
	const instances = new Map<string, InstanceState>()
	const claimedKeys = new Set<string>()
	for (const declared of options.instances) {
		const instance = normalizeInstance(declared)
		if (instances.has(instance.instanceId)) throw new TypeError(`Duplicate native effect instance ${instance.instanceId}`)
		const key = nativeEffectLatencyKeyV21(instance.strip, instance.effectId)
		if (claimedKeys.has(key)) throw new TypeError(`Two native instances claim effect ${instance.effectId}`)
		claimedKeys.add(key)
		instances.set(instance.instanceId, { instance, key, frames: 0, bypassed: false, fault: null, changes: [] })
	}

	const buildRevision = (revision: number): Readonly<{
		revision: NativeEffectLatencyRevisionV21
		applied: ReadonlyMap<string, number>
	}> => {
		const requested = new Map<string, number>()
		for (const state of instances.values()) {
			requested.set(state.key, state.fault !== null || state.bypassed ? 0 : state.frames)
		}
		const projection = projectNativeEffectLatencyV21(project, requested, sampleRate)
		const plan = compile(projection.project as Parameters<NativeEffectPlanCompilerV21>[0], { sampleRate })
		const pdcErrorSamples = nativeEffectPdcErrorSamplesV21(projection.project, plan)
		if (pdcErrorSamples !== 0) throw new RangeError(`Native effect latency left ${pdcErrorSamples} samples of PDC error`)
		const contributed = new Map<string, number>()
		const reported = new Map<string, number>()
		const instanceStates = new Map<string, NativeEffectLatencyStateV21>()
		const faults = new Map<string, NativeEffectLatencyFaultCodeV21>()
		for (const [instanceId, state] of instances) {
			// Read back from the projection rather than from the request, so the
			// ledger can never claim a contribution the compiled plan does not carry.
			contributed.set(instanceId, projection.appliedFrames.get(state.key) ?? 0)
			reported.set(instanceId, state.frames)
			instanceStates.set(instanceId, state.fault !== null
				? 'faulted'
				: state.bypassed || projection.suppressedEffects.has(state.key) ? 'bypassed' : 'active')
			if (state.fault !== null) faults.set(instanceId, state.fault)
		}
		return Object.freeze({
			revision: Object.freeze({
				revision, plan, pdcErrorSamples,
				contributedFrames: contributed, reportedFrames: reported, instanceStates, faults,
			}),
			applied: projection.appliedFrames,
		})
	}

	const first = buildRevision(0)
	for (const state of instances.values()) {
		if (!first.applied.has(state.key)) {
			throw new TypeError(`Native effect instance ${state.instance.instanceId} names no effect in this project`)
		}
	}

	let published = first.revision
	let pending: NativeEffectLatencyRevisionV21 | null = null
	let lastSwapFrame = -1
	const windows: RevisionWindow[] = [Object.freeze({ fromFrame: 0, revision: published })]

	/**
	 * Whatever was staged came from ledger state that has since moved on, and the
	 * revision meant to replace it will not compile, so publishing either would
	 * put a plan behind the ledger — that is how an already-faulted instance ends
	 * up compensated for. Emptying the slot keeps the last revision that did
	 * compile authoritative; the next stage that succeeds catches up.
	 */
	const discardPending = (): StageOutcome => {
		pending = null
		return UNBUILDABLE
	}

	/**
	 * Stages a revision without touching the published one. The reporting
	 * instance is faulted to zero and the build retried once, so the usual worst
	 * case is the plan already known to compile. The compiler's own message is
	 * deliberately not carried out: a report is bounded renderer-facing status.
	 */
	const stage = (state: InstanceState | null): StageOutcome => {
		const next = published.revision + 1
		try {
			pending = buildRevision(next).revision
			return STAGED
		} catch (_error) {
			if (state === null || state.fault !== null) return discardPending()
			state.fault = 'plan-rejected'
		}
		try {
			pending = buildRevision(next).revision
			return REJECTED
		} catch (_error) {
			return discardPending()
		}
	}

	const fault = (state: InstanceState, code: NativeEffectLatencyFaultCodeV21): NativeEffectLatencyReportV21 => {
		state.fault = code
		const result = stage(null)
		return outcome('faulted', state.instance.instanceId, result.fault === null ? code : result.detail, code, pending)
	}

	/** One shape for every staged change, so a refused plan is never labelled accepted. */
	const staged = (result: StageOutcome, state: InstanceState, detail: string): NativeEffectLatencyReportV21 => (
		result.fault === null
			? outcome('accepted', state.instance.instanceId, detail, null, pending)
			: outcome('faulted', state.instance.instanceId, result.detail, result.fault, pending)
	)

	const resolve = (instanceId: unknown): InstanceState | null => (
		typeof instanceId === 'string' ? instances.get(instanceId) ?? null : null
	)

	return {
		sampleRate,
		blockFrames,
		maxLatencyFrames,
		get authoritative(): NativeEffectLatencyRevisionV21 { return published },
		get pending(): NativeEffectLatencyRevisionV21 | null { return pending },
		get instances(): readonly NativeEffectInstanceV21[] {
			return Object.freeze(Array.from(instances.values(), (state) => state.instance))
		},
		revisionAtFrame(frame: number): NativeEffectLatencyRevisionV21 {
			const at = boundedInteger(frame, 'frame', 0, Number.MAX_SAFE_INTEGER)
			let resolved: NativeEffectLatencyRevisionV21 | null = null
			for (const window of windows) {
				if (window.fromFrame > at) break
				resolved = window.revision
			}
			// The oldest retained window always starts at frame 0, so every frame
			// on the axis resolves. A gap here is the failure this ledger forbids.
			if (resolved === null) throw new RangeError(`No graph revision covers frame ${at}`)
			return resolved
		},
		report(instanceId: string, latencyFrames: number): NativeEffectLatencyReportV21 {
			const state = resolve(instanceId)
			if (state === null) return outcome('ignored', reportableInstanceId(instanceId), 'unknown-instance', null, pending)
			if (state.fault !== null) return outcome('ignored', state.instance.instanceId, 'faulted-instance', state.fault, pending)
			if (!Number.isSafeInteger(latencyFrames) || latencyFrames < 0 || latencyFrames > maxLatencyFrames) {
				return fault(state, 'latency-out-of-range')
			}
			if (latencyFrames === state.frames) return outcome('unchanged', state.instance.instanceId, 'same-latency', null, pending)
			state.frames = latencyFrames
			const at = now()
			state.changes = state.changes.filter((stamp) => at - stamp < stabilityWindowMs)
			state.changes.push(at)
			if (state.changes.length > maxChanges) return fault(state, 'latency-unstable')
			return staged(stage(state), state, 'staged')
		},
		setBypassed(instanceId: string, bypassed: boolean): NativeEffectLatencyReportV21 {
			const state = resolve(instanceId)
			if (state === null) return outcome('ignored', reportableInstanceId(instanceId), 'unknown-instance', null, pending)
			if (state.fault !== null) return outcome('ignored', state.instance.instanceId, 'faulted-instance', state.fault, pending)
			if (state.bypassed === bypassed) return outcome('unchanged', state.instance.instanceId, 'same-bypass', null, pending)
			state.bypassed = bypassed
			return staged(stage(null), state, bypassed ? 'bypassed' : 'reinserted')
		},
		reportHostLoss(instanceId: string): NativeEffectLatencyReportV21 {
			const state = resolve(instanceId)
			if (state === null) return outcome('ignored', reportableInstanceId(instanceId), 'unknown-instance', null, pending)
			if (state.fault !== null) return outcome('unchanged', state.instance.instanceId, 'already-faulted', state.fault, pending)
			return fault(state, 'host-lost')
		},
		/** The explicit re-enable. The instance starts over at zero and must re-report. */
		reinstate(instanceId: string): NativeEffectLatencyReportV21 {
			const state = resolve(instanceId)
			if (state === null) return outcome('ignored', reportableInstanceId(instanceId), 'unknown-instance', null, pending)
			if (state.fault === null) return outcome('unchanged', state.instance.instanceId, 'not-faulted', null, pending)
			state.fault = null
			state.frames = 0
			state.changes = []
			return staged(stage(null), state, 'reinstated')
		},
		commitAtBlockBoundary(frame: number): NativeEffectLatencySwapV21 {
			const at = boundedInteger(frame, 'frame', 0, Number.MAX_SAFE_INTEGER)
			const staged = pending
			if (staged === null) return swap('idle', at, published.revision, published.revision)
			// Mid-block the two plans would disagree about samples already in
			// flight, and a swap behind one already published would rewrite audio
			// the device has heard, so both keep the old plan authoritative.
			if (at % blockFrames !== 0 || at <= lastSwapFrame) {
				return swap('unsafe-boundary', at, published.revision, published.revision)
			}
			const previous = published.revision
			// The whole swap. Both plans are complete before this line and exactly
			// one is authoritative after it.
			published = staged
			pending = null
			lastSwapFrame = at
			windows.push(Object.freeze({ fromFrame: at, revision: staged }))
			if (windows.length > NATIVE_EFFECT_LATENCY_RETAINED_REVISIONS) {
				windows.shift()
				const oldest = windows[0]
				if (oldest) windows[0] = Object.freeze({ fromFrame: 0, revision: oldest.revision })
			}
			return swap('swapped', at, published.revision, previous)
		},
	}
}

function projectHost(
	host: unknown,
	strip: StripRef,
	latencyFramesByEffect: ReadonlyMap<string, number>,
	sampleRate: number,
	sink: ProjectionSink,
): unknown {
	if (!host || typeof host !== 'object') return host
	const effects = (host as { readonly effects?: unknown }).effects
	if (!Array.isArray(effects)) return host
	// The rack switch and the slot's own enable are authored state the compiler
	// already honours for every other effect. Compensating for a native effect
	// the user switched off would delay a path around something that is not in
	// the signal, so a gated slot is projected at zero, not at its claim. The
	// gate itself mirrors the compiler: a mixer strip opts in, a track opts out.
	const active = (host as { readonly effectsActive?: unknown }).effectsActive
	const rackActive = strip.kind === 'mixer-node' ? active === true : active !== false
	let rewritten = false
	const next = effects.map((candidate) => {
		const record = candidate as { readonly id?: unknown; enabled?: unknown; bypassed?: unknown } | null
		if (!record || typeof record !== 'object' || typeof record.id !== 'string' || record.id.length === 0) return candidate
		const key = nativeEffectLatencyKeyV21(strip, record.id)
		const frames = latencyFramesByEffect.get(key)
		if (frames === undefined) return candidate
		const gated = !rackActive || record.enabled === false || record.bypassed === true
		rewritten = true
		sink.applied.set(key, gated ? 0 : frames)
		if (gated) sink.suppressed.add(key)
		return projectedEffectRecord(record.id, gated ? 0 : frames, sampleRate)
	})
	return rewritten ? { ...(host as Record<string, unknown>), effects: next } : host
}

/**
 * The compiler reads latency out of the document, and the only declaration it
 * honours is a limiter lookahead in seconds, so an accepted frame count is
 * written as the lookahead that rounds back to exactly those frames. A bypassed,
 * gated or zero instance keeps its slot — a sidechain may still address it —
 * while contributing nothing, which is what makes the plan identical to one
 * compiled from a project that never carried the effect.
 */
function projectedEffectRecord(id: string, frames: number, sampleRate: number): Readonly<Record<string, unknown>> {
	const record = Object.freeze({
		id, type: PROJECTED_EFFECT_TYPE, enabled: frames > 0, bypassed: frames === 0,
		params: Object.freeze({ lookahead: exactLookaheadSeconds(frames, sampleRate) }),
		[NATIVE_EFFECT_LATENCY_PROJECTION_MARKER]: true,
	})
	const realized = effectLatencyFrames(record as EngineEffect, sampleRate)
	if (realized !== frames) {
		throw new RangeError(`A native latency of ${frames} frames declares as ${realized} at ${sampleRate} Hz`)
	}
	return record
}

const LOOKAHEAD_BITS = new DataView(new ArrayBuffer(8))

/**
 * frames / sampleRate can land one ULP above the frame count it names, and the
 * compiler's ceil would turn that into a whole extra frame of compensation, so
 * the seconds value is stepped down by single ULPs until the round trip is exact
 * rather than trusting the division. The caller verifies the result regardless.
 */
function exactLookaheadSeconds(frames: number, sampleRate: number): number {
	if (frames === 0) return 0
	let seconds = frames / sampleRate
	for (let step = 0; step < 4 && Math.ceil(seconds * sampleRate) > frames; step += 1) {
		LOOKAHEAD_BITS.setFloat64(0, seconds)
		LOOKAHEAD_BITS.setBigUint64(0, LOOKAHEAD_BITS.getBigUint64(0) - 1n)
		seconds = LOOKAHEAD_BITS.getFloat64(0)
	}
	return seconds
}

function alignedArrivalFrames(edge: MixerEdgeV21, plan: ProjectPathPdcPlanV21): number {
	const destination = edge.destination
	if (destination.kind === 'output') return plan.outputLatencyFrames.get(destination.id) ?? 0
	if (destination.kind === 'effect-sidechain') {
		const { strip, effectId } = destination
		return plan.automationLatencyFrames({ kind: 'effect', strip, effectId, parameterId: PROBE_PARAMETER })
	}
	const key = destination.kind === 'master' ? 'master' : `mixer-node:${destination.id}`
	return plan.nodeInputLatencyFrames.get(key) ?? 0
}

function endpointKey(endpoint: MixerEdgeV21['source']): string {
	return endpoint.kind === 'master' ? 'master' : `${endpoint.kind}:${endpoint.id}`
}

function normalizeInstance(value: NativeEffectInstanceV21): NativeEffectInstanceV21 {
	if (!value || typeof value !== 'object') throw new TypeError('A native effect instance must be an object')
	const instanceId = value.instanceId
	if (typeof instanceId !== 'string' || instanceId.length === 0 || instanceId.length > MAX_INSTANCE_ID_LENGTH) {
		throw new TypeError(`A native effect instance id must be 1 to ${MAX_INSTANCE_ID_LENGTH} characters`)
	}
	// The renderer only ever holds opaque handles. An id shaped like a path is
	// main-side data that escaped its owner, refused here rather than stored
	// where a plan or a log could republish it.
	if (pathShapedId(instanceId)) throw new TypeError('A native effect instance id must not carry a path')
	if (typeof value.effectId !== 'string' || value.effectId.length === 0 || value.effectId.length > MAX_EFFECT_ID_LENGTH) {
		throw new TypeError(`A native effect instance must name an effect of at most ${MAX_EFFECT_ID_LENGTH} characters`)
	}
	// nativeEffectLatencyKeyV21 normalizes and rejects a malformed strip ref.
	nativeEffectLatencyKeyV21(value.strip, value.effectId)
	return Object.freeze({ instanceId, strip: value.strip, effectId: value.effectId })
}

function pathShapedId(value: string): boolean {
	return PATH_SHAPED_ID.test(value) || DRIVE_SHAPED_ID.test(value)
}

/**
 * A report names the id it was handed, and an unknown id is caller data. Echoing
 * it verbatim would republish exactly what normalizeInstance refuses to store — a
 * raw path — or return a string far past the control envelope bound, so an id that
 * would not have been admitted is redacted. A benign one is still named back.
 */
function reportableInstanceId(value: unknown): string {
	const admissible = typeof value === 'string'
		&& value.length > 0 && value.length <= MAX_INSTANCE_ID_LENGTH && !pathShapedId(value)
	return admissible ? value as string : REDACTED_INSTANCE_ID
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}`)
	}
	return value as number
}

function outcome(
	status: NativeEffectLatencyReportV21['status'], instanceId: string, detail: string,
	fault: NativeEffectLatencyFaultCodeV21 | null, pending: NativeEffectLatencyRevisionV21 | null,
): NativeEffectLatencyReportV21 {
	return Object.freeze({ status, instanceId, detail, fault, pendingRevision: pending?.revision ?? null })
}

function swap(
	status: NativeEffectLatencySwapV21['status'], atFrame: number, revision: number, previousRevision: number,
): NativeEffectLatencySwapV21 {
	return Object.freeze({ status, atFrame, revision, previousRevision })
}
