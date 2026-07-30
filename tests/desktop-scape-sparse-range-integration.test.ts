/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter, setMaxListeners } from 'node:events';
import { open, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { createProtocolHandler } from '../desktop/protocol.js';
import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import type { ScapeProjectInspector } from '../src/common/editor/controller/scape-inspection-service.ts';
import {
	createScapeProjectFileService,
	type ScapeProjectInspection,
} from '../src/common/editor/controller/scape-project-file-service.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import type { ScapeManifest } from '../src/common/editor/scape-archive-envelope.ts';
import { inspectScapeProject } from '../src/common/editor/scape-project.js';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-v9.ts';
import { withDesktopProjectReadDescriptor } from '../src/common/editor/ui/workspace/desktop-project-file-routing.ts';
import {
	createSparseEightGiBScapeFixture,
	isSparseFixturePlatformError,
	probeSparseFileSupport,
} from './helpers/sparse-scape-zip64-fixture.ts';

const MAX_PROTOCOL_RANGE_BYTES = 16 * 1024 ** 2;
const MAX_INSPECTION_TRANSFER_BYTES = 8 * 1024 ** 2;
const ZIP_END_SEARCH_BYTES = 22 + 0xffff;
type SparseScapeInspection = ScapeProjectInspection & { readonly manifest: ScapeManifest };

test('an 8 GiB sparse desktop Scape is inspected through bounded ranges and cancelled before import', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-sparse-scape-'));
	let store: ReadCapabilityStore | null = null;
	context.after(async () => {
		const activeStore = store;
		if (activeStore) await Promise.resolve(activeStore.dispose()).catch(() => undefined);
		await rm(root, { recursive: true, force: true });
	});

	const probe = await probeSparseFileSupport(root);
	if (!probe.supported) {
		context.skip(`Sparse-file fixture unavailable: ${probe.reason}`);
		return;
	}

	let fixture;
	try {
		fixture = await createSparseEightGiBScapeFixture(join(root, 'eight-gib.scape'));
	} catch (error) {
		if (!isSparseFixturePlatformError(error)) throw error;
		context.skip(`Sparse-file fixture unavailable: ${error.message}`);
		return;
	}
	assert.equal(fixture.logicalSize, 8 * 1024 ** 3);
	assert.equal(fixture.assetSha256, '7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be');
	assert.equal(fixture.assetCrc32, 2_909_126_900);
	assert.ok(fixture.allocatedBytes < MAX_INSPECTION_TRANSFER_BYTES);
	assert.deepEqual(fixture.entries.map(({ name }) => name), [
		'project.json',
		'media/video-source/original',
		'manifest.json',
	]);
	assert.equal(fixture.entries[0]?.localOffset, 0);
	for (let index = 1; index < fixture.entries.length; index += 1) {
		assert.equal(fixture.entries[index]?.localOffset, fixture.entries[index - 1]?.endOffset);
	}
	assert.equal(fixture.hugePayload.endOffset, fixture.entries[2]?.localOffset);
	assert.equal(fixture.entries[2]?.endOffset, fixture.centralOffset);
	assert.equal(fixture.centralOffset + fixture.centralSize, fixture.zip64EndOffset);
	assert.equal(fixture.zip64EndOffset + 56, fixture.zip64LocatorOffset);
	assert.equal(fixture.zip64LocatorOffset + 20, fixture.classicEndOffset);
	assert.equal(fixture.classicEndOffset + 22, fixture.logicalSize);

	const owner = Object.freeze({ name: 'sparse-scape-renderer' });
	let pinnedHandleCloseCalls = 0;
	const readStore = store = new ReadCapabilityStore({
		openImpl: (async (filePath: string, flags: string) => {
			const handle = await open(filePath, flags);
			setMaxListeners(0, handle as unknown as EventEmitter);
			return {
				stat: () => handle.stat(),
				createReadStream: (options: Parameters<typeof handle.createReadStream>[0]) => (
					handle.createReadStream(options)
				),
				close: async () => {
					pinnedHandleCloseCalls += 1;
					await handle.close();
				},
			};
		}) as unknown as typeof open,
	});
	const descriptor = await readStore.registerScapeRangePath(fixture.path, { owner });
	assert.equal(descriptor.size, fixture.logicalSize);

	const protocol = createProtocolHandler({
		rendererRoot: '/unused-renderer',
		runtimeRoot: '/unused-runtime',
		readCapabilities: readStore,
	});
	const ranges: Array<Readonly<{ start: number; end: number; length: number }>> = [];
	const fetchRange = async (url: string, init: RequestInit = {}): Promise<Response> => {
		assert.equal(init.method, 'GET');
		const header = new Headers(init.headers).get('Range');
		const match = /^bytes=(\d+)-(\d+)$/u.exec(header || '');
		assert.ok(match, 'desktop archive reads use one exact byte range');
		const start = Number(match[1]);
		const end = Number(match[2]);
		const length = end - start + 1;
		assert.ok(length > 0 && length <= MAX_PROTOCOL_RANGE_BYTES);
		const response = await protocol(new Request(url, init));
		assert.equal(response.status, 206);
		assert.equal(response.headers.get('Content-Length'), String(length));
		ranges.push(Object.freeze({ start, end, length }));
		return response;
	};

	let releaseCalls = 0;
	let materializedOpenCalls = 0;
	let importCalls = 0;
	let collisionLookups = 0;
	let decisionCalls = 0;
	const fileService = createAudioEditorFileService({
		bridge: {
			async releaseRead(id: string) {
				releaseCalls += 1;
				assert.equal(id, descriptor.id);
				assert.equal(await readStore.release(id, { owner }), true);
			},
		},
		fetch: fetchRange,
	});
	const projectService = createScapeProjectFileService<SparseScapeInspection, never>({
		lifetime: new EditorControllerLifetime(),
		store: {
			async loadProject(id: string) {
				collisionLookups += 1;
				assert.equal(id, fixture.projectId);
				return Object.freeze({ id });
			},
		},
		productCapabilities: {},
		inspectScapeProject: inspectScapeProject as unknown as ScapeProjectInspector<SparseScapeInspection>,
		openScape: async () => {
			importCalls += 1;
			throw new Error('collision cancellation must precede import');
		},
	});

	const result = await withDesktopProjectReadDescriptor(fileService, descriptor, {
		openMaterialized: async () => {
			materializedOpenCalls += 1;
			throw new Error('the range profile must not materialize the archive');
		},
		openScape: async (source) => projectService.openScapeFile(source, (request) => {
			decisionCalls += 1;
			assert.equal(request.kind, 'collision');
			assert.equal(request.inspected.id, fixture.projectId);
			assert.equal(request.inspected.schemaVersion, AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION);
			assert.equal(request.inspected.manifest.assets[0]?.sha256, fixture.assetSha256);
			return 'cancel';
		}),
	});

	assert.deepEqual(result, { cancelled: true });
	assert.equal(collisionLookups, 1);
	assert.equal(decisionCalls, 1);
	assert.equal(materializedOpenCalls, 0);
	assert.equal(importCalls, 0);
	assert.equal(releaseCalls, 1);
	assert.equal(pinnedHandleCloseCalls, 1);
	assert.equal(readStore.get(descriptor.id), null);
	assert.ok(ranges.length > 0);
	assert.ok(ranges.reduce((total, range) => total + range.length, 0) < MAX_INSPECTION_TRANSFER_BYTES);
	const payloadRanges = ranges.filter((range) => (
		range.start < fixture.hugePayload.endOffset
		&& range.end >= fixture.hugePayload.startOffset
	));
	const payloadBytes = payloadRanges.reduce((total, range) => (
		total + Math.max(0, Math.min(range.end + 1, fixture.hugePayload.endOffset)
			- Math.max(range.start, fixture.hugePayload.startOffset))
	), 0);
	assert.ok(payloadRanges.length > 0, 'the compact production-order tail exercises the ZIP end search');
	assert.ok(payloadBytes <= ZIP_END_SEARCH_BYTES, `only the bounded ZIP end search touches the asset: ${JSON.stringify(ranges)}`);
	assert.ok(payloadRanges.every((range) => (
		Math.max(range.start, fixture.hugePayload.startOffset)
			>= fixture.hugePayload.endOffset - ZIP_END_SEARCH_BYTES
	)), `asset reads remain confined to its final ZIP-search suffix: ${JSON.stringify(ranges)}`);
	assert.equal(payloadRanges.some((range) => range.start <= fixture.hugePayload.startOffset), false);
});
