/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact held-tempo command planning for reviewed Beat This suggestions. */

import {
	createAddTempoEventCommand,
	createRemoveTempoEventCommand,
	createUpdateTempoEventCommand,
} from '../commands/factories.ts';
import type { TempoEventCommandValue } from '../commands/protocol.ts';
import {
	deriveSampleLockedTempoEventBeats,
	validateSampleLockedTempoBeatAuthority,
	validateTempoInverseRationalClosure,
} from '../timeline-tempo-inverse.ts';
import {
	addRationals,
	compareRationals,
	divideRationals,
	multiplyRationals,
	normalizeRational,
	type HoldTempoMap,
	type Rational,
} from '../timeline-time.ts';
import {
	ASSISTANCE_BEAT_SAMPLE_RATE,
	type AssistanceTempoProposalV1,
} from './m7-semantic-results.ts';

const MAXIMUM_TEMPO_EVENTS = 4_096;
const MAXIMUM_BPM_DENOMINATOR = 1_000_000;

type DataRecord = Readonly<Record<string, unknown>>;

export interface AssistanceBeatTempoMapPlan {
	readonly enabled: boolean;
	readonly disabledReason: string | null;
	readonly commands: readonly DataRecord[];
}

export interface AssistanceBeatTempoMapPlanOptions {
	readonly sequenceStartFrame: number;
	readonly sampleRate: number;
	readonly tempoMap: unknown;
}

interface TempoEvent {
	readonly id: string;
	readonly beat: Rational;
	readonly bpm: Rational;
	readonly samplePosition?: number;
}

interface NormalizedTempoMap {
	readonly mode: 'musical' | 'sampleLocked';
	readonly events: readonly TempoEvent[];
}

export function planAssistanceBeatTempoMap(
	proposal: AssistanceTempoProposalV1,
	options: AssistanceBeatTempoMapPlanOptions,
): AssistanceBeatTempoMapPlan {
	if (!Number.isSafeInteger(options.sequenceStartFrame) || options.sequenceStartFrame < 0) {
		throw new RangeError('The beat selection sequence start is invalid.');
	}
	const sampleRate = positiveInteger(options.sampleRate, 'project sample rate');
	const current = normalizeTempoMap(options.tempoMap, sampleRate);
	if (options.sequenceStartFrame !== 0) {
		return disabled('Tempo application requires a selection beginning at sequence frame zero.');
	}
	try {
		const desired = desiredTempoMap(proposal, current, sampleRate);
		if (sameTempoValues(current, desired)) return enabled([]);
		const commands: DataRecord[] = current.events.slice(1).reverse().map(({ id }) => Object.freeze(
			createRemoveTempoEventCommand(id),
		) as unknown as DataRecord);
		const root = current.events[0]!;
		if (compareRationals(root.bpm, desired.events[0]!.bpm) !== 0) {
			commands.push(Object.freeze(createUpdateTempoEventCommand(root.id, {
				bpm: desired.events[0]!.bpm,
			})) as unknown as DataRecord);
		}
		for (const event of desired.events.slice(1)) {
			const add = Object.freeze(createAddTempoEventCommand(commandEvent(event, desired.mode)));
			commands.push(add as unknown as DataRecord);
		}
		return enabled(commands);
	} catch (error) {
		if (error instanceof TypeError || error instanceof RangeError) {
			return disabled('The proposed held tempo map is not exactly representable in this project.');
		}
		throw error;
	}
}

function desiredTempoMap(
	proposal: AssistanceTempoProposalV1,
	current: NormalizedTempoMap,
	sampleRate: number,
): NormalizedTempoMap {
	const changes = proposal.kind === 'constant'
		? [{ startSample: 0, bpm: proposal.bpm }]
		: proposal.changes;
	if (changes.length > MAXIMUM_TEMPO_EVENTS) {
		throw new RangeError('The proposed tempo map exceeds project capacity.');
	}
	const positions = changes.map(({ startSample }) => exactProjectSample(startSample, sampleRate));
	const bpms = changes.map(({ bpm }) => {
		const result = normalizeRational(bpm, { maximumDenominator: MAXIMUM_BPM_DENOMINATOR });
		if (result.num / result.den < 1 || result.num / result.den > 1_000) {
			throw new RangeError('The proposed BPM is outside the project domain.');
		}
		return result;
	});
	const sampleEvents = positions.map((samplePosition, index) => ({
		bpm: bpms[index]!, samplePosition,
	}));
	const beats = deriveSampleLockedTempoEventBeats(sampleEvents, sampleRate);
	const events = positions.map((samplePosition, index): TempoEvent => Object.freeze({
		id: index === 0 ? current.events[0]!.id : `assistance-beat-tempo:${String(index)}`,
		beat: beats[index]!,
		bpm: bpms[index]!,
		...(current.mode === 'sampleLocked' ? { samplePosition } : {}),
	}));
	const result = Object.freeze({ mode: current.mode, events: Object.freeze(events) });
	validateTempoInverseRationalClosure(result as HoldTempoMap, sampleRate);
	if (result.mode === 'sampleLocked') {
		validateSampleLockedTempoBeatAuthority(result as HoldTempoMap, sampleRate);
	} else {
		assertMusicalPositions(result, positions, sampleRate);
	}
	return result;
}

function assertMusicalPositions(
	map: NormalizedTempoMap,
	positions: readonly number[],
	sampleRate: number,
): void {
	let beat = normalizeRational(0, { maximumDenominator: Number.MAX_SAFE_INTEGER });
	for (let index = 0; index < map.events.length; index += 1) {
		if (compareRationals(map.events[index]!.beat, beat) !== 0) {
			throw new RangeError('A proposed tempo event has inexact musical authority.');
		}
		const next = map.events[index + 1];
		if (!next) continue;
		const frameCount = positions[index + 1]! - positions[index]!;
		beat = addRationals(beat, multiplyRationals(
			frameCount,
			divideRationals(map.events[index]!.bpm, 60 * sampleRate),
		));
	}
}

function exactProjectSample(sample: number, projectRate: number): number {
	if (!Number.isSafeInteger(sample) || sample < 0) {
		throw new RangeError('A tempo change sample is invalid.');
	}
	const numerator = BigInt(sample) * BigInt(projectRate);
	const denominator = BigInt(ASSISTANCE_BEAT_SAMPLE_RATE);
	if (numerator % denominator !== 0n) {
		throw new RangeError('A tempo change is not exactly representable at the project sample rate.');
	}
	const result = Number(numerator / denominator);
	if (!Number.isSafeInteger(result)) throw new RangeError('A tempo change exceeds safe timing.');
	return result;
}

function normalizeTempoMap(value: unknown, sampleRate: number): NormalizedTempoMap {
	const map = record(value, 'project tempo map');
	if (map.mode !== 'musical' && map.mode !== 'sampleLocked') {
		throw new RangeError('The project tempo map mode is unsupported.');
	}
	if (!Array.isArray(map.events) || map.events.length < 1
		|| map.events.length > MAXIMUM_TEMPO_EVENTS) {
		throw new RangeError('The project tempo map exceeds its event bound.');
	}
	let priorBeat: Rational | null = null;
	let priorSample = -1;
	const events = map.events.map((candidate, index): TempoEvent => {
		const event = record(candidate, `tempo event ${String(index)}`);
		const id = stableId(event.id, `tempo event ${String(index)} id`);
		const beat = normalizeRationalValue(event.beat, Number.MAX_SAFE_INTEGER,
			`tempo event ${String(index)} beat`);
		const bpm = normalizeRationalValue(event.bpm, MAXIMUM_BPM_DENOMINATOR,
			`tempo event ${String(index)} bpm`);
		if (bpm.num <= 0 || bpm.num / bpm.den > 1_000
			|| (index === 0 && compareRationals(beat, 0) !== 0)
			|| (priorBeat && compareRationals(priorBeat, beat) >= 0)) {
			throw new RangeError('The project tempo events are invalid.');
		}
		let samplePosition: number | undefined;
		if (map.mode === 'sampleLocked') {
			samplePosition = integer(event.samplePosition, 0, `tempo event ${String(index)} sample`);
			if ((index === 0 && samplePosition !== 0) || (index > 0 && samplePosition <= priorSample)) {
				throw new RangeError('The sample-locked tempo events are invalid.');
			}
			priorSample = samplePosition;
		}
		priorBeat = beat;
		return Object.freeze({ id, beat, bpm,
			...(samplePosition === undefined ? {} : { samplePosition }) });
	});
	const result = Object.freeze({ mode: map.mode, events: Object.freeze(events) });
	validateTempoInverseRationalClosure(result as HoldTempoMap, sampleRate);
	if (result.mode === 'sampleLocked') {
		validateSampleLockedTempoBeatAuthority(result as HoldTempoMap, sampleRate);
	}
	return result;
}

function normalizeRationalValue(value: unknown, maximumDenominator: number, label: string): Rational {
	const input = record(value, label);
	if (!Number.isSafeInteger(input.num) || !Number.isSafeInteger(input.den)
		|| Number(input.den) <= 0) throw new RangeError(`The ${label} is invalid.`);
	const result = normalizeRational({ num: Number(input.num), den: Number(input.den) }, {
		maximumDenominator,
	});
	if (result.num !== input.num || result.den !== input.den) {
		throw new RangeError(`The ${label} is not canonical.`);
	}
	return result;
}

function commandEvent(event: TempoEvent, mode: NormalizedTempoMap['mode']): TempoEventCommandValue {
	return mode === 'sampleLocked'
		? { id: event.id, samplePosition: event.samplePosition, bpm: event.bpm }
		: { id: event.id, beat: event.beat, bpm: event.bpm };
}

function sameTempoValues(left: NormalizedTempoMap, right: NormalizedTempoMap): boolean {
	return left.mode === right.mode && left.events.length === right.events.length
		&& left.events.every((event, index) => {
			const candidate = right.events[index]!;
			return compareRationals(event.beat, candidate.beat) === 0
				&& compareRationals(event.bpm, candidate.bpm) === 0
				&& (left.mode !== 'sampleLocked' || event.samplePosition === candidate.samplePosition);
		});
}

function enabled(commands: readonly DataRecord[]): AssistanceBeatTempoMapPlan {
	return Object.freeze({ enabled: true, disabledReason: null, commands: Object.freeze(commands) });
}

function disabled(reason: string): AssistanceBeatTempoMapPlan {
	return Object.freeze({ enabled: false, disabledReason: reason, commands: Object.freeze([]) });
}

function record(value: unknown, label: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value as DataRecord;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > 256) {
		throw new TypeError(`The ${label} is invalid.`);
	}
	return value;
}

function integer(value: unknown, minimum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function positiveInteger(value: unknown, label: string): number {
	return integer(value, 1, label);
}
