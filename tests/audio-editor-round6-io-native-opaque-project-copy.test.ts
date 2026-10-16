/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectComposition } from '../src/common/editor/controller/document/native-project-composition.ts';
import { createEditorTaskProgressCoordinator } from '../src/common/editor/controller/shared/task-progress.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { nativeSidecarFixture } from './helpers/framescaper-native-sidecar-fixture.ts';
import { retainNativeScapeArchive } from '../src/common/editor/controller/document/internal/native-project/native-scape-retention.ts';
import { copyFutureScapeArchive } from '../src/common/editor/scape-archive-copy.ts';
import { createScapeArchiveByteSource, type ScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from '../src/common/editor/scape-export-estimate.ts';
import { isDesktopScapeArchiveByteSource, createRetainedDesktopScapeArchiveByteSource } from '../src/common/editor/desktop-scape-archive-byte-source.ts';
import type { ScapeProjectInput } from '../src/common/editor/scape-project-input.ts';

for (const desktop of [false, true]) {
	test(`ordinary foreign-product ${desktop ? 'native' : 'browser'} File Open retains exact bytes for Save As`, async (context) => {
		const store = createProjectStore({ indexedDB: null, databaseName: `opaque-copy-${crypto.randomUUID()}` });
		context.after(async () => { await store.close(); });
		const exported = await exportScapeProject(createSoundscaperProject({}), store);
		assert.ok(exported.blob);
		const bytes = new Uint8Array(await exported.blob.arrayBuffer());
		const native = desktop ? await nativeSidecarFixture('ordinary.sscape', bytes) : null;
		if (native) context.after(native.close);
		const saved: Blob[] = [];
		const copyInputs: ScapeProjectInput[] = [];
		const fixture = createFixture({
			importScapeProject: async (input, _store, options) => await importScapeProject(input, store, {
				...options, currentProjectSchemaFamily: 'framescaper',
			}),
			exportScapeProject: async () => { throw new Error('Do not serialize the opaque foreign project.'); },
			hasMissingTimelineSources: () => { throw new Error('Do not inspect the opaque foreign sources.'); },
		});
		const service = createNativeProjectComposition({
			...fixture.runtime, currentProjectSchemaFamily: 'framescaper', projectFileExtension: '.fscape',
			copyFutureScapeArchive: async (input, write, options) => {
				copyInputs.push(input);
				return await copyFutureScapeArchive(input, write, { ...options, currentProjectSchemaFamily: 'framescaper' });
			},
			taskProgress: createEditorTaskProgressCoordinator(),
			copy: { ...fixture.runtime.copy, projectSaving: 'Saving' },
			fileService: { ...fixture.runtime.fileService, isDesktop: desktop, saveFile: async (request) => {
				saved.push(request.blob); return { size: request.blob.size };
			} },
		});
		context.after(async () => { await service.dispose(); });
		let nativeSource: ScapeArchiveByteSource | undefined;
		if (native) {
			const fileService = createAudioEditorFileService({ bridge: native.bridge, fetch: native.fetch });
			const descriptors = await fileService.chooseFiles({ purpose: 'project' });
			nativeSource = await fileService.withScapeReadDescriptor(descriptors[0], {}, async (source: ScapeArchiveByteSource) => {
				await service.openScape(source); return source;
			});
			assert.equal(native.releases.length, 1);
		} else await service.openScape(new File([exported.blob], 'ordinary.sscape'));
		fixture.state.readOnly = true;
		await service.saveScape({ saveCopy: true });
		assert.equal(saved.length, 1);
		assert.deepEqual(new Uint8Array(await saved[0]!.arrayBuffer()), bytes);
		if (native) {
			assert.equal(copyInputs.length, 1);
			const original = nativeSource;
			const [retained] = copyInputs;
			assert.ok(isDesktopScapeArchiveByteSource(original));
			assert.ok(isDesktopScapeArchiveByteSource(retained));
			assert.notStrictEqual(original, retained);
			assert.equal(retained.maximumReadBytes, original.maximumReadBytes);
			assert.deepEqual(await retained.read({ offset: 0, length: 2 }), bytes.slice(0, 2));
			await assert.rejects(original.read({ offset: 0, length: 2 }), /range read failed/iu);
		} else assert.equal(copyInputs.length, 1);
	});
}

test('native opaque retention keeps bounded exact bytes and releases its owned staging', async (context) => {
	const store = createProjectStore({ indexedDB: null, databaseName: `retained-bytes-${crypto.randomUUID()}` });
	context.after(async () => { await store.close(); });
	const exported = await exportScapeProject(createSoundscaperProject({}), store);
	assert.ok(exported.blob);
	const archive = exported.blob;
	const reads: number[] = [];
	const input = createScapeArchiveByteSource({ size: archive.size, maximumReadBytes: 64,
		read: async ({ offset, length }) => {
			reads.push(length); return new Uint8Array(await archive.slice(offset, offset + length).arrayBuffer());
		},
	});
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let cleaned = 0;
	let aborted = 0;
	const retained = await retainNativeScapeArchive({ scapeMimeType: archive.type }, input, {
		projectId: 'project', manifest: {}, signal: new AbortController().signal, assertCurrent: () => undefined,
		createSink: async () => ({ persistent: true,
			write: async (chunk) => { chunks.push(Uint8Array.from(chunk as Uint8Array)); },
			close: async (type) => new Blob(chunks, { type }), remove: async () => { cleaned += 1; },
			abort: async () => { aborted += 1; },
		}),
	});
	assert.ok(reads.length > 1);
	assert.ok(reads.every((length) => length <= 64));
	assert.equal(retained.copySource, undefined, 'ordinary byte sources gain no desktop admission');
	assert.throws(() => createRetainedDesktopScapeArchiveByteSource(input, archive), /admitted desktop Scape source/u);
	assert.deepEqual(await retained.archive.arrayBuffer(), await archive.arrayBuffer());
	assert.equal(cleaned, 0);
	assert.equal(aborted, 0);
	await retained.cleanup?.();
	assert.equal(cleaned, 1);
});

test('opaque retention keeps the existing whole-Blob warning before reading a large nonpersistent input', async () => {
	let reads = 0;
	let aborted = 0;
	const input = createScapeArchiveByteSource({ size: SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES + 1,
		read: () => { reads += 1; throw new Error('No read before large-file admission.'); },
	});
	await assert.rejects(retainNativeScapeArchive({ scapeMimeType: 'application/zip' }, input, {
		projectId: 'project', manifest: {}, signal: new AbortController().signal, assertCurrent: () => undefined,
		createSink: async () => ({ persistent: false, write: async () => undefined,
			close: async () => new Blob(), remove: async () => undefined, abort: async () => { aborted += 1; },
		}),
	}), { name: 'FileSizeWarningRequiredError' });
	assert.equal(reads, 0);
	assert.equal(aborted, 1);
});

test('opaque retention aborts staging after source cancellation and checks ownership before publication', async () => {
	for (const cancellation of [false, true]) {
		const abort = new AbortController();
		const lostOwnership = new Error('Project changed during archive copy.');
		let copied = false;
		let aborted = 0;
		const input = createScapeArchiveByteSource({ size: 1, read: () => Uint8Array.of(1) });
		await assert.rejects(retainNativeScapeArchive({ scapeMimeType: 'application/zip' }, input, {
			projectId: 'project', manifest: {}, signal: abort.signal,
			assertCurrent: () => { if (copied && !cancellation) throw lostOwnership; },
			createSink: async () => ({ persistent: true, write: async () => {
				copied = true; if (cancellation) abort.abort(lostOwnership);
			},
				close: async () => new Blob([Uint8Array.of(1)]), remove: async () => undefined,
				abort: async () => { aborted += 1; },
			}),
		}), (error: unknown) => error === lostOwnership);
		assert.equal(aborted, 1);
	}
});
