/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	commitDirectStemArchiveDestination,
	directStemArchiveTemporaryBytes,
	prepareDirectStemArchiveDestination,
} from '../src/common/editor/controller/direct-stem-archive-export.ts';
import { inspectZip32Layout } from '../src/common/editor/controller/zip32.ts';

test('direct stem admission opens one exact ZIP destination before rendering', async () => {
	const plan = eligiblePlan();
	const requests: Array<Readonly<Record<string, unknown>>> = [];
	const opened: unknown[] = [];
	const prepared = preparedStream({ opened });
	const signal = new AbortController().signal;
	const result = await prepareDirectStemArchiveDestination({
		prepareSave(request) {
			requests.push(request);
			return prepared;
		},
	}, plan, {
		saveTarget: Object.freeze({ id: 'chosen-target' }),
		useFileSystemAccess: false,
	}, signal);

	assert.equal(result.cancelled, null);
	assert.ok(result.destination);
	assert.deepEqual(opened, [[plan.archive.expectedByteLength, 'exact']]);
	assert.deepEqual(requests, [{
		purpose: 'audio',
		suggestedName: 'session-stems.zip',
		mimeType: 'application/zip',
		target: { id: 'chosen-target' },
		types: [{
			description: 'ZIP stem archive',
			accept: { 'application/zip': ['.zip'] },
		}],
		useFileSystemAccess: false,
		signal,
	}]);
	assert.equal(directStemArchiveTemporaryBytes(plan), 60);
});

test('direct stem admission returns cancellation and rejects inexact pipeline families before a picker', async () => {
	const cancellation = Object.freeze({ mode: 'cancelled' as const, cancelled: true, fileName: 'session-stems.zip' });
	const cancelled = await prepareDirectStemArchiveDestination({
		prepareSave: () => cancellation,
	}, eligiblePlan(), null, new AbortController().signal);
	assert.strictEqual(cancelled.cancelled, cancellation);
	assert.equal(cancelled.destination, null);

	for (const plan of ineligiblePlans()) {
		let calls = 0;
		const result = await prepareDirectStemArchiveDestination({
			prepareSave() { calls += 1; return { mode: 'blob' }; },
		}, plan, null, new AbortController().signal);
		assert.equal(calls, 0, plan.label);
		assert.equal(result.cancelled, null, plan.label);
		assert.equal(result.destination, null, plan.label);
		assert.equal(directStemArchiveTemporaryBytes(plan), null, plan.label);
	}
});

test('direct stem commit verifies emitted, destination, and committed ZIP byte counts', async () => {
	const plan = eligiblePlan();
	const writes: Uint8Array[] = [];
	let committed = 0;
	const prepared = preparedStream({ writes, onCommit: () => { committed += 1; } });
	const preparation = await prepareDirectStemArchiveDestination({
		prepareSave: () => prepared,
	}, plan, null, new AbortController().signal);
	const destination = preparation.destination;
	assert.ok(destination);
	await destination.write(new Uint8Array(plan.archive.expectedByteLength));
	await destination.close();
	let assertions = 0;
	const published = await commitDirectStemArchiveDestination(
		destination,
		plan.archive.expectedByteLength,
		plan.archive.expectedByteLength,
		() => { assertions += 1; },
	);

	assert.equal(writes.reduce((sum, chunk) => sum + chunk.byteLength, 0), plan.archive.expectedByteLength);
	assert.equal(committed, 1);
	assert.equal(assertions, 1);
	assert.deepEqual(published, {
		method: 'memory', fileName: 'session-stems.zip', size: plan.archive.expectedByteLength,
	});

	const drift = preparedStream();
	const driftPreparation = await prepareDirectStemArchiveDestination({
		prepareSave: () => drift,
	}, plan, null, new AbortController().signal);
	assert.ok(driftPreparation.destination);
	await driftPreparation.destination.write(new Uint8Array(plan.archive.expectedByteLength));
	await driftPreparation.destination.close();
	await assert.rejects(
		commitDirectStemArchiveDestination(
			driftPreparation.destination,
			plan.archive.expectedByteLength,
			plan.archive.expectedByteLength - 1,
			() => undefined,
		),
		/encoder byte count.*planned file size/iu,
	);
});

function eligiblePlan() {
	const entries = [
		{ fileName: '01-dialogue.wav', expectedByteLength: 60 },
		{ fileName: '02-music.wav', expectedByteLength: 60 },
	];
	const zip32 = inspectZip32Layout(entries.map(({ fileName, expectedByteLength }) => ({
		fileName, byteLength: expectedByteLength,
	})));
	return {
		mode: 'stems',
		format: 'wav',
		mimeType: 'audio/wav',
		outputFileBytesPerRender: 60,
		outputs: entries.map(({ fileName }, index) => ({ fileName, trackId: `track-${index}` })),
		archive: {
			format: 'zip',
			fileName: 'session-stems.zip',
			mimeType: 'application/zip',
			expectedByteLength: zip32.archiveByteLength,
			requiredTemporaryBytes: zip32.archiveByteLength + 60,
			fallbackRequiredTemporaryBytes: 120,
			entries,
			zip32,
		},
	};
}

function ineligiblePlans(): Array<ReturnType<typeof eligiblePlan> & { label: string }> {
	const base = eligiblePlan();
	return [
		{ ...base, label: 'mix mode', mode: 'mix' },
		{ ...base, label: 'compressed output', format: 'mp3' },
		{ ...base, label: 'BW64 output', format: 'bw64' },
		{ ...base, label: '7z archive', archive: { ...base.archive, format: '7z' } },
		{ ...base, label: 'inexact archive', archive: { ...base.archive, expectedByteLength: null } },
		{
			...base,
			label: 'entry mismatch',
			archive: {
				...base.archive,
				entries: [
					{ fileName: 'wrong.wav', expectedByteLength: 60 },
					base.archive.entries[1]!,
				],
			},
		},
		{
			...base,
			label: 'ZIP geometry drift',
			archive: {
				...base.archive,
				zip32: { ...base.archive.zip32, archiveByteLength: base.archive.expectedByteLength - 1 },
			},
		},
		{ ...base, label: 'entry-size drift', outputFileBytesPerRender: 61 },
	] as Array<ReturnType<typeof eligiblePlan> & { label: string }>;
}

function preparedStream(options: Readonly<{
	opened?: unknown[];
	writes?: Uint8Array[];
	onCommit?: () => void;
}> = {}) {
	let bytes = 0;
	let declared = 0;
	return {
		mode: 'stream' as const,
		async createWritable(byteLength: number, sizeMode: string) {
			declared = byteLength;
			options.opened?.push([byteLength, sizeMode]);
			return new WritableStream<Uint8Array>({
				write(chunk) {
					const copy = chunk.slice();
					options.writes?.push(copy);
					bytes += copy.byteLength;
				},
			});
		},
		bytesWritten: () => bytes,
		commit() {
			options.onCommit?.();
			return { method: 'memory', fileName: 'session-stems.zip', size: declared };
		},
		abort: async () => undefined,
	};
}
