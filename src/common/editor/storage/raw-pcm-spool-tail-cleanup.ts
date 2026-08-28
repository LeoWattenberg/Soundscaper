/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import {
	prepareCaptureSpoolTailCleanup,
	recoverCaptureSpoolTailCleanup,
} from './capture-spool-tail-cleanup-repository.ts';
import type { RawPcmSpoolRecord } from './raw-pcm-spool-repository.ts';

const MAXIMUM_CAS_ATTEMPTS = 32;

interface RawPcmTailValues {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	replaceIfCurrentAndPutIfAbsent?(
		key: string, expected: unknown, replacement: unknown, intentKey: string, intent: unknown,
	): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
}

interface RawPcmTailChunks {
	deleteChunksFrom?(token: string, firstIndex: number): PromiseLike<void> | void;
}

interface RawPcmRegistrySnapshot {
	readonly value: unknown;
	readonly records: readonly RawPcmSpoolRecord[];
}

export async function prepareRawPcmSpoolTail(
	values: RawPcmTailValues,
	current: RawPcmSpoolRecord,
	acknowledged: RawPcmSpoolRecord,
	registryKey: string,
	loadRegistry: () => Promise<RawPcmRegistrySnapshot>,
): Promise<boolean> {
	for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
		const registry = await loadRegistry();
		const index = registry.records.findIndex(({ spoolId }) => spoolId === current.spoolId);
		if (index < 0 || !sameData(registry.records[index], current)) return false;
		const records = [...registry.records];
		records[index] = acknowledged;
		const replacement = Object.freeze({
			version: 1 as const,
			projectId: current.projectId,
			records: Object.freeze(records.sort((left, right) => compareCodeUnits(left.spoolId, right.spoolId))),
		});
		if (await prepareCaptureSpoolTailCleanup(
			values, identity(acknowledged), registryKey, registry.value, replacement,
		)) return true;
	}
	throw new Error('Raw PCM spool tail preparation exceeded its bounded CAS retry limit.');
}

export function recoverRawPcmSpoolTail(
	values: RawPcmTailValues,
	chunks: RawPcmTailChunks,
	record: RawPcmSpoolRecord,
): Promise<void> {
	return recoverCaptureSpoolTailCleanup(values, identity(record), async (firstIndex) => {
		if (!chunks.deleteChunksFrom) throw new Error('Raw PCM acknowledged-prefix cleanup is unavailable.');
		await chunks.deleteChunksFrom(record.spoolToken, firstIndex);
	});
}

function identity(record: RawPcmSpoolRecord) {
	return Object.freeze({
		storageKind: 'raw-pcm' as const,
		projectId: record.projectId,
		spoolId: record.spoolId,
		spoolToken: record.spoolToken,
		sourceId: null,
		firstIndex: record.chunkCount,
	});
}

function sameData(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
