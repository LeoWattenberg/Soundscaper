/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingSourceMetadata } from './recording-transaction-types.ts';

/** Validate committed storage data before publishing a recording into a document. */
export function readRecordingSourceMetadata(value: unknown): RecordingSourceMetadata {
	if (!isRecordingSourceMetadata(value)) throw new TypeError('Invalid recording source metadata.');
	return value;
}

function isRecordingSourceMetadata(value: unknown): value is RecordingSourceMetadata {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| !('name' in value) || typeof value.name !== 'string' || value.name.length === 0) return false;
	return !('channelCount' in value) || value.channelCount === undefined
		|| (typeof value.channelCount === 'number' && Number.isSafeInteger(value.channelCount) && value.channelCount > 0);
}
