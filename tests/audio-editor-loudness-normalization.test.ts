/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LOUDNESS_DELIVERY_TOLERANCE_LU,
	LOUDNESS_NORMALIZATION_TARGETS,
	computeLoudnessNormalization,
	loudnessNormalizationChangesAudio,
	loudnessDeliveryError,
	loudnessNormalizationGainFactor,
	normalizeLoudnessNormalizationTarget,
	withDeliveredLoudness,
} from '../src/common/editor/loudness-normalization.ts';

const R128 = { integratedLufs: -23, truePeakCeilingDb: -1 };

const close = (actual: number, expected: number, message: string) => {
	assert.ok(Math.abs(actual - expected) < 1e-9, `${message} (got ${actual}, expected ${expected})`);
};

test('a quiet mix is raised to the target', () => {
	const decision = computeLoudnessNormalization(
		{ loudnessValue: -30, maxTruePeakLevel: -12 }, R128,
	);
	assert.equal(decision.outcome, 'target-met');
	close(decision.gainDb, 7, 'gain closes the 7 LU gap');
	close(decision.projectedLoudnessLufs!, -23, 'the delivery lands on the target');
	close(decision.projectedTruePeakDb!, -5, 'the peak moves by the same amount');
	assert.equal(decision.targetShortfallLu, 0);
});

test('a loud mix is turned down to the target', () => {
	const decision = computeLoudnessNormalization(
		{ loudnessValue: -14, maxTruePeakLevel: -3 }, R128,
	);
	assert.equal(decision.outcome, 'target-met');
	close(decision.gainDb, -9, 'gain is negative');
	close(decision.projectedLoudnessLufs!, -23, '');
	close(decision.projectedTruePeakDb!, -12, '');
});

test('the ceiling binds before the target, and that is a refusal rather than a limiter', () => {
	// The slice's stop condition. Reaching -23 LUFS would need +8 dB, which would
	// put a -2 dBTP peak at +6 dBTP. The gain is cut to respect the ceiling and
	// the delivery is reported short. Nothing is limited.
	const decision = computeLoudnessNormalization(
		{ loudnessValue: -31, maxTruePeakLevel: -2 }, R128,
	);
	assert.equal(decision.outcome, 'ceiling-limited');
	close(decision.gainDb, 1, 'gain stops exactly at the ceiling');
	close(decision.projectedTruePeakDb!, -1, 'the ceiling is met exactly, never exceeded');
	close(decision.projectedLoudnessLufs!, -30, 'so the delivery lands 7 LU short');
	close(decision.targetShortfallLu, 7, 'and the shortfall is stated');
	assert.match(decision.reason, /No limiter was applied/u);
});

test('the ceiling is never exceeded, across a sweep of measurements', () => {
	// The one property that must hold for every input: whatever gain is chosen,
	// the projected peak is at or under the ceiling.
	for (let loudness = -40; loudness <= -5; loudness += 0.5) {
		for (let peak = -20; peak <= 0; peak += 0.5) {
			const decision = computeLoudnessNormalization(
				{ loudnessValue: loudness, maxTruePeakLevel: peak }, R128,
			);
			assert.ok(
				decision.projectedTruePeakDb! <= R128.truePeakCeilingDb + 1e-9,
				`peak ${decision.projectedTruePeakDb} exceeds the ceiling for ${loudness}/${peak}`,
			);
			// And it never overshoots the loudness target either.
			assert.ok(
				decision.projectedLoudnessLufs! <= R128.integratedLufs + 1e-9,
				`loudness ${decision.projectedLoudnessLufs} overshoots for ${loudness}/${peak}`,
			);
		}
	}
});

test('already-hot material is turned down rather than left over the ceiling', () => {
	const decision = computeLoudnessNormalization(
		{ loudnessValue: -23, maxTruePeakLevel: 0.5 }, R128,
	);
	// The integrated target is already met at 0 dB, but the peak is over. The
	// ceiling wins, which means going below the target rather than above the ceiling.
	assert.equal(decision.outcome, 'ceiling-limited');
	close(decision.gainDb, -1.5, '');
	close(decision.projectedTruePeakDb!, -1, '');
	close(decision.projectedLoudnessLufs!, -24.5, '');
});

test('no target still reports the measurement, unchanged', () => {
	// A delivery without normalization reports measured loudness unchanged, so
	// the report says the same kind of thing either way.
	const decision = computeLoudnessNormalization({ loudnessValue: -18.3, maxTruePeakLevel: -0.4 }, null);
	assert.equal(decision.outcome, 'not-requested');
	assert.equal(decision.gainDb, 0);
	assert.equal(decision.measuredLoudnessLufs, -18.3);
	assert.equal(decision.projectedLoudnessLufs, -18.3);
	assert.equal(decision.projectedTruePeakDb, -0.4);
	assert.equal(decision.target, null);
	assert.equal(loudnessNormalizationChangesAudio(decision), false);
});

test('an unmeasurable mix gets no invented gain', () => {
	// Silence, or a meter that never saw a gate-passing block.
	const decision = computeLoudnessNormalization({ loudnessValue: null, maxTruePeakLevel: null }, R128);
	assert.equal(decision.outcome, 'unmeasurable');
	assert.equal(decision.gainDb, 0);
	assert.equal(decision.projectedLoudnessLufs, null);
	assert.equal(loudnessNormalizationChangesAudio(decision), false);
});

test('a missing true peak is not permission to ignore the ceiling', () => {
	// The integrated target can still be reached, but nothing may claim the
	// ceiling was respected, so the projected peak stays null.
	const decision = computeLoudnessNormalization({ loudnessValue: -30, maxTruePeakLevel: null }, R128);
	assert.equal(decision.outcome, 'target-met');
	close(decision.gainDb, 7, '');
	assert.equal(decision.projectedTruePeakDb, null, 'no peak measured means no peak claimed');
});

test('a delivery already on target does nothing at all', () => {
	const decision = computeLoudnessNormalization({ loudnessValue: -23, maxTruePeakLevel: -6 }, R128);
	assert.equal(decision.outcome, 'target-met');
	assert.equal(decision.gainDb, 0);
	assert.equal(loudnessNormalizationChangesAudio(decision), false);
	assert.equal(loudnessNormalizationGainFactor(decision), 1);
});

test('the gain factor is the linear form of the decibel decision', () => {
	const decision = computeLoudnessNormalization({ loudnessValue: -29, maxTruePeakLevel: -20 }, R128);
	close(decision.gainDb, 6, '');
	close(loudnessNormalizationGainFactor(decision), 10 ** (6 / 20), 'the factor is 10^(dB/20)');
	assert.equal(loudnessNormalizationChangesAudio(decision), true);
});

test('an impossible target is refused rather than approximated', () => {
	assert.throws(
		() => computeLoudnessNormalization({ loudnessValue: -20, maxTruePeakLevel: -3 }, {
			integratedLufs: 6, truePeakCeilingDb: -1,
		}),
		/above 0 LUFS is not achievable/u,
	);
	assert.throws(
		() => computeLoudnessNormalization({ loudnessValue: -20, maxTruePeakLevel: -3 }, {
			integratedLufs: Number.NaN, truePeakCeilingDb: -1,
		}),
		/finite integrated value/u,
	);
	assert.throws(
		() => computeLoudnessNormalization({ loudnessValue: -20, maxTruePeakLevel: -3 }, {
			integratedLufs: -23, truePeakCeilingDb: Number.POSITIVE_INFINITY,
		}),
		/finite true-peak ceiling/u,
	);
});

test('a target is read from a preset name or an explicit pair, and never defaulted', () => {
	assert.deepEqual(normalizeLoudnessNormalizationTarget('ebu-r128'), { integratedLufs: -23, truePeakCeilingDb: -1 });
	assert.deepEqual(normalizeLoudnessNormalizationTarget('atsc-a85'), { integratedLufs: -24, truePeakCeilingDb: -2 });
	assert.deepEqual(
		normalizeLoudnessNormalizationTarget({ integratedLufs: -16, truePeakCeilingDb: -1.5 }),
		{ integratedLufs: -16, truePeakCeilingDb: -1.5 },
	);
	// Not asking is the common case and must stay silent.
	assert.equal(normalizeLoudnessNormalizationTarget(null), null);
	assert.equal(normalizeLoudnessNormalizationTarget(undefined), null);
	assert.equal(normalizeLoudnessNormalizationTarget(false), null);
});

test('an unreadable target is refused rather than replaced with a plausible one', () => {
	// The trap this closes: a missing ceiling silently becoming 0 dBTP, which
	// would be a delivery claiming a ceiling it never had.
	assert.throws(
		() => normalizeLoudnessNormalizationTarget({ integratedLufs: -23 }),
		/finite true-peak ceiling/u,
	);
	assert.throws(() => normalizeLoudnessNormalizationTarget('r128'), /Unknown loudness normalization target/u);
	assert.throws(() => normalizeLoudnessNormalizationTarget(-23), /preset name or an explicit target/u);
});

test('the published targets are the published numbers', () => {
	assert.deepEqual(LOUDNESS_NORMALIZATION_TARGETS['ebu-r128'], { integratedLufs: -23, truePeakCeilingDb: -1 });
	assert.deepEqual(LOUDNESS_NORMALIZATION_TARGETS['streaming-14'], { integratedLufs: -14, truePeakCeilingDb: -1 });
	assert.ok(Object.isFrozen(LOUDNESS_NORMALIZATION_TARGETS));
	for (const target of Object.values(LOUDNESS_NORMALIZATION_TARGETS)) assert.ok(Object.isFrozen(target));
});

test('the decision is frozen data a report can carry verbatim', () => {
	const decision = computeLoudnessNormalization({ loudnessValue: -30, maxTruePeakLevel: -12 }, R128);
	assert.ok(Object.isFrozen(decision) && Object.isFrozen(decision.target));
	assert.deepEqual(JSON.parse(JSON.stringify(decision)), { ...decision });
});

test('the delivery report carries both value pairs, normalized or not', async () => {
	// The acceptance asks that a normalized delivery's report carry measured AND
	// post-normalization values. A delivery that ran no normalization reports its
	// measurement anyway, so the report says the same kind of thing either way.
	const { createDeliveryReportForPlan } = await import(
		'../src/common/editor/delivery-conversion-inventory.ts'
	);
	const plan = { format: 'wav', sampleRate: 48_000, encoding: { channelCount: 2, bitDepth: 24 } };
	const source = { sampleRate: 48_000 };

	const normalized = createDeliveryReportForPlan(plan as never, source as never,
		computeLoudnessNormalization({ loudnessValue: -30, maxTruePeakLevel: -12 }, R128));
	const item = normalized.items.find((entry) => entry.code === 'delivery.loudness-normalized');
	assert.equal(item?.data.measuredLoudnessLufs, -30);
	assert.equal(item?.data.projectedLoudnessLufs, -23);
	assert.equal(item?.data.measuredTruePeakDb, -12);
	assert.equal(item?.data.projectedTruePeakDb, -5);
	assert.equal(item?.data.targetLufs, -23);

	const measuredOnly = createDeliveryReportForPlan(plan as never, source as never,
		computeLoudnessNormalization({ loudnessValue: -18, maxTruePeakLevel: -2 }, null));
	const measured = measuredOnly.items.find((entry) => entry.code === 'delivery.loudness-measured');
	assert.equal(measured?.disposition, 'preserved');
	assert.equal(measured?.data.measuredLoudnessLufs, -18);
});

test('a missed target is a warning in the report, not a footnote', () => {
	// The operator asked for a number and did not get it.
	const decision = computeLoudnessNormalization({ loudnessValue: -31, maxTruePeakLevel: -2 }, R128);
	assert.equal(decision.outcome, 'ceiling-limited');
	assert.ok(decision.targetShortfallLu > 0);
});

test('no loudness decision leaves the report exactly as it was', async () => {
	const { createDeliveryReportForPlan } = await import(
		'../src/common/editor/delivery-conversion-inventory.ts'
	);
	const plan = { format: 'wav', sampleRate: 48_000, encoding: { channelCount: 2, bitDepth: 24 } };
	const report = createDeliveryReportForPlan(plan as never, { sampleRate: 48_000 } as never);
	assert.equal(report.items.some((entry) => entry.code.startsWith('delivery.loudness')), false);
});

test('the delivered measurement is recorded beside the projection it is checked against', () => {
	const decision = computeLoudnessNormalization({ loudnessValue: -30, maxTruePeakLevel: -12 }, R128);
	assert.equal(decision.deliveredLoudnessLufs, null, 'nothing has measured the file yet');
	assert.equal(loudnessDeliveryError(decision).withinTolerance, null, 'and that is not a pass');

	const delivered = withDeliveredLoudness(decision, { loudnessValue: -23.05, maxTruePeakLevel: -5.02 });
	assert.equal(delivered.deliveredLoudnessLufs, -23.05);
	assert.equal(delivered.deliveredTruePeakDb, -5.02);
	assert.equal(delivered.projectedLoudnessLufs, -23, 'the projection is kept, not overwritten');
	const error = loudnessDeliveryError(delivered);
	close(error.loudnessErrorLu!, 0.05, '');
	close(error.truePeakErrorDb!, 0.02, '');
	assert.equal(error.withinTolerance, true);
});

test('a delivery that does not measure what it promised is outside tolerance', () => {
	const decision = withDeliveredLoudness(
		computeLoudnessNormalization({ loudnessValue: -30, maxTruePeakLevel: -12 }, R128),
		{ loudnessValue: -19, maxTruePeakLevel: -5 },
	);
	const error = loudnessDeliveryError(decision);
	close(error.loudnessErrorLu!, 4, '');
	assert.equal(error.withinTolerance, false);
	assert.equal(LOUDNESS_DELIVERY_TOLERANCE_LU, 0.2, 'the tolerance is the delivery budget');
});

test('the report states the delivered values, and says so when they disagree', async () => {
	const { createDeliveryReportForPlan } = await import(
		'../src/common/editor/delivery-conversion-inventory.ts'
	);
	const plan = { format: 'wav', sampleRate: 48_000, encoding: { channelCount: 2, bitDepth: 24 } };
	const source = { sampleRate: 48_000 };
	const decision = computeLoudnessNormalization({ loudnessValue: -30, maxTruePeakLevel: -12 }, R128);

	const agreeing = createDeliveryReportForPlan(plan as never, source as never,
		withDeliveredLoudness(decision, { loudnessValue: -23.1, maxTruePeakLevel: -5 }));
	const item = agreeing.items.find((entry) => entry.code === 'delivery.loudness-normalized');
	assert.equal(item?.data.deliveredLoudnessLufs, -23.1);
	assert.equal(item?.severity, 'info');

	const disagreeing = createDeliveryReportForPlan(plan as never, source as never,
		withDeliveredLoudness(decision, { loudnessValue: -17, maxTruePeakLevel: -5 }));
	const mismatch = disagreeing.items.find((entry) => entry.code === 'delivery.loudness-delivered-mismatch');
	assert.equal(mismatch?.severity, 'warning');
	assert.equal(
		disagreeing.items.some((entry) => entry.code === 'delivery.loudness-normalized'),
		false,
		'a mismatched delivery must not also claim it was normalized cleanly',
	);
});

test('a delivery nothing measured back reports projections only, with no delivered fields', async () => {
	const { createDeliveryReportForPlan } = await import(
		'../src/common/editor/delivery-conversion-inventory.ts'
	);
	const report = createDeliveryReportForPlan(
		{ format: 'wav', sampleRate: 48_000, encoding: { channelCount: 2, bitDepth: 24 } } as never,
		{ sampleRate: 48_000 } as never,
		computeLoudnessNormalization({ loudnessValue: -30, maxTruePeakLevel: -12 }, R128),
	);
	const item = report.items.find((entry) => entry.code === 'delivery.loudness-normalized');
	assert.equal('deliveredLoudnessLufs' in item!.data, false, 'an absent measurement is absent, not null');
	assert.equal(item?.data.projectedLoudnessLufs, -23);
});
