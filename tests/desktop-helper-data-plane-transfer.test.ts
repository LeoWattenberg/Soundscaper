/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { HelperDataPlaneTransferPort } from '../desktop/helper-data-plane-transfer.ts';
import {
	createHarness,
	settled,
	supervisionCause,
} from './helpers/helper-supervisor-double.ts';

const PLAN_BYTES = new Uint8Array([1, 2, 3]);
const PLAN_SHA = createHash('sha256').update(PLAN_BYTES).digest('hex');
const PLAN_STREAM = 'ab'.repeat(20);

class Port implements HelperDataPlaneTransferPort {
	closed = 0;
	readonly posted: unknown[] = [];
	postMessage(message: unknown): void { this.posted.push(message); }
	close(): void { this.closed += 1; }
}

test('a native job transfers exactly the ports named by its admitted data-plane bindings', async () => {
	const harness = createHarness({ kinds: ['media-encode'] });
	const port = new Port();
	const pending = harness.supervisor.runJob({
		kind: 'media-encode',
		grant: encodeGrant(),
		dataPlaneTransfers: [{ streamId: PLAN_STREAM, port }],
	});
	await settled();
	const channel = harness.latest();
	assert.equal(channel.posted[0]?.type, 'job');
	assert.deepEqual(channel.transfers[0], [port]);
	const job = channel.posted[0]!;
	channel.receive({
		contractVersion: 1,
		type: 'result',
		jobId: job.type === 'job' ? job.jobId : '',
		result: {
			output: {
				temporaryPath: '/exports/.movie.tmp',
				byteLength: 100,
				sha256: '56'.repeat(32),
				identity: { dev: 1, ino: 7 },
			},
		},
	});
	await pending;
});

test('missing, duplicate, wrong, or extra transfers fail before a helper is spawned', async () => {
	for (const dataPlaneTransfers of [
		undefined,
		[],
		[{ streamId: 'cd'.repeat(20), port: new Port() }],
		[
			{ streamId: PLAN_STREAM, port: new Port() },
			{ streamId: PLAN_STREAM, port: new Port() },
		],
	]) {
		const harness = createHarness({ kinds: ['media-encode'] });
		await assert.rejects(harness.supervisor.runJob({
			kind: 'media-encode',
			grant: encodeGrant(),
			...(dataPlaneTransfers === undefined ? {} : { dataPlaneTransfers }),
		}), (error: unknown) => supervisionCause(error) === 'invalid-request');
		assert.equal(harness.channels.length, 0);
	}

	const legacy = createHarness();
	await assert.rejects(legacy.supervisor.runJob({
		kind: 'probe-video-source',
		grant: { mediaPath: '/media/video.mov', mediaBytes: 12, identity: { dev: 1, ino: 2 } },
		dataPlaneTransfers: [{ streamId: PLAN_STREAM, port: new Port() }],
	}), (error: unknown) => supervisionCause(error) === 'invalid-request');
	assert.equal(legacy.channels.length, 0);
});

function encodeGrant() {
	return {
		backend: 'native-cpu' as const,
		executable: {
			role: 'ffmpeg' as const,
			path: '/runtime/framescaper-media-host',
			bytes: 32_768,
			sha256: '12'.repeat(32),
			identity: { dev: 1, ino: 2 },
		},
		plan: {
			dataPlaneVersion: 1 as const,
			transport: 'message-port' as const,
			streamId: PLAN_STREAM,
			direction: 'host-to-helper' as const,
			byteLength: PLAN_BYTES.byteLength,
			sha256: PLAN_SHA,
			maximumChunkBytes: PLAN_BYTES.byteLength,
			maximumInFlightChunks: 1,
		},
		sources: [{
			type: 'file' as const,
			role: 'original' as const,
			path: '/media/video.mov',
			bytes: 4_096,
			sha256: '34'.repeat(32),
			identity: { dev: 1, ino: 3 },
		}],
		output: {
			rootPath: '/exports', rootIdentity: { dev: 1, ino: 4 },
			temporaryPath: '/exports/.movie.tmp', finalPath: '/exports/movie.mov',
			maximumBytes: 4_096,
		},
		scratch: {
			rootPath: '/scratch', rootIdentity: { dev: 1, ino: 5 },
			reservationId: 'ef'.repeat(20), maximumBytes: 8_192,
		},
	};
}
