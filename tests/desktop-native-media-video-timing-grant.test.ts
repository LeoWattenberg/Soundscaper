/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	HelperContractViolationError,
	helperJobGrantResourceUsage,
	validateHelperJobGrant,
} from '../desktop/helper-contract.ts';
import {
	nativeMediaHostArguments,
	type NativeMediaHostInvocation,
} from '../desktop/native-media-helper-job.ts';

const SHA = (byte: string): string => byte.repeat(64);
const IDENTITY = Object.freeze({ dev: 7, ino: 11 });
const TIMING = Object.freeze({
	role: 'video-timing' as const,
	path: '/private/scratch/timing-a.scti',
	bytes: 64,
	sha256: SHA('a'),
	identity: IDENTITY,
});
const PLAN = Object.freeze({
	dataPlaneVersion: 1 as const,
	transport: 'message-port' as const,
	streamId: '1'.repeat(40),
	direction: 'host-to-helper' as const,
	byteLength: 128,
	sha256: SHA('b'),
	maximumChunkBytes: 128,
	maximumInFlightChunks: 1,
});

function renderGrant() {
	return {
		executable: {
			role: 'ffmpeg' as const, path: '/app/framescaper-media-host', bytes: 4_096,
			sha256: SHA('c'), identity: { dev: 7, ino: 9 },
		},
		plan: PLAN,
		sources: [{
			type: 'file' as const, role: 'original' as const, path: '/private/source.mov',
			bytes: 2_048, sha256: SHA('d'), identity: { dev: 7, ino: 10 },
		}],
		videoTimingAssets: [TIMING],
		output: {
			rootPath: '/private/export', rootIdentity: { dev: 7, ino: 12 },
			temporaryPath: '/private/export/.movie.tmp', finalPath: '/private/export/movie.mov',
			maximumBytes: 8_192,
		},
		scratch: {
			rootPath: '/private/scratch', rootIdentity: { dev: 7, ino: 13 },
			reservationId: 'e'.repeat(40), maximumBytes: 16_384,
		},
	};
}

test('media helper grants carry timing assets as a closed authenticated file authority', () => {
	const grant = renderGrant();
	const admitted = validateHelperJobGrant('media-render', grant);
	assert.deepEqual(admitted.videoTimingAssets, [TIMING]);
	assert.equal(
		helperJobGrantResourceUsage('media-render', grant).inputBytes,
		4_096 + 128 + 2_048 + 64,
	);

	for (const videoTimingAssets of [
		[],
		[{ ...TIMING, role: 'original' }],
		[{ ...TIMING, path: 'relative.scti' }],
		[{ ...TIMING, bytes: 0 }],
		[{ ...TIMING, sha256: SHA('A') }],
		[TIMING, { ...TIMING, path: '/private/scratch/replay.scti', identity: { dev: 7, ino: 14 } }],
	]) {
		assert.throws(
			() => validateHelperJobGrant('media-render', { ...grant, videoTimingAssets }),
			(error: unknown) => error instanceof HelperContractViolationError
				&& error.code === 'unsafe-grant',
		);
	}
});

test('the media-host adapter emits a dedicated bounded timing grant tuple', () => {
	const invocation: NativeMediaHostInvocation = {
		executablePath: '/app/framescaper-media-host', operation: 'media-render',
		plan: { path: '/private/scratch/plan.json', sha256: PLAN.sha256 },
		sources: [{
			path: '/private/source.mov', sha256: SHA('d'), byteLength: 2_048, role: 'original',
		}],
		videoTimingAssets: [{
			path: TIMING.path, sha256: TIMING.sha256, byteLength: TIMING.bytes,
		}],
		backend: 'native-cpu', maximumOutputBytes: 8_192,
		scratchPath: '/private/scratch/job', decodeOutputPath: null,
		destinationRoot: '/private/export', temporaryOutputPath: '/private/export/.movie.tmp',
		proxyRecipe: null, imageSequence: null,
	};
	const args = nativeMediaHostArguments(invocation);
	assert.deepEqual(args.slice(0, 20), [
		'--operation', 'media-render',
		'--plan', '/private/scratch/plan.json', '--plan-sha256', PLAN.sha256,
		'--source', '/private/source.mov', '--source-sha256', SHA('d'),
		'--source-byte-length', '2048', '--source-role', 'original',
		'--video-timing-asset', TIMING.path,
		'--video-timing-sha256', TIMING.sha256,
		'--video-timing-byte-length', '64',
	]);
});
