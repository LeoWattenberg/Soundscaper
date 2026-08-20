/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RawPcmSpoolRecord } from './raw-pcm-spool-record.ts';

export const RAW_PCM_MAXIMUM_GLOBAL_ACTIVE_SPOOLS = 4_096;

export interface RawPcmSpoolGlobalInventory {
	readonly version: 1;
	readonly entries: readonly Readonly<{
		readonly projectId: string;
		readonly spoolId: string;
		readonly spoolToken: string;
	}>[];
}

export function normalizeRawPcmSpoolGlobalInventory(value: unknown): RawPcmSpoolGlobalInventory {
	const record = dataRecord(value, 'raw PCM spool global inventory');
	if (record.version !== 1 || !Array.isArray(record.entries)
		|| record.entries.length > RAW_PCM_MAXIMUM_GLOBAL_ACTIVE_SPOOLS) {
		throw new Error('Raw PCM spool global inventory is invalid.');
	}
	const entries = record.entries.map((value) => {
		const entry = dataRecord(value, 'raw PCM spool global inventory entry');
		return Object.freeze({
			projectId: stableId(entry.projectId, 'raw PCM spool projectId'),
			spoolId: stableId(entry.spoolId, 'raw PCM spool ID'),
			spoolToken: stableId(entry.spoolToken, 'raw PCM spool token'),
		});
	});
	if (new Set(entries.map(({ spoolToken }) => spoolToken)).size !== entries.length) {
		throw new Error('Raw PCM spool global inventory contains duplicate ownership.');
	}
	return freezeRawPcmSpoolGlobalInventory(entries);
}

export function freezeRawPcmSpoolGlobalInventory(
	entries: RawPcmSpoolGlobalInventory['entries'],
): RawPcmSpoolGlobalInventory {
	return Object.freeze({ version: 1,
		entries: Object.freeze([...entries].sort((left, right) => left.spoolToken.localeCompare(right.spoolToken))) });
}

export function rawPcmSpoolGlobalEntry(
	record: RawPcmSpoolRecord,
): RawPcmSpoolGlobalInventory['entries'][number] {
	return Object.freeze({
		projectId: record.projectId,
		spoolId: record.spoolId,
		spoolToken: record.spoolToken,
	});
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a data record.`);
	return value as Readonly<Record<string, unknown>>;
}
function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
