/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';

export const SOUNDSCAPER_STABLE_1_CHECK_INVENTORY_PATH =
	'config/soundscaper-stable-1-check-inventory.json';
export const SOUNDSCAPER_STABLE_1_EXPECTED_PREFIXES = Object.freeze([
	'SB', 'SD', 'SW', 'SN', 'SDL', 'LA', 'REL', 'GAT',
]);

const EXPECTED_IDS = Object.freeze([
	...range('SB', 9),
	...range('SD', 5),
	...range('SW', 5),
	...range('SN', 12),
	...range('SDL', 9),
	...selected('LA', [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 16, 17]),
	...range('REL', 14),
	...selected('GAT', [1, 5, 6, 7, 8, 9, 10]),
]);

export const SOUNDSCAPER_STABLE_1_CHECKS = validateSoundscaperStable1CheckInventory(
	JSON.parse(readFileSync(new URL(
		'../../config/soundscaper-stable-1-check-inventory.json', import.meta.url,
	), 'utf8')),
).checks;

export const SOUNDSCAPER_STABLE_1_EXPECTED_CHECK_IDS = Object.freeze(
	SOUNDSCAPER_STABLE_1_CHECKS.map(({ id }) => id),
);

export function validateSoundscaperStable1CheckInventory(value) {
	const root = exactRecord(value,
		['schemaVersion', 'productId', 'releaseVersion', 'checks'],
		'Soundscaper Stable 1 check inventory');
	if (root.schemaVersion !== 1 || root.productId !== 'soundscaper'
		|| root.releaseVersion !== '1.0.0' || !Array.isArray(root.checks)) {
		throw new Error('Soundscaper Stable 1 check inventory identity is invalid.');
	}
	const checks = root.checks.map((value, index) => {
		const row = exactRecord(value, ['id', 'check'], `Soundscaper Stable 1 checks[${index}]`);
		if (!/^[A-Z]{2,3}-\d{2}$/u.test(row.id) || typeof row.check !== 'string'
			|| row.check.length < 16 || row.check.length > 2_048 || /[\r\n|]/u.test(row.check)) {
			throw new Error(`Soundscaper Stable 1 check ${String(row.id)} is invalid.`);
		}
		return Object.freeze({ ...row });
	});
	if (JSON.stringify(checks.map(({ id }) => id)) !== JSON.stringify(EXPECTED_IDS)) {
		throw new Error('Soundscaper Stable 1 check inventory IDs are not the exact approved scope.');
	}
	return Object.freeze({
		schemaVersion: 1,
		productId: 'soundscaper',
		releaseVersion: '1.0.0',
		checks: Object.freeze(checks),
	});
}

function range(prefix, count) {
	return Array.from({ length: count }, (_, index) => id(prefix, index + 1));
}

function selected(prefix, suffixes) {
	return suffixes.map((suffix) => id(prefix, suffix));
}

function id(prefix, suffix) {
	return `${prefix}-${String(suffix).padStart(2, '0')}`;
}

function exactRecord(value, fields, label) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)
		|| JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
		throw new Error(`${label} must have exact fields: ${fields.join(', ')}.`);
	}
	return value;
}
