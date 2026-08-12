/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	addRationals,
	compareRationals,
	multiplyRationals,
	normalizeRational,
	subtractRationals,
	type Rational,
	type RationalInput,
} from './timeline-time.ts';
import {
	readClosedDomainArray,
	readClosedDomainField,
	readClosedDomainRecord,
} from './closed-domain-value.ts';

export const MAXIMUM_AUDIO_GROOVE_STEPS = 128;

export interface AudioWarpGridInput {
	readonly origin: RationalInput;
	readonly interval: RationalInput;
}

export interface AudioWarpGrid {
	readonly origin: Rational;
	readonly interval: Rational;
}

export interface AudioGrooveTemplateInput {
	readonly offsets: readonly RationalInput[];
}

export interface AudioGrooveTemplate {
	readonly offsets: readonly Rational[];
}

export function normalizeAudioWarpGrid(value: unknown): Readonly<AudioWarpGrid> {
	const record = readClosedDomainRecord(value, 'audio warp grid', ['origin', 'interval']);
	const origin = normalizeAudioWarpRational(readClosedDomainField(record, 'origin', 'audio warp grid'), 'audio warp grid origin');
	const interval = normalizeAudioWarpRational(readClosedDomainField(record, 'interval', 'audio warp grid'), 'audio warp grid interval');
	if (compareRationals(interval, 0) <= 0) throw new RangeError('Audio warp grid interval must be positive.');
	return Object.freeze({ origin, interval });
}

export function normalizeAudioWarpStrength(value: unknown, name = 'audio warp strength'): Rational {
	const strength = normalizeAudioWarpRational(value, name);
	if (compareRationals(strength, 0) < 0 || compareRationals(strength, 1) > 0) {
		throw new RangeError(`${name} must be between zero and one.`);
	}
	return strength;
}

export function normalizeAudioGrooveTemplate(value: unknown): Readonly<AudioGrooveTemplate> {
	const record = readClosedDomainRecord(value, 'audio groove template', ['offsets']);
	const values = readClosedDomainArray(
		readClosedDomainField(record, 'offsets', 'audio groove template'),
		'audio groove template offsets',
		1,
		MAXIMUM_AUDIO_GROOVE_STEPS,
	);
	const offsets = Object.freeze(values.map((offset, index) => (
		normalizeAudioWarpRational(offset, `audio groove template offset ${String(index)}`)
	)));
	for (let index = 1; index < offsets.length; index += 1) {
		const previous = addRationals(index - 1, offsets[index - 1]);
		const current = addRationals(index, offsets[index]);
		if (compareRationals(previous, current) >= 0) {
			throw new RangeError('Audio groove template positions must be strictly increasing.');
		}
	}
	const last = addRationals(offsets.length - 1, offsets.at(-1)!);
	const nextCycle = addRationals(offsets.length, offsets[0]);
	if (compareRationals(last, nextCycle) >= 0) {
		throw new RangeError('Audio groove template positions invert at the cycle boundary.');
	}
	return Object.freeze({ offsets });
}

/** Resolve one reusable grooved grid target at exact adjustable depth. */
export function applyAudioGrooveTemplate(
	gridIndex: number,
	gridValue: AudioWarpGridInput,
	templateValue: AudioGrooveTemplateInput,
	strengthValue: RationalInput = 1,
): Rational {
	if (!Number.isSafeInteger(gridIndex)) throw new RangeError('Audio groove grid index must be a safe integer.');
	const grid = normalizeAudioWarpGrid(gridValue);
	const template = normalizeAudioGrooveTemplate(templateValue);
	const strength = normalizeAudioWarpStrength(strengthValue, 'audio groove strength');
	const straight = addRationals(grid.origin, multiplyRationals(grid.interval, gridIndex));
	const phase = ((gridIndex % template.offsets.length) + template.offsets.length) % template.offsets.length;
	const fullOffset = multiplyRationals(grid.interval, template.offsets[phase]);
	return addRationals(straight, multiplyRationals(fullOffset, strength));
}

export function interpolateAudioWarpRational(
	start: RationalInput,
	end: RationalInput,
	strength: RationalInput,
): Rational {
	return addRationals(start, multiplyRationals(subtractRationals(end, start), strength));
}

export function normalizeAudioWarpRational(value: unknown, name: string): Rational {
	if (typeof value === 'number') return normalizeRational(value);
	const record = readClosedDomainRecord(value, name, ['num', 'den']);
	const num = readClosedDomainField(record, 'num', name);
	const den = readClosedDomainField(record, 'den', name);
	if (typeof num !== 'number' || typeof den !== 'number') throw new TypeError(`${name} must be rational.`);
	return normalizeRational({ num, den });
}
