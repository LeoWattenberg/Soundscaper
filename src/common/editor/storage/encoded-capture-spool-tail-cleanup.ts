/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	prepareCaptureSpoolTailCleanup,
	recoverCaptureSpoolTailCleanup,
} from './capture-spool-tail-cleanup-repository.ts';

interface EncodedCaptureTailIdentity {
	readonly projectId: string;
	readonly spoolId: string;
	readonly spoolToken: string;
	readonly sourceId: string;
	readonly chunkCount: number;
}

interface EncodedCaptureTailValues {
	get(key: string): PromiseLike<unknown> | unknown;
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	replaceIfCurrentAndPutIfAbsent?(
		key: string, expected: unknown, replacement: unknown, intentKey: string, intent: unknown,
	): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
}

interface EncodedCaptureTailChunks {
	deleteTailOwned(token: string, sourceId: string, firstIndex: number): PromiseLike<boolean> | boolean;
}

export function recoverEncodedCaptureSpoolTail(
	values: EncodedCaptureTailValues,
	chunks: EncodedCaptureTailChunks,
	record: EncodedCaptureTailIdentity,
): Promise<void> {
	return recoverCaptureSpoolTailCleanup(values, identity(record), async (firstIndex) => {
		if (!await chunks.deleteTailOwned(record.spoolToken, record.sourceId, firstIndex)) {
			throw new Error('Encoded capture tail cleanup ownership changed.');
		}
	});
}

export function prepareEncodedCaptureSpoolTail(
	values: EncodedCaptureTailValues,
	metadataKey: string,
	current: unknown,
	acknowledged: EncodedCaptureTailIdentity,
): Promise<boolean> {
	return prepareCaptureSpoolTailCleanup(values, identity(acknowledged), metadataKey, current, acknowledged);
}

function identity(record: EncodedCaptureTailIdentity) {
	return Object.freeze({
		storageKind: 'encoded-media' as const,
		projectId: record.projectId,
		spoolId: record.spoolId,
		spoolToken: record.spoolToken,
		sourceId: record.sourceId,
		firstIndex: record.chunkCount,
	});
}
