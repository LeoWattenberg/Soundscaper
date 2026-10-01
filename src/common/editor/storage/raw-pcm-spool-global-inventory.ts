/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import {
	captureSpoolDataRecord as dataRecord,
	captureSpoolStableId as stableId,
} from './capture-spool-validation.ts';
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
		entries: Object.freeze([...entries].sort((left, right) => compareCodeUnits(left.spoolToken, right.spoolToken))) });
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
