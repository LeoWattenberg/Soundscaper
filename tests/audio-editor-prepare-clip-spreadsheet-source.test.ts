/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isAudioEditorVideoFile } from '../src/common/editor/video-media.js';

import { createClipSpreadsheetSourcePreparer } from '../src/common/editor/controller/import/internal/prepare-clip-spreadsheet-source.ts';
import type { ProjectImportRuntime } from '../src/common/editor/controller/import/internal/project-import-runtime.ts';
import { bextMetadata, createFixture, deferred } from './audio-editor-project-import-service-fixture.ts';

const source = Object.freeze({
	id: 'prepared-source', name: 'voice.wav', sampleRate: 48_000, frameCount: 24_000,
	channelCount: 1, storageKey: 'prepared-source', opaqueExtensions: { bext: { description: 'Original' } },
});

test('ordinary audio-only WebM prepares audio while retaining the document-free import transaction', async () => {
	const bytes = Uint8Array.from(Buffer.from(readFileSync(new URL('./fixtures/chromium-audio-only.webm.base64', import.meta.url), 'utf8'), 'base64'));
	for (const type of ['audio/webm', 'video/webm']) {
		const fixture = createFixture();
		const runtime = { ...fixtureRuntime(fixture), isAudioEditorVideoFile };
		const project = runtime.getProject();
		const registered: string[] = [];
		const prepared = await createClipSpreadsheetSourcePreparer(runtime)(new File([bytes], 'Voice memo.webm', { type }), {
			signal: new AbortController().signal, onSourcePrepared: id => registered.push(id),
		});
		assert.equal(prepared.name, 'Voice memo.webm');
		assert.deepEqual(registered, [prepared.id]);
		assert.equal(fixture.sourceBuffers.has(prepared.id), true);
		assert.equal(runtime.getProject(), project);
		assert.deepEqual(fixture.commands, []);
		assert.deepEqual(fixture.placements, []);
	}
});

function fixtureRuntime(fixture: ReturnType<typeof createFixture>): ProjectImportRuntime {
	return fixture.runtime as unknown as ProjectImportRuntime;
}

test('preparing decoded audio retains source metadata without publishing or changing the project', async () => {
	const fixture = createFixture();
	const project = fixture.runtime.getProject();
	const before = structuredClone(project);
	const registered: string[] = [];
	const prepared = await createClipSpreadsheetSourcePreparer(fixtureRuntime(fixture))(
		new File([new ArrayBuffer(8)], 'voice.wav', { type: 'audio/wav' }),
		{ signal: new AbortController().signal, onSourcePrepared: id => registered.push(id) },
	);
	assert.equal(prepared.name, 'voice.wav');
	assert.equal(prepared.frameCount, 4);
	assert.equal(prepared.sampleRate, 48_000);
	assert.equal(prepared.channelCount, 1);
	assert.equal(typeof prepared.contentSha256, 'string');
	assert.deepEqual(registered, [prepared.id]);
	assert.equal(fixture.sourceBuffers.has(prepared.id), true);
	assert.deepEqual(fixture.commands, []);
	assert.equal(fixture.calls.includes('publish'), false);
	assert.equal(fixture.runtime.getProject(), project);
	assert.deepEqual(project, before);
});

test('source registration precedes import completion and ignores bin and metadata commands', async () => {
	const fixture = createFixture();
	const project = fixture.runtime.getProject();
	const registered: string[] = [];
	const captured = deferred<void>();
	const complete = deferred<void>();
	const controller = new AbortController();
	const prepare = createClipSpreadsheetSourcePreparer(fixtureRuntime(fixture), runtime => ({
		importFile: async (input: unknown, options: unknown) => {
			assert.equal(input, inputFile);
			assert.deepEqual(options, { destination: 'project-bin', signal: controller.signal });
			assert.equal(runtime.commit({ type: 'batch', commands: [
				{ type: 'metadata/update', changes: { bext: { description: 'Should not apply' } } },
				{ type: 'source/add', source },
				{ type: 'project-bin/add', clip: { id: 'discarded-bin-clip', sourceId: source.id } },
			] }), project);
			assert.deepEqual(registered, [source.id]);
			captured.resolve();
			await complete.promise;
			return { sourceId: source.id };
		},
	}));
	const inputFile = new File([], 'voice.wav');
	const pending = prepare(inputFile, { signal: controller.signal, onSourcePrepared: id => registered.push(id) });
	await captured.promise;
	assert.deepEqual(fixture.commands, []);
	assert.equal(fixture.runtime.getProject(), project);
	assert.deepEqual(project.metadata, { bext: null });
	complete.resolve();
	assert.deepEqual(await pending, source);
});

test('preparing streamed PCM activates stored media and retains file metadata without applying project metadata', async () => {
	const fixture = createFixture();
	const bext = bextMetadata();
	fixture.options.incrementalDescriptor = {
		channelCount: 1, frameCount: 4, sampleRate: 48_000, pcmBytes: 16, bext,
	};
	const project = fixture.runtime.getProject();
	const registered: string[] = [];
	const prepared = await createClipSpreadsheetSourcePreparer(fixtureRuntime(fixture))(
		new File([new ArrayBuffer(8)], 'streamed.wav', { type: 'audio/wav' }),
		{ signal: new AbortController().signal, onSourcePrepared: id => {
			assert.equal(fixture.sourceChunkProviders.has(id), true);
			registered.push(id);
		} },
	);
	assert.deepEqual(prepared.opaqueExtensions, { bext });
	assert.deepEqual(registered, [prepared.id]);
	assert.deepEqual(fixture.commands, []);
	assert.equal(fixture.calls.includes('publish'), false);
	assert.equal(fixture.runtime.getProject(), project);
	assert.deepEqual(project.metadata, { bext: null });
});

test('a failure after source capture leaves its ID registered for caller cleanup', async () => {
	const fixture = createFixture();
	const registered: string[] = [];
	const prepare = createClipSpreadsheetSourcePreparer(fixtureRuntime(fixture), runtime => ({
		importFile: async () => {
			runtime.commit({ type: 'source/add', source });
			throw new Error('post-import verification failed');
		},
	}));
	await assert.rejects(prepare(new File([], 'voice.wav'), {
		signal: new AbortController().signal, onSourcePrepared: id => registered.push(id),
	}), /post-import verification failed/u);
	assert.deepEqual(registered, [source.id]);
	assert.deepEqual(fixture.commands, []);
});

test('invalid metadata and multiple sources register prepared IDs before validation rejects', async () => {
	for (const sources of [[{ ...source, frameCount: 0 }], [source, { ...source, id: 'second-source' }]]) {
		const fixture = createFixture();
		const registered: string[] = [];
		const prepare = createClipSpreadsheetSourcePreparer(fixtureRuntime(fixture), runtime => ({
			importFile: async () => runtime.commit({
				type: 'batch', commands: sources.map(value => ({ type: 'source/add', source: value })),
			}),
		}));
		await assert.rejects(prepare(new File([], 'voice.wav'), {
			signal: new AbortController().signal, onSourcePrepared: id => registered.push(id),
		}), /one valid audio source/u);
		assert.deepEqual(registered, sources.map(value => value.id));
		assert.deepEqual(fixture.commands, []);
	}
});

test('cancellation after capture retains cleanup registration and rejects the prepared source', async () => {
	const fixture = createFixture();
	const controller = new AbortController();
	const registered: string[] = [];
	const prepare = createClipSpreadsheetSourcePreparer(fixtureRuntime(fixture), runtime => ({
		importFile: async () => {
			runtime.commit({ type: 'source/add', source });
			controller.abort();
		},
	}));
	await assert.rejects(prepare(new File([], 'voice.wav'), {
		signal: controller.signal, onSourcePrepared: id => registered.push(id),
	}), { name: 'AbortError' });
	assert.deepEqual(registered, [source.id]);
});

test('video and project imports are rejected before creating an import service', async () => {
	const fixture = createFixture();
	const prepare = createClipSpreadsheetSourcePreparer(fixtureRuntime(fixture), () => {
		throw new Error('Import service must not run.');
	});
	for (const input of [new File([], 'movie.mp4', { type: 'video/mp4' }), new File([], 'session.aup')]) {
		await assert.rejects(prepare(input, {
			signal: new AbortController().signal, onSourcePrepared: () => assert.fail('No source should be prepared.'),
		}), /audio files/u);
	}
	assert.deepEqual(fixture.commands, []);
	assert.equal(fixture.calls.includes('create-project'), false);
});

test('the preparation runtime prevents video import and project switching even if routing changes', async () => {
	for (const action of ['video', 'switch', 'publish'] as const) {
		const fixture = createFixture();
		const prepare = createClipSpreadsheetSourcePreparer(fixtureRuntime(fixture), runtime => ({
			importFile: async () => {
				if (action === 'video') await runtime.importVideoFile(new File([], 'unexpected.mp4'));
				else if (action === 'switch') await runtime.switchProject(runtime.getProject()!);
				else runtime.publishDocumentSnapshot();
			},
		}));
		await assert.rejects(prepare(new File([], 'voice.wav'), {
			signal: new AbortController().signal, onSourcePrepared: () => assert.fail('No source should be prepared.'),
		}), /audio source preparation/u);
		assert.deepEqual(fixture.placements, []);
		assert.equal(fixture.calls.includes('publish'), false);
		assert.equal(fixture.calls.some(value => value.startsWith('switch:')), false);
	}
});
