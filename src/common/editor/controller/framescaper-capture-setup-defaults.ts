/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeCaptureDestination,
	type CaptureDestination,
} from '../framescaper-capture-domain.ts';

export interface FramescaperCaptureSetupDefaults {
	readonly destination: CaptureDestination;
	readonly countdownMs: number;
}

export interface FramescaperCaptureSetupDefaultsPort {
	readonly snapshot: Readonly<FramescaperCaptureSetupDefaults>;
	update(changes: Readonly<Partial<FramescaperCaptureSetupDefaults>>): void;
}

export function createFramescaperCaptureSetupDefaults(
	onChange: (() => void) | undefined = undefined,
): Readonly<FramescaperCaptureSetupDefaultsPort> {
	let snapshot = normalizeFramescaperCaptureSetupDefaults({
		destination: 'both', countdownMs: 3_000,
	});
	return Object.freeze({
		get snapshot() { return snapshot; },
		update(changes: Readonly<Partial<FramescaperCaptureSetupDefaults>>) {
			if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
				throw new TypeError('Capture setup default changes are invalid.');
			}
			const keys = Object.keys(changes);
			if (!keys.length || keys.some((key) => key !== 'destination' && key !== 'countdownMs')) {
				throw new TypeError('Capture setup default changes have an invalid closed shape.');
			}
			snapshot = normalizeFramescaperCaptureSetupDefaults({ ...snapshot, ...changes });
			try { onChange?.(); } catch { /* Observers cannot own capture defaults. */ }
		},
	});
}

export function normalizeFramescaperCaptureSetupDefaults(
	value: unknown,
): Readonly<FramescaperCaptureSetupDefaults> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Capture setup defaults are invalid.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'destination')
		|| !Object.hasOwn(record, 'countdownMs')) {
		throw new TypeError('Capture setup defaults have an invalid closed shape.');
	}
	const countdownMs = Number(record.countdownMs);
	if (![0, 3_000, 5_000, 10_000].includes(countdownMs)) {
		throw new RangeError('Capture setup countdown is unsupported.');
	}
	return Object.freeze({
		destination: normalizeCaptureDestination(record.destination),
		countdownMs,
	});
}
