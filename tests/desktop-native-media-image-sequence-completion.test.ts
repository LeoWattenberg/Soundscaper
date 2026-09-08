/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertHelperDataPlaneOutputCompletion } from
	'../desktop/helper-data-plane-output-reservation.ts';
import { nativeMediaReservedOutputCompletion } from '../desktop/native-media-helper-job.ts';

test('image-sequence decode exposes only the reserved output completion identity', () => {
	const reservation = Object.freeze({
		dataPlaneVersion: 1 as const, transport: 'message-port' as const,
		streamId: '56'.repeat(20), direction: 'helper-to-host' as const,
		exactByteLength: 14, maximumByteLength: 14,
		maximumChunkBytes: 7, maximumInFlightChunks: 2,
	});
	const inspection = {
		temporaryPath: '/private/spool/output.bin', identity: { dev: 1, ino: 2 },
		byteLength: 14, sha256: 'a'.repeat(64),
	};
	const completion = nativeMediaReservedOutputCompletion(reservation, inspection);

	assert.deepEqual(Object.keys(completion), ['streamId', 'byteLength', 'sha256']);
	assert.deepEqual(assertHelperDataPlaneOutputCompletion(completion, reservation), completion);
});
