/* SPDX-License-Identifier: AGPL-3.0-only */

export const M5A_LAB_WARMUP_HELPERS = 1
export const M5A_LAB_FRESH_HELPERS = 5
export const M5A_LAB_MALFORMED_CASES = 10_000
export const M5A_LAB_AUDIO_DURATION_MS = 1_800_000

export const M5A_LAB_FAULTS = Object.freeze([
	'abort', 'hang', 'malformed-control', 'malformed-result', 'resource-violation',
] as const)

export interface M5aObservedRuntimeProfile {
	readonly audioBackend: 'coreaudio' | 'wasapi' | 'asio' | 'pipewire' | 'alsa'
	readonly audioMode: 'shared' | 'exclusive'
	readonly sampleRate: number
	readonly bufferFrames: number
	readonly deviceIdentity: string
	readonly driverIdentity: string
}

export interface M5aLabHelper {
	readonly identity: string
	warmup(profile: M5aObservedRuntimeProfile): Promise<unknown>
	exerciseFault(kind: (typeof M5A_LAB_FAULTS)[number]): Promise<unknown>
	exerciseMalformed(request: Readonly<{ cases: number; seed: number }>): Promise<Readonly<{
		casesExecuted: number
		observations: unknown
	}>>
	runAudioLoopback(request: Readonly<{
		durationMs: number
		expectedRuntimeProfile: M5aObservedRuntimeProfile
	}>): Promise<Readonly<{
		durationMsObserved: number
		observedRuntimeProfile: M5aObservedRuntimeProfile
		observations: unknown
	}>>
	dispose(): Promise<void> | void
}

export interface M5aNativeLabDiagnosticOptions {
	readonly sourceRevision: string
	readonly budgetSha256: string
	readonly expectedRuntimeProfile: M5aObservedRuntimeProfile
	readonly createFreshHelper: (request: Readonly<{
		phase: 'warmup' | 'fresh'
		index: number
	}>) => Promise<M5aLabHelper>
	readonly now?: () => number
}

export interface M5aNativeLabRawResult {
	readonly schemaVersion: 1
	readonly sourceRevision: string
	readonly budgetSha256: string
	readonly observedRuntimeProfile: M5aObservedRuntimeProfile
	readonly startedAtMs: number
	readonly finishedAtMs: number
	readonly warmup: unknown
	readonly helpers: readonly unknown[]
}

/**
 * Bounded lab entrypoint used by the V2 collector. It returns raw helper and
 * loopback observations; it does not qualify, aggregate, or mutate a register.
 */
export async function runM5aNativeLabDiagnostic(
	options: M5aNativeLabDiagnosticOptions,
): Promise<M5aNativeLabRawResult> {
	const sourceRevision = digest(options.sourceRevision, 40, 'source revision')
	const budgetSha256 = digest(options.budgetSha256, 64, 'budget SHA-256')
	const expected = runtimeProfile(options.expectedRuntimeProfile)
	if (typeof options.createFreshHelper !== 'function') throw new TypeError('A fresh-helper lab factory is required.')
	const now = options.now ?? (() => Date.now())
	const startedAtMs = timestamp(now())
	const identities = new Set<string>()
	const warmupHelper = await options.createFreshHelper({ phase: 'warmup', index: 0 })
	const warmupIdentity = helperIdentity(warmupHelper, identities)
	let warmup: unknown
	try {
		warmup = Object.freeze({
			helperIdentity: warmupIdentity,
			observation: await warmupHelper.warmup(expected),
		})
	} finally {
		await warmupHelper.dispose()
	}
	const helpers: unknown[] = []
	let malformedTotal = 0
	let loopback: Awaited<ReturnType<M5aLabHelper['runAudioLoopback']>> | null = null
	for (let index = 0; index < M5A_LAB_FRESH_HELPERS; index += 1) {
		const helper = await options.createFreshHelper({ phase: 'fresh', index })
		const identity = helperIdentity(helper, identities)
		try {
			const faults = []
			for (const kind of M5A_LAB_FAULTS) {
				faults.push(Object.freeze({ kind, observation: await helper.exerciseFault(kind) }))
			}
			const cases = malformedCasesFor(index)
			const malformed = await helper.exerciseMalformed({ cases, seed: 0x5a00 + index })
			if (malformed.casesExecuted !== cases) {
				throw new Error(`Fresh helper ${String(index)} executed the wrong malformed-case count.`)
			}
			malformedTotal += malformed.casesExecuted
			const helperLoopback = index === 0
				? await helper.runAudioLoopback({ durationMs: M5A_LAB_AUDIO_DURATION_MS, expectedRuntimeProfile: expected })
				: null
			if (helperLoopback !== null) {
				if (helperLoopback.durationMsObserved < M5A_LAB_AUDIO_DURATION_MS) {
					throw new Error('The selected audio loopback did not run for the required 1,800 seconds.')
				}
				const observed = runtimeProfile(helperLoopback.observedRuntimeProfile)
				if (!sameRuntimeProfile(expected, observed)) {
					throw new Error('The observed audio device/driver profile drifted from the bound lab profile.')
				}
				loopback = Object.freeze({ ...helperLoopback, observedRuntimeProfile: observed })
			}
			helpers.push(Object.freeze({
				index,
				helperIdentity: identity,
				faults: Object.freeze(faults),
				malformed: Object.freeze({ ...malformed }),
				loopback: helperLoopback,
			}))
		} finally {
			await helper.dispose()
		}
	}
	if (loopback === null) throw new Error('The selected audio loopback produced no observation.')
	if (malformedTotal !== M5A_LAB_MALFORMED_CASES) throw new Error('The malformed cohort did not total 10,000 cases.')
	return Object.freeze({
		schemaVersion: 1,
		sourceRevision,
		budgetSha256,
		observedRuntimeProfile: loopback.observedRuntimeProfile,
		startedAtMs,
		finishedAtMs: timestamp(now()),
		warmup,
		helpers: Object.freeze(helpers),
	})
}

function malformedCasesFor(index: number): number {
	const base = Math.floor(M5A_LAB_MALFORMED_CASES / M5A_LAB_FRESH_HELPERS)
	return base + (index < M5A_LAB_MALFORMED_CASES % M5A_LAB_FRESH_HELPERS ? 1 : 0)
}

function runtimeProfile(value: M5aObservedRuntimeProfile): M5aObservedRuntimeProfile {
	const record = closedRecord(value, [
		'audioBackend', 'audioMode', 'sampleRate', 'bufferFrames', 'deviceIdentity', 'driverIdentity',
	])
	if (!['coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa'].includes(String(record.audioBackend))) {
		throw new TypeError('The observed audio backend is invalid.')
	}
	if (record.audioMode !== 'shared' && record.audioMode !== 'exclusive') {
		throw new TypeError('The observed audio mode is invalid.')
	}
	return Object.freeze({
		audioBackend: record.audioBackend as M5aObservedRuntimeProfile['audioBackend'],
		audioMode: record.audioMode,
		sampleRate: integer(record.sampleRate, 8_000, 768_000, 'sample rate'),
		bufferFrames: integer(record.bufferFrames, 1, 16_384, 'buffer frames'),
		deviceIdentity: boundedIdentity(record.deviceIdentity, 'device identity'),
		driverIdentity: boundedIdentity(record.driverIdentity, 'driver identity'),
	})
}

function sameRuntimeProfile(left: M5aObservedRuntimeProfile, right: M5aObservedRuntimeProfile): boolean {
	return Object.keys(left).every((key) => left[key as keyof M5aObservedRuntimeProfile]
		=== right[key as keyof M5aObservedRuntimeProfile])
}

function helperIdentity(helper: M5aLabHelper, seen: Set<string>): string {
	const identity = boundedIdentity(helper?.identity, 'fresh helper identity')
	if (seen.has(identity)) throw new Error('The lab factory reused a helper identity; the cohort is not fresh.')
	seen.add(identity)
	return identity
}

function closedRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Runtime profile must be a record.')
	const keys = Reflect.ownKeys(value)
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Runtime profile must contain exactly its closed fields.')
	}
	return value as Record<string, unknown>
}

function boundedIdentity(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 512 || value.includes('\0')) {
		throw new TypeError(`The ${label} must be bounded text.`)
	}
	return value
}

function digest(value: unknown, length: number, label: string): string {
	if (typeof value !== 'string' || !new RegExp(`^[a-f\\d]{${String(length)}}$`, 'u').test(value)) {
		throw new TypeError(`The ${label} is invalid.`)
	}
	return value
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The observed ${label} is outside its bounds.`)
	}
	return Number(value)
}

function timestamp(value: unknown): number {
	return integer(value, 0, Number.MAX_SAFE_INTEGER, 'lab timestamp')
}
