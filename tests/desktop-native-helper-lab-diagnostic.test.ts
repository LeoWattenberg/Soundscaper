/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
	M5A_LAB_AUDIO_DURATION_MS,
	M5A_LAB_FAULTS,
	runM5aNativeLabDiagnostic,
} from '../desktop/native-helper-lab-diagnostic.ts'

const PROFILE = Object.freeze({
	audioBackend: 'pipewire' as const,
	audioMode: 'shared' as const,
	sampleRate: 48_000,
	bufferFrames: 1_024,
	deviceIdentity: 'pipewire-node:42',
	driverIdentity: 'PipeWire 1.0.5 runtime ABI',
})

test('lab CLI validates its arguments before requiring staged runtime code', () => {
	const result = spawnSync(process.execPath, ['scripts/run-m5a-native-lab-diagnostic.mjs'], {
		cwd: new URL('../', import.meta.url),
		encoding: 'utf8',
	})
	assert.notEqual(result.status, 0)
	assert.match(result.stderr, /Usage: --provider=/u)
	assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/u)
})

test('lab entrypoint returns the exact raw warmup/fresh/malformed/long-loopback cohort', async () => {
	let helperSequence = 0
	let malformedTotal = 0
	let faultTotal = 0
	const disposed: string[] = []
	const result = await runM5aNativeLabDiagnostic({
		sourceRevision: 'a'.repeat(40),
		budgetSha256: 'b'.repeat(64),
		expectedRuntimeProfile: PROFILE,
		now: (() => { let now = 100; return () => ++now })(),
		createFreshHelper: async ({ phase, index }) => {
			const identity = `${phase}-helper-${String(index)}-${String(++helperSequence)}`
			return {
				identity,
				warmup: async () => ({ observed: 'warm' }),
				exerciseFault: async (kind) => { faultTotal += 1; return { kind, exitCode: 9 } },
				exerciseMalformed: async ({ cases, seed }) => {
					malformedTotal += cases
					return { casesExecuted: cases, observations: { seed, refusals: cases } }
				},
				runAudioLoopback: async ({ durationMs }) => ({
					durationMsObserved: durationMs,
					observedRuntimeProfile: PROFILE,
					observations: { frames: durationMs * 48 },
				}),
				dispose: () => { disposed.push(identity) },
			}
		},
	})
	assert.equal(result.sourceRevision, 'a'.repeat(40))
	assert.equal(result.budgetSha256, 'b'.repeat(64))
	assert.deepEqual(result.observedRuntimeProfile, PROFILE)
	assert.equal(result.helpers.length, 5)
	assert.equal(malformedTotal, 10_000)
	assert.equal(faultTotal, 5 * M5A_LAB_FAULTS.length)
	assert.equal((result.helpers[0] as { loopback: { durationMsObserved: number } }).loopback.durationMsObserved,
		M5A_LAB_AUDIO_DURATION_MS)
	assert.equal(disposed.length, 6)
})

test('lab entrypoint refuses reused helpers and runtime-profile drift', async () => {
	const helper = {
		identity: 'same-helper',
		warmup: async () => null,
		exerciseFault: async () => null,
		exerciseMalformed: async ({ cases }: { cases: number }) => ({ casesExecuted: cases, observations: null }),
		runAudioLoopback: async () => ({
			durationMsObserved: M5A_LAB_AUDIO_DURATION_MS,
			observedRuntimeProfile: { ...PROFILE, bufferFrames: 512 },
			observations: null,
		}),
		dispose: () => undefined,
	}
	await assert.rejects(() => runM5aNativeLabDiagnostic({
		sourceRevision: 'c'.repeat(40), budgetSha256: 'd'.repeat(64),
		expectedRuntimeProfile: PROFILE,
		createFreshHelper: async () => helper,
	}), /reused a helper identity/u)
})
