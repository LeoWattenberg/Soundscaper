/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createStreamingZipArchive,
	createTemporaryFileSink,
	stemProject,
} from '../src/common/editor/controller/temporary-export.ts';

const copy = {
	temporaryExportClosed: 'temporary export closed',
	largeStemsStorageRequired: 'large stems require storage',
	stemArchiveClosed: 'stem archive closed',
};

async function withNavigator<Value>(
	navigatorValue: unknown,
	callback: () => Promise<Value>,
): Promise<Value> {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: navigatorValue,
	});
	try {
		return await callback();
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
}

test('temporary memory sinks copy all buffer view types and reject writes after closing', async () => {
	await withNavigator({ storage: { getDirectory: async () => { throw new Error('not supported'); } } }, async () => {
		const sink = await createTemporaryFileSink('mix.wav', copy);
		assert.equal(sink.persistent, false);
		const data = Uint8Array.of(1, 2, 3, 4);
		await sink.write(data.subarray(0, 2));
		await sink.write(new DataView(data.buffer, 2, 1));
		await sink.write(Uint8Array.of(4).buffer);
		assert.throws(() => sink.writeAt(3, Uint8Array.of(5, 6)), /bytes already written/u);
		await sink.writeAt(1, Uint8Array.of(8, 7));
		data.fill(9);
		const blob = await sink.close('audio/wav');
		assert.equal(blob.type, 'audio/wav');
		assert.deepEqual(Array.from(new Uint8Array(await blob.arrayBuffer())), [1, 8, 7, 4]);
		assert.throws(() => sink.write(Uint8Array.of(5)), /temporary export closed/u);
		await assert.rejects(() => sink.close('audio/wav'), /temporary export closed/u);
		await sink.remove();
		await sink.abort();
	});
});

test('temporary persistent sinks serialize writes, close handles, and tolerate cleanup races', async () => {
	const events: string[] = [];
	const writable = {
		async write(input: Uint8Array | { position: number; data: Uint8Array }) {
			if (input instanceof Uint8Array) events.push(`write:${input[0]}`);
			else events.push(`writeAt:${input.position}:${input.data[0]}`);
		},
		async close() { events.push('close'); },
		async abort() {
			events.push('abort');
			throw new Error('already closed');
		},
	};
	const handle = {
		createWritable: async () => writable,
		getFile: async () => new Blob([Uint8Array.of(7)]),
	};
	const directory = {
		getFileHandle: async () => handle,
		async removeEntry() {
			events.push('remove');
			throw new Error('already removed');
		},
	};
	await withNavigator({
		storage: {
			getDirectory: async () => ({ getDirectoryHandle: async () => directory }),
		},
	}, async () => {
		const sink = await createTemporaryFileSink('mix.aiff', copy);
		assert.equal(sink.persistent, true);
		const first = sink.write(Uint8Array.of(1));
		const second = sink.write(Uint8Array.of(2));
		const patch = sink.writeAt(0, Uint8Array.of(9));
		await Promise.all([first, second, patch]);
		const file = await sink.close('audio/aiff');
		assert.equal(file.size, 1);
		assert.equal(file.type, 'audio/aiff');
		await sink.remove();
		assert.deepEqual(events.slice(0, 5), ['writeAt:0:1', 'writeAt:1:2', 'writeAt:0:9', 'close', 'remove']);
	});

	await withNavigator({
		storage: {
			getDirectory: async () => ({ getDirectoryHandle: async () => directory }),
		},
	}, async () => {
		const sink = await createTemporaryFileSink('aborted.aiff', copy);
		await sink.abort();
		assert.throws(() => sink.write(Uint8Array.of(1)), /temporary export closed/u);
	});
	assert.equal(events.includes('abort'), true);
});

test('streaming ZIP archives accept blobs and typed bytes, then become immutable', async () => {
	await withNavigator({ storage: {} }, async () => {
		const archive = await createStreamingZipArchive('stems.zip', 0, copy);
		await archive.add('blob.raw', new Blob([Uint8Array.of(1, 2, 3)]));
		await archive.add('empty.raw', new Uint8Array(0));
		await archive.add('view.raw', new DataView(Uint8Array.of(4, 5).buffer));
		const first = await archive.finish();
		const second = await archive.finish();
		assert.equal(second, first);
		assert.deepEqual(Array.from(new Uint8Array(await first.blob.arrayBuffer()).subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
		await assert.rejects(() => archive.add('late.raw', Uint8Array.of(9)), /stem archive closed/u);
		await first.cleanup();
		await archive.abort();
	});
});

test('streaming ZIP archives require persistent storage for large stem sets', async () => {
	await withNavigator({ storage: {} }, async () => {
		await assert.rejects(
			() => createStreamingZipArchive('large.zip', 97 * 1024 ** 2, copy),
			/large stems require storage/u,
		);
	});
});

test('aborted ZIP archives reject additions and allow repeated aborts', async () => {
	await withNavigator({ storage: {} }, async () => {
		const archive = await createStreamingZipArchive('cancelled.zip', 0, copy);
		await archive.abort();
		await archive.abort();
		await assert.rejects(() => archive.add('late.raw', Uint8Array.of(1)), /stem archive closed/u);
		await assert.rejects(() => archive.finish(), /stem archive closed/u);
	});
});

test('ZIP finalization failures abort and remove partial OPFS archives', async () => {
	const events: string[] = [];
	const writable = {
		async write() { events.push('write'); },
		async close() { events.push('close'); throw new Error('OPFS close failed'); },
		async abort() { events.push('abort'); },
	};
	const directory = {
		getFileHandle: async () => ({
			createWritable: async () => writable,
			getFile: async () => new Blob(),
		}),
		async removeEntry() { events.push('remove'); },
	};
	await withNavigator({
		storage: { getDirectory: async () => ({ getDirectoryHandle: async () => directory }) },
	}, async () => {
		const archive = await createStreamingZipArchive('failed.zip', 0, copy);
		await archive.add('entry.raw', Uint8Array.of(1));
		await assert.rejects(() => archive.finish(), /OPFS close failed/u);
		assert.deepEqual(events.slice(-3), ['close', 'abort', 'remove']);
	});
});

test('stem snapshots isolate one track and reset master processing', () => {
	const project = {
		schemaVersion: 1 as const,
		id: 'project',
		title: 'Mix',
		revision: 1,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		sampleRate: 48_000 as const,
		masterChannels: 2 as const,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [],
		clips: [],
		master: { gain: 0.5, effects: [] },
		tracks: [
			{
				id: 'lead', name: 'Lead', gain: 1, pan: 0, mute: true, solo: true,
				armed: false, effects: [], clipIds: [],
			},
			{
				id: 'drums', name: 'Drums', gain: 1, pan: 0, mute: false, solo: true,
				armed: false, effects: [], clipIds: [],
			},
		],
	};
	const snapshot = stemProject(project, 'lead');
	assert.notEqual(snapshot, project);
	assert.equal(snapshot.tracks[0]?.mute, false);
	assert.equal(snapshot.tracks[0]?.solo, false);
	assert.equal(snapshot.tracks[1]?.mute, true);
	assert.equal(snapshot.tracks[1]?.solo, false);
	assert.deepEqual(snapshot.master, { gain: 1, effects: [] });
});
