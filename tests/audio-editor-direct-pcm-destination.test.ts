/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openDirectPcmDestination } from '../src/common/editor/controller/direct-pcm-export.ts';

type SizeMode = 'exact' | 'maximum';

interface PreparedFixture {
	readonly admissions: Array<readonly [number, SizeMode]>;
	readonly prepared: Readonly<{
		mode: 'stream';
		createWritable(byteLength: number, sizeMode: SizeMode): Promise<WritableStream<Uint8Array>>;
		bytesWritten(): number;
		commit(): Promise<Readonly<Record<string, unknown>>>;
		abort(reason?: unknown): Promise<void>;
	}>;
	aborts(): number;
	commits(): number;
}

function createPreparedFixture(): PreparedFixture {
	const admissions: Array<readonly [number, SizeMode]> = [];
	let maximumBytes = 0;
	let sizeMode: SizeMode = 'exact';
	let byteLength = 0;
	let sealed = false;
	let aborts = 0;
	let commits = 0;
	return {
		admissions,
		prepared: Object.freeze({
			mode: 'stream' as const,
			async createWritable(
				admittedBytes: number,
				requestedSizeMode: SizeMode,
			): Promise<WritableStream<Uint8Array>> {
				admissions.push([admittedBytes, requestedSizeMode]);
				maximumBytes = admittedBytes;
				sizeMode = requestedSizeMode;
				return new WritableStream<Uint8Array>({
					write(chunk) {
						if (chunk.byteLength > maximumBytes - byteLength) {
							throw new RangeError('The prepared stream exceeds its admitted maximum.');
						}
						byteLength += chunk.byteLength;
					},
					close() { sealed = true; },
				});
			},
			bytesWritten: () => byteLength,
			async commit() {
				if (!sealed) throw new Error('The prepared stream is not sealed.');
				if (sizeMode === 'exact' && byteLength !== maximumBytes) {
					throw new RangeError('The prepared stream does not match its exact size.');
				}
				commits += 1;
				return Object.freeze({ size: byteLength });
			},
			async abort() { aborts += 1; },
		}),
		aborts: () => aborts,
		commits: () => commits,
	};
}

test('direct PCM destinations retain exact size mode by default', async () => {
	const fixture = createPreparedFixture();
	const preparation = await openDirectPcmDestination(fixture.prepared, 3, 'WAV');
	assert.ok(preparation.destination);
	assert.deepEqual(fixture.admissions, [[3, 'exact']]);
	await preparation.destination.write(Uint8Array.of(1, 2, 3));
	await preparation.destination.close();
	assert.deepEqual(await preparation.destination.commit(), { size: 3 });
	assert.equal(fixture.commits(), 1);
});

test('maximum direct PCM destinations admit a smaller sealed commit and enforce their maximum', async () => {
	const shortFixture = createPreparedFixture();
	const shortPreparation = await openDirectPcmDestination(
		shortFixture.prepared,
		4,
		'ZIP',
		'maximum',
	);
	assert.ok(shortPreparation.destination);
	assert.deepEqual(shortFixture.admissions, [[4, 'maximum']]);
	await shortPreparation.destination.write(Uint8Array.of(1, 2, 3));
	await shortPreparation.destination.close();
	assert.deepEqual(await shortPreparation.destination.commit(), { size: 3 });
	assert.equal(shortFixture.commits(), 1);

	const overflowFixture = createPreparedFixture();
	const overflowPreparation = await openDirectPcmDestination(
		overflowFixture.prepared,
		2,
		'ZIP',
		'maximum',
	);
	assert.ok(overflowPreparation.destination);
	await assert.rejects(
		overflowPreparation.destination.write(Uint8Array.of(1, 2, 3)),
		/admitted maximum/iu,
	);
	await overflowPreparation.destination.abort();
	assert.equal(overflowFixture.aborts(), 1);
	assert.equal(overflowFixture.commits(), 0);
});

test('maximum direct PCM destinations memoize a synchronously throwing prepared abort', async () => {
	const cleanup = new Error('synchronous maximum cleanup failed');
	let aborts = 0;
	const preparation = await openDirectPcmDestination({
		mode: 'stream',
		async createWritable() { return new WritableStream<Uint8Array>(); },
		bytesWritten() { return 0; },
		async commit() { return {}; },
		abort() { aborts += 1; throw cleanup; },
	}, 4, 'ZIP', 'maximum');
	assert.ok(preparation.destination);

	for (let attempt = 0; attempt < 2; attempt += 1) {
		await assert.rejects(preparation.destination.abort(), cleanup);
	}
	assert.equal(aborts, 1);
	await assert.rejects(preparation.destination.write(Uint8Array.of(1)), /not writable/iu);
});

test('maximum direct PCM destination cancellation and open cleanup retain existing behavior', async () => {
	const cancelled = Object.freeze({ mode: 'cancelled', cancelled: true });
	assert.deepEqual(
		await openDirectPcmDestination(cancelled, 8, 'ZIP', 'maximum'),
		{ cancelled, destination: null },
	);

	const primary = new Error('maximum destination open failed');
	let aborts = 0;
	await assert.rejects(openDirectPcmDestination({
		mode: 'stream',
		async createWritable() { throw primary; },
		bytesWritten() { return 0; },
		async commit() { return {}; },
		async abort(reason?: unknown) {
			aborts += 1;
			assert.equal(reason, primary);
		},
	}, 8, 'ZIP', 'maximum'), primary);
	assert.equal(aborts, 1);
});
