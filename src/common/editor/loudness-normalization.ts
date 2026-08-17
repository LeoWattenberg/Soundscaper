/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Target-driven loudness normalization: one gain decision, computed up front.
 *
 * The whole point of this module is that normalization is a **plan step**, not
 * an encoder flag and not a process. It looks at what the meter measured, works
 * out a single gain in decibels, and hands that number back. Applying it is the
 * render's job; deciding it is this module's, and the decision is inspectable
 * before a single sample moves.
 *
 * **The slice's stop condition is the rule that shapes everything here: a
 * ceiling violation after gain reduction is a reported refusal, not a limiter.**
 * If reaching the integrated target would push true peak above the ceiling, the
 * gain is reduced until the ceiling is exactly met and the delivery is reported
 * as not having reached its loudness target. It is never rescued by a limiter,
 * because a limiter needs lookahead and changes the render topology — and
 * because a delivery that quietly squashed the material to hit a number is
 * worse than one that says it came up short.
 *
 * Everything is decibels and LUFS, so gains combine by addition. A gain of
 * `g` dB moves integrated loudness by `g` LU and true peak by `g` dB alike;
 * that linearity is why one number can satisfy both constraints or provably
 * fail to.
 */

export const LOUDNESS_NORMALIZATION_EPSILON_DB = 1e-9;

/**
 * What the meter reported. Shaped to accept a BEXT loudness block directly, so
 * a measurement can be handed straight from `measureBextLoudness` to the
 * decision without a translation step that could drop or rename a field.
 */
export interface LoudnessMeasurement {
	/** Integrated loudness in LUFS. Null or absent when the meter had nothing to measure. */
	readonly loudnessValue?: number | null;
	readonly maxTruePeakLevel?: number | null;
	readonly loudnessRange?: number | null;
}

export interface LoudnessNormalizationTarget {
	/** Integrated loudness target in LUFS, e.g. -23 for EBU R128. */
	readonly integratedLufs: number;
	/** True-peak ceiling in dBTP, e.g. -1. Never exceeded. */
	readonly truePeakCeilingDb: number;
}

export type LoudnessNormalizationOutcome =
	| 'target-met'
	| 'ceiling-limited'
	| 'unmeasurable'
	| 'not-requested';

export interface LoudnessNormalizationDecision {
	readonly outcome: LoudnessNormalizationOutcome;
	/** The gain the render applies. Zero when nothing should change. */
	readonly gainDb: number;
	readonly measuredLoudnessLufs: number | null;
	readonly measuredTruePeakDb: number | null;
	/** What the delivery is expected to measure afterwards. */
	readonly projectedLoudnessLufs: number | null;
	readonly projectedTruePeakDb: number | null;
	/**
	 * What the delivered samples actually measured. Null until something has
	 * measured them back, which only happens when a delivery captures loudness
	 * metadata — a second meter pass over an hour of audio is not free enough to
	 * run for a value nothing reads.
	 */
	readonly deliveredLoudnessLufs: number | null;
	readonly deliveredTruePeakDb: number | null;
	readonly target: LoudnessNormalizationTarget | null;
	/** How far short of the integrated target the delivery lands, in LU. */
	readonly targetShortfallLu: number;
	readonly reason: string;
}

/**
 * Decide the gain for one delivery.
 *
 * Passing no target is a first-class case rather than an error: a delivery
 * without normalization still reports its measured loudness, unchanged, so the
 * report says the same kind of thing either way.
 */
export function computeLoudnessNormalization(
	measurement: LoudnessMeasurement | null | undefined,
	target: LoudnessNormalizationTarget | null | undefined,
): LoudnessNormalizationDecision {
	const measuredLoudness = finiteOrNull(measurement?.loudnessValue);
	const measuredTruePeak = finiteOrNull(measurement?.maxTruePeakLevel);

	if (!target) {
		return decision({
			outcome: 'not-requested',
			gainDb: 0,
			measuredLoudness,
			measuredTruePeak,
			projectedLoudness: measuredLoudness,
			projectedTruePeak: measuredTruePeak,
			target: null,
			targetShortfallLu: 0,
			reason: 'No loudness target was requested; the delivery is unchanged.',
		});
	}

	validateTarget(target);

	if (measuredLoudness === null) {
		// Silence, or a meter that never saw a gate-passing block. Applying a
		// gain computed from nothing would be inventing a number.
		return decision({
			outcome: 'unmeasurable',
			gainDb: 0,
			measuredLoudness,
			measuredTruePeak,
			projectedLoudness: null,
			projectedTruePeak: measuredTruePeak,
			target,
			targetShortfallLu: 0,
			reason: 'Integrated loudness could not be measured, so no gain was computed.',
		});
	}

	const desiredGainDb = target.integratedLufs - measuredLoudness;

	// The ceiling binds only when a true peak was actually measured. A missing
	// peak is not permission to exceed the ceiling; it is a reason not to claim
	// the ceiling was respected, which the projected value records as null.
	const ceilingGainDb = measuredTruePeak === null
		? Number.POSITIVE_INFINITY
		: target.truePeakCeilingDb - measuredTruePeak;

	const gainDb = Math.min(desiredGainDb, ceilingGainDb);
	const shortfall = desiredGainDb - gainDb;
	const ceilingLimited = shortfall > LOUDNESS_NORMALIZATION_EPSILON_DB;

	return decision({
		outcome: ceilingLimited ? 'ceiling-limited' : 'target-met',
		gainDb,
		measuredLoudness,
		measuredTruePeak,
		projectedLoudness: measuredLoudness + gainDb,
		projectedTruePeak: measuredTruePeak === null ? null : measuredTruePeak + gainDb,
		target,
		targetShortfallLu: ceilingLimited ? shortfall : 0,
		reason: ceilingLimited
			? `The true-peak ceiling of ${target.truePeakCeilingDb} dBTP binds before the `
				+ `${target.integratedLufs} LUFS target, leaving the delivery `
				+ `${shortfall.toFixed(2)} LU short. No limiter was applied.`
			: `Gain of ${gainDb.toFixed(2)} dB reaches ${target.integratedLufs} LUFS `
				+ `within the ${target.truePeakCeilingDb} dBTP ceiling.`,
	});
}

/**
 * The standard targets, as data.
 *
 * These are the published broadcast and streaming numbers, not house
 * preferences, which is why they live beside the arithmetic rather than in a
 * settings default: a preset that drifted from its standard would be worse than
 * no preset at all.
 */
export const LOUDNESS_NORMALIZATION_TARGETS = Object.freeze({
	/** EBU R 128, the European broadcast target. */
	'ebu-r128': Object.freeze({ integratedLufs: -23, truePeakCeilingDb: -1 }),
	/** ATSC A/85, the North American broadcast target. */
	'atsc-a85': Object.freeze({ integratedLufs: -24, truePeakCeilingDb: -2 }),
	/** The common streaming delivery target. */
	'streaming-14': Object.freeze({ integratedLufs: -14, truePeakCeilingDb: -1 }),
}) satisfies Readonly<Record<string, LoudnessNormalizationTarget>>;

export type LoudnessNormalizationPreset = keyof typeof LOUDNESS_NORMALIZATION_TARGETS;

/**
 * Read a target out of settings: a preset name, an explicit pair, or nothing.
 *
 * **There is no default target.** An operator who did not ask for normalization
 * must not receive it, and one who asked for a target we cannot read must not
 * silently receive a different one — so a malformed target is a refusal rather
 * than a fallback. In particular a missing ceiling is not treated as 0 dBTP,
 * which would be a delivery that claims a ceiling it never had.
 */
export function normalizeLoudnessNormalizationTarget(
	value: unknown,
): LoudnessNormalizationTarget | null {
	if (value == null || value === false) return null;
	if (typeof value === 'string') {
		const preset = LOUDNESS_NORMALIZATION_TARGETS[value as LoudnessNormalizationPreset];
		if (!preset) throw new RangeError(`Unknown loudness normalization target "${value}".`);
		return preset;
	}
	if (typeof value !== 'object') {
		throw new TypeError('A loudness normalization target must be a preset name or an explicit target.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	const target = Object.freeze({
		integratedLufs: Number(record.integratedLufs),
		truePeakCeilingDb: Number(record.truePeakCeilingDb),
	});
	validateTarget(target);
	return target;
}

/**
 * How far a delivered measurement may sit from the projection before the
 * delivery is worth complaining about, matching the delivery budgets
 * `delivery.integratedLoudnessErrorLu` and `delivery.truePeakErrorDb`
 * (config/quality-budgets.json). A constant gain moves loudness and peak by
 * exactly itself, so the two agree except where the meter's absolute gate
 * admits or drops a block that sat right on the -70 LUFS threshold.
 */
export const LOUDNESS_DELIVERY_TOLERANCE_LU = 0.2;
export const LOUDNESS_DELIVERY_TOLERANCE_DB = 0.2;

/**
 * Record what the delivered samples measured, once something has measured them.
 *
 * The delivered value is the true one where it exists: the projection says what
 * the gain should achieve, this says what it did.
 */
export function withDeliveredLoudness(
	decision: LoudnessNormalizationDecision,
	measurement: LoudnessMeasurement | null | undefined,
): LoudnessNormalizationDecision {
	if (!measurement) return decision;
	return Object.freeze({
		...decision,
		deliveredLoudnessLufs: finiteOrNull(measurement.loudnessValue),
		deliveredTruePeakDb: finiteOrNull(measurement.maxTruePeakLevel),
	});
}

/**
 * How far the delivery landed from what the decision projected, in LU and dB.
 * Null components mean the comparison could not be made rather than that it
 * passed, which is the distinction a delivery gate has to be able to see.
 */
export function loudnessDeliveryError(decision: LoudnessNormalizationDecision): Readonly<{
	loudnessErrorLu: number | null;
	truePeakErrorDb: number | null;
	withinTolerance: boolean | null;
}> {
	const loudnessErrorLu = difference(decision.deliveredLoudnessLufs, decision.projectedLoudnessLufs);
	const truePeakErrorDb = difference(decision.deliveredTruePeakDb, decision.projectedTruePeakDb);
	if (loudnessErrorLu === null && truePeakErrorDb === null) {
		return Object.freeze({ loudnessErrorLu, truePeakErrorDb, withinTolerance: null });
	}
	return Object.freeze({
		loudnessErrorLu,
		truePeakErrorDb,
		withinTolerance: (loudnessErrorLu === null || loudnessErrorLu <= LOUDNESS_DELIVERY_TOLERANCE_LU)
			&& (truePeakErrorDb === null || truePeakErrorDb <= LOUDNESS_DELIVERY_TOLERANCE_DB),
	});
}

/** True when the render has to do anything at all. */
export function loudnessNormalizationChangesAudio(decision: LoudnessNormalizationDecision): boolean {
	return Math.abs(decision.gainDb) > LOUDNESS_NORMALIZATION_EPSILON_DB;
}

/** The linear factor the render multiplies by. Kept here so no caller re-derives it. */
export function loudnessNormalizationGainFactor(decision: LoudnessNormalizationDecision): number {
	return 10 ** (decision.gainDb / 20);
}

function validateTarget(target: LoudnessNormalizationTarget): void {
	if (!Number.isFinite(target.integratedLufs)) {
		throw new TypeError('A loudness target requires a finite integrated value in LUFS.');
	}
	if (!Number.isFinite(target.truePeakCeilingDb)) {
		throw new TypeError('A loudness target requires a finite true-peak ceiling in dBTP.');
	}
	if (target.integratedLufs > 0) {
		throw new RangeError('An integrated loudness target above 0 LUFS is not achievable.');
	}
}

function decision(fields: {
	outcome: LoudnessNormalizationOutcome;
	gainDb: number;
	measuredLoudness: number | null;
	measuredTruePeak: number | null;
	projectedLoudness: number | null;
	projectedTruePeak: number | null;
	target: LoudnessNormalizationTarget | null;
	targetShortfallLu: number;
	reason: string;
}): LoudnessNormalizationDecision {
	return Object.freeze({
		outcome: fields.outcome,
		gainDb: fields.gainDb,
		measuredLoudnessLufs: fields.measuredLoudness,
		measuredTruePeakDb: fields.measuredTruePeak,
		projectedLoudnessLufs: fields.projectedLoudness,
		projectedTruePeakDb: fields.projectedTruePeak,
		deliveredLoudnessLufs: null,
		deliveredTruePeakDb: null,
		target: fields.target ? Object.freeze({ ...fields.target }) : null,
		targetShortfallLu: fields.targetShortfallLu,
		reason: fields.reason,
	});
}

function finiteOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The unsigned gap between two values, or null when either is missing. */
function difference(left: number | null, right: number | null): number | null {
	return left === null || right === null ? null : Math.abs(left - right);
}
