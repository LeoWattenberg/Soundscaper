/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Property coverage for the loudness normalization decision.
 *
 * The module's whole promise is arithmetic: one gain that either reaches the
 * integrated target or is cut short by the true-peak ceiling, with no limiter
 * and no third possibility. Those are statements about every measurement, so
 * they are checked over generated ones rather than a handful of broadcast
 * examples.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import {
	LOUDNESS_DELIVERY_TOLERANCE_DB,
	LOUDNESS_DELIVERY_TOLERANCE_LU,
	LOUDNESS_NORMALIZATION_EPSILON_DB,
	LOUDNESS_NORMALIZATION_TARGETS,
	computeLoudnessNormalization,
	loudnessDeliveryError,
	loudnessNormalizationChangesAudio,
	loudnessNormalizationGainFactor,
	normalizeLoudnessNormalizationTarget,
	withDeliveredLoudness,
	type LoudnessNormalizationTarget,
} from '../src/common/editor/loudness-normalization.ts';

const SEED = 20_260_906;
const RUNS = 200;

/**
 * Decibel arithmetic on values this size carries about 1e-13 of rounding, so a
 * comparison against the module's own epsilon needs that much slack on top of
 * it before it is testing floating point rather than the decision.
 */
const ARITHMETIC_SLACK = 1e-9;

const loudnessArbitrary = fc.double({ min: -120, max: 0, noNaN: true });
const truePeakArbitrary = fc.double({ min: -120, max: 12, noNaN: true });
const targetArbitrary: fc.Arbitrary<LoudnessNormalizationTarget> = fc.record({
	integratedLufs: fc.double({ min: -40, max: -5, noNaN: true }),
	truePeakCeilingDb: fc.double({ min: -12, max: 0, noNaN: true }),
});

type TargetReading =
	| Readonly<{ ok: true; target: LoudnessNormalizationTarget | null }>
	| Readonly<{ ok: false; error: unknown }>;

/** Read a target without letting its refusal escape, so both outcomes are testable. */
function readTarget(value: unknown): TargetReading {
	try {
		return { ok: true, target: normalizeLoudnessNormalizationTarget(value) };
	} catch (error) {
		return { ok: false, error };
	}
}

test('the gain reaches the target or stops exactly at the ceiling, never past it', () => {
	fc.assert(
		fc.property(loudnessArbitrary, truePeakArbitrary, targetArbitrary, (loudness, truePeak, target) => {
			const decision = computeLoudnessNormalization(
				{ loudnessValue: loudness, maxTruePeakLevel: truePeak },
				target,
			);
			const desired = target.integratedLufs - loudness;
			const headroom = target.truePeakCeilingDb - truePeak;

			assert.ok(['target-met', 'ceiling-limited'].includes(decision.outcome), decision.outcome);
			assert.ok(decision.gainDb <= desired, 'the gain never overshoots the loudness target');
			assert.ok(decision.gainDb <= headroom, 'the gain never spends more than the ceiling headroom');
			assert.equal(decision.gainDb, Math.min(desired, headroom));
			assert.ok(
				(decision.projectedTruePeakDb as number) <= target.truePeakCeilingDb + ARITHMETIC_SLACK,
				`projected ${String(decision.projectedTruePeakDb)} dBTP passed the ceiling`,
			);
			assert.ok(decision.targetShortfallLu >= 0, 'a shortfall is never negative');

			if (decision.outcome === 'target-met') {
				assert.equal(decision.targetShortfallLu, 0);
				assert.ok(
					Math.abs((decision.projectedLoudnessLufs as number) - target.integratedLufs)
						<= LOUDNESS_NORMALIZATION_EPSILON_DB + ARITHMETIC_SLACK,
					`projected ${String(decision.projectedLoudnessLufs)} LUFS missed ${String(target.integratedLufs)}`,
				);
			} else {
				assert.ok(decision.targetShortfallLu > LOUDNESS_NORMALIZATION_EPSILON_DB);
				assert.equal(decision.targetShortfallLu, desired - decision.gainDb);
				assert.match(decision.reason, /No limiter was applied\./u);
			}

			assert.equal(loudnessNormalizationGainFactor(decision), 10 ** (decision.gainDb / 20));
			assert.equal(
				loudnessNormalizationChangesAudio(decision),
				Math.abs(decision.gainDb) > LOUDNESS_NORMALIZATION_EPSILON_DB,
			);
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a quieter measurement never earns less gain than a louder one', () => {
	fc.assert(
		fc.property(
			loudnessArbitrary,
			loudnessArbitrary,
			truePeakArbitrary,
			targetArbitrary,
			(first, second, truePeak, target) => {
				const quieter = Math.min(first, second);
				const louder = Math.max(first, second);
				const gainOf = (loudness: number): number => computeLoudnessNormalization(
					{ loudnessValue: loudness, maxTruePeakLevel: truePeak },
					target,
				).gainDb;
				assert.ok(
					gainOf(quieter) >= gainOf(louder),
					`gain was not monotonic between ${String(quieter)} and ${String(louder)} LUFS`,
				);
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a delivery without a target, or without a measurement, is left alone', () => {
	fc.assert(
		fc.property(
			fc.option(loudnessArbitrary, { nil: null }),
			fc.option(truePeakArbitrary, { nil: null }),
			targetArbitrary,
			(loudness, truePeak, target) => {
				const measurement = { loudnessValue: loudness, maxTruePeakLevel: truePeak };

				const untargeted = computeLoudnessNormalization(measurement, null);
				assert.equal(untargeted.outcome, 'not-requested');
				assert.equal(untargeted.gainDb, 0);
				assert.equal(untargeted.target, null);
				assert.equal(untargeted.projectedLoudnessLufs, loudness);
				assert.equal(untargeted.projectedTruePeakDb, truePeak);

				const decision = computeLoudnessNormalization(measurement, target);
				if (loudness === null) {
					assert.equal(decision.outcome, 'unmeasurable');
					assert.equal(decision.gainDb, 0);
					assert.equal(decision.projectedLoudnessLufs, null);
					assert.equal(decision.projectedTruePeakDb, truePeak);
				}
				// Whatever the outcome, the decision cannot make an unmeasured or
				// already-over-ceiling peak worse than it was.
				const ceiling = Math.max(target.truePeakCeilingDb, truePeak ?? Number.NEGATIVE_INFINITY);
				if (decision.projectedTruePeakDb !== null) {
					assert.ok(decision.projectedTruePeakDb <= ceiling + ARITHMETIC_SLACK);
				}
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('the delivered error is the distance from the projection, judged by the delivery tolerances', () => {
	fc.assert(
		fc.property(
			loudnessArbitrary,
			truePeakArbitrary,
			targetArbitrary,
			fc.double({ min: -1, max: 1, noNaN: true }),
			fc.double({ min: -1, max: 1, noNaN: true }),
			(loudness, truePeak, target, loudnessDrift, peakDrift) => {
				const decision = computeLoudnessNormalization(
					{ loudnessValue: loudness, maxTruePeakLevel: truePeak },
					target,
				);
				assert.equal(decision.deliveredLoudnessLufs, null, 'nothing has measured the delivery yet');
				assert.deepEqual(loudnessDeliveryError(decision), {
					loudnessErrorLu: null,
					truePeakErrorDb: null,
					withinTolerance: null,
				});
				assert.equal(withDeliveredLoudness(decision, null), decision, 'no measurement changes nothing');

				const projectedLoudness = decision.projectedLoudnessLufs as number;
				const projectedPeak = decision.projectedTruePeakDb as number;
				const delivered = withDeliveredLoudness(decision, {
					loudnessValue: projectedLoudness + loudnessDrift,
					maxTruePeakLevel: projectedPeak + peakDrift,
				});
				const errors = loudnessDeliveryError(delivered);
				assert.ok(
					Math.abs((errors.loudnessErrorLu as number) - Math.abs(loudnessDrift)) <= ARITHMETIC_SLACK,
					`loudness error ${String(errors.loudnessErrorLu)} did not match the drift`,
				);
				assert.ok(
					Math.abs((errors.truePeakErrorDb as number) - Math.abs(peakDrift)) <= ARITHMETIC_SLACK,
					`true-peak error ${String(errors.truePeakErrorDb)} did not match the drift`,
				);
				assert.equal(
					errors.withinTolerance,
					(errors.loudnessErrorLu as number) <= LOUDNESS_DELIVERY_TOLERANCE_LU
						&& (errors.truePeakErrorDb as number) <= LOUDNESS_DELIVERY_TOLERANCE_DB,
				);

				// A delivery that measured exactly what was projected is by definition
				// in tolerance, whatever the tolerances are set to.
				const exact = loudnessDeliveryError(withDeliveredLoudness(decision, {
					loudnessValue: projectedLoudness,
					maxTruePeakLevel: projectedPeak,
				}));
				assert.deepEqual(exact, { loudnessErrorLu: 0, truePeakErrorDb: 0, withinTolerance: true });
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('reading a target either refuses it or returns one the decision can use', () => {
	fc.assert(
		fc.property(
			fc.oneof(
				fc.anything(),
				fc.constantFrom(...Object.keys(LOUDNESS_NORMALIZATION_TARGETS)),
				targetArbitrary,
			),
			(value) => {
				const read = readTarget(value);
				if (!read.ok) {
					assert.ok(read.error instanceof TypeError || read.error instanceof RangeError, String(read.error));
					return;
				}
				const target = read.target;
				if (target === null) return;
				assert.ok(Number.isFinite(target.integratedLufs) && target.integratedLufs <= 0);
				assert.ok(Number.isFinite(target.truePeakCeilingDb));
				// Anything this returns has to be something the decision accepts.
				const decision = computeLoudnessNormalization({ loudnessValue: -30, maxTruePeakLevel: -6 }, target);
				assert.ok(['target-met', 'ceiling-limited'].includes(decision.outcome));
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});
