/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeAup4Client, NativeProjectDocument } from '../src/common/editor/controller/document/native-project-types.ts';
import { createFixture, nativeFile, project } from './helpers/native-project-service-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

function importedProject(frames = 4): NativeProjectDocument {
	return { ...project('imported'), sources: ['one', 'two'].map((id) => ({
		kind: 'audio', id, storageKey: id, name: id, mimeType: 'audio/x-audacity-sampleblocks',
		frameCount: frames, channelCount: 1, sampleRate: 44_100,
	})) };
}

function clientFor(imported: NativeProjectDocument, events: string[]): NativeAup4Client {
	return {
		initialize: async () => ({ opfs: true }), create: async () => undefined,
		openFile: async (_id, _file, options) => {
			assert.ok(options.signal instanceof AbortSignal);
			return { readOnly: false };
		},
		decode: async () => assert.fail('streaming import must not allocate complete clips'),
		planImport: async () => { events.push('plan'); return { project: imported, sources: [] }; },
		async *readSourceChunks(_id, source, options) {
			for (let i = 0; i < 2; i += 1) {
				options.signal.throwIfAborted();
				events.push(`read:${source}:${i}`);
				yield [Float32Array.of(0.25, -0.5)];
			}
		},
		writeSnapshot: async () => ({}), commit: async () => undefined, export: async () => ({}),
		inspect: async () => ({}), delete: async () => { events.push('delete-native'); },
	};
}

test('large Audacity import preflights from metadata before requesting any audio', async () => {
	const events: string[] = [];
	const imported = importedProject(160_083_000);
	const client = clientFor(imported, events);
	const failure = new Error('Insufficient storage');
	const fixture = createFixture({
		createAup4Client: () => client,
		preflightStorage: (bytes) => { assert.equal(bytes, 1_280_664_000); throw failure; },
	});
	await assert.rejects(createNativeProjectService(fixture.runtime).openAudacityProject(nativeFile('large.aup3')), failure);
	assert.deepEqual(events, ['plan', 'delete-native']);
	assert.deepEqual(fixture.switched, []);
	assert.equal(fixture.state.importing, false);
});

test('audio pulls wait for storage and the project publishes only after every source commits', async () => {
	const events: string[] = [];
	const writing = deferred<void>();
	const started = deferred<void>();
	const imported = importedProject();
	const fixture = createFixture({ createAup4Client: () => clientFor(imported, events),
		preflightStorage: (bytes) => { assert.equal(bytes, 32); events.push('preflight'); },
	});
	fixture.runtime.store.beginSourceWrite = async (id) => ({
		write: async () => {
			events.push(`write:${id}`);
			started.resolve();
			await writing.promise;
		},
		commit: async () => { events.push(`commit:${id}`); }, abort: async () => assert.fail('unexpected abort'),
	});
	const opening = createNativeProjectService(fixture.runtime).openAudacityProject(nativeFile('large.aup3'));
	await started.promise;
	assert.deepEqual(events, ['plan', 'preflight', 'read:one:0', 'write:one']);
	assert.deepEqual(fixture.switched, []);
	writing.resolve();
	await opening;
	assert.deepEqual(events, ['plan', 'preflight',
		'read:one:0', 'write:one', 'read:one:1', 'write:one', 'commit:one',
		'read:two:0', 'write:two', 'read:two:1', 'write:two', 'commit:two', 'delete-native']);
	assert.deepEqual(fixture.switched, ['imported']);
	assert.equal(fixture.state.importing, false);
});

for (const cancel of [false, true]) {
	test(`a ${cancel ? 'cancelled' : 'failed'} stream rolls back audio and retains the current project`, async () => {
		const events: string[] = [];
		const fixture = createFixture({ createAup4Client: () => clientFor(importedProject(), events) });
		fixture.runtime.store.beginSourceWrite = async (id) => ({
			write: async () => {
				if (id !== 'two') return;
				if (cancel) fixture.lifetime.cancelTask('native-project-open');
				else throw new Error('Quota exceeded while writing');
			},
			commit: async () => { events.push(`commit:${id}`); },
			abort: async () => { events.push(`abort:${id}`); },
		});
		await assert.rejects(createNativeProjectService(fixture.runtime).openAudacityProject(nativeFile('large.aup3')),
			cancel ? { name: 'AbortError' } : /Quota exceeded/u);
		assert.deepEqual(fixture.deletedSources, ['one']);
		assert.equal(events.includes('abort:two'), true);
		assert.equal(events.includes('read:two:1'), false);
		assert.equal(events.at(-1), 'delete-native');
		assert.deepEqual(fixture.switched, []);
		assert.equal(fixture.state.importing, false);
	});
}

test('cancellation immediately after acquiring a writer still aborts that writer', async () => {
	const events: string[] = [];
	const fixture = createFixture({ createAup4Client: () => clientFor(importedProject(), events) });
	fixture.runtime.store.beginSourceWrite = async () => {
		fixture.lifetime.cancelTask('native-project-open');
		return { write: async () => assert.fail('must not write'), commit: async () => assert.fail('must not commit'),
			abort: async () => { events.push('abort'); } };
	};
	await assert.rejects(createNativeProjectService(fixture.runtime).openAudacityProject(nativeFile('large.aup3')), { name: 'AbortError' });
	assert.equal(events.includes('abort'), true);
	assert.deepEqual(fixture.switched, []);
});
