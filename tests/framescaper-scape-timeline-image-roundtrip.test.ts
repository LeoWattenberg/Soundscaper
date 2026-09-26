/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	BlobReader,
	BlobWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { canonicalMediaContentBlob } from '../src/common/editor/storage/media-content-digest.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { openFramescaperImageFramePackV1 } from
	'../src/common/editor/timeline-image-frame-pack-v1.ts';
import type { FramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import type { FramescaperProject } from '../src/framescaper/editor-project.ts';
import {
	FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_TIMELINE_IMAGE,
	FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_TIMELINE_IMAGE,
} from '../src/framescaper/editor-scape-asset-plan-timeline-image.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createFramescaperBaselineImageFixture } from
	'./helpers/framescaper-baseline-image-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Store = ReturnType<typeof createProjectStore>;
type ProjectImageSource = Extract<FramescaperProject['sources'][number], { readonly kind: 'image' }>;

const FIRST_PIXELS = Object.freeze([255, 16, 32, 255, 0, 0, 0, 0] as const);
const SECOND_PIXELS = Object.freeze([24, 48, 255, 255, 0, 255, 64, 255] as const);
const NOW = '2026-09-27T12:00:00.000Z';

test('timeline-image .scape export and import preserve two authenticated bodies and their pixels', async (context) => {
	const fixture = imageProjectFixture();
	const sender = durableStore(context, 'timeline-image-scape-sender');
	const recipient = durableStore(context, 'timeline-image-scape-recipient');
	await seedImages(sender, fixture.images);

	const runtime = createFramescaperScapeNativeRuntime(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const exported = await runtime.exportScapeProject(fixture.project, sender);
	assert.ok(exported.blob);
	assert.deepEqual(
		exported.manifest.assets
			.filter(({ kind }) => kind === FRAMESCAPER_SCAPE_IMAGE_ASSET_KIND_TIMELINE_IMAGE)
			.map(({ sourceId, sha256, size }) => ({ sourceId, sha256, size })),
		fixture.images.map(({ source }) => ({
			sourceId: `framescaper:image:${source.id}`,
			sha256: source.contentSha256,
			size: source.assetByteLength,
		})),
		'the real image planner binds both bodies into the manifest',
	);

	const imported = await runtime.importScapeProject(exported.blob, recipient);
	assert.equal(imported.readOnly, false);
	const importedProject = imported.project as FramescaperProject;
	assert.deepEqual(
		imageSources(importedProject).map(({ id, contentSha256 }) => ({ id, contentSha256 })),
		fixture.images.map(({ source }) => ({ id: source.id, contentSha256: source.contentSha256 })),
	);

	for (const image of fixture.images) {
		const source = imageSources(importedProject).find(({ id }) => id === image.source.id);
		assert.ok(source);
		const metadata = await recipient.getMediaAssetMetadata(source.storageKey);
		assert.ok(metadata);
		assert.equal(metadata.sha256, source.contentSha256);
		assert.equal(metadata.size, source.assetByteLength);
		const body = canonicalMediaContentBlob(await recipient.loadMediaAsset(source.storageKey));
		assert.deepEqual(
			new Uint8Array(await body.arrayBuffer()),
			image.bytes,
			`stored image body ${source.id} survives the archive round-trip byte-for-byte`,
		);
		const reader = await openFramescaperImageFramePackV1({
			source,
			read: async (offset, length) => new Uint8Array(
				await body.slice(offset, offset + length).arrayBuffer(),
			),
		});
		assert.deepEqual(await reader.readFrame(0), Uint8Array.from(image.pixels));
	}

	assert.deepEqual(await recipient.loadProject(fixture.project.id), importedProject);
});

test('a corrupt second timeline-image body rolls back the first provisional body and project', async (context) => {
	const fixture = imageProjectFixture();
	const sender = durableStore(context, 'timeline-image-scape-corrupt-sender');
	const recipient = durableStore(context, 'timeline-image-scape-corrupt-recipient');
	await seedImages(sender, fixture.images);

	const runtime = createFramescaperScapeNativeRuntime(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const exported = await runtime.exportScapeProject(fixture.project, sender);
	assert.ok(exported.blob);
	const secondDescriptor = exported.manifest.assets.find(({ sourceId }) => (
		sourceId === `framescaper:image:${fixture.images[1]!.source.id}`
	));
	assert.ok(secondDescriptor);
	const corrupt = await corruptArchiveEntry(exported.blob, secondDescriptor.entry);

	await assert.rejects(
		runtime.importScapeProject(corrupt, recipient),
		/digest|SHA-256/iu,
	);
	assert.equal(await recipient.loadProject(fixture.project.id), null);
	assert.deepEqual(await recipient.listProjectRevisions(fixture.project.id), []);
	for (const { source } of fixture.images) {
		assert.equal(
			await recipient.getMediaAssetMetadata(source.storageKey),
			null,
			`failed import leaves no orphaned body for ${source.id}`,
		);
		assert.equal(await recipient.loadMediaAsset(source.storageKey), null);
	}
});

function imageProjectFixture(): Readonly<{
	project: FramescaperProject;
	images: readonly Readonly<{
		source: FramescaperImageSourceV1;
		bytes: Uint8Array;
		pixels: readonly number[];
	}>[];
}> {
	const first = createFramescaperBaselineImageFixture({
		sourceId: 'image-source-one',
		clipId: 'image-clip-one',
		originalText: 'first exact animated image',
		imageOnly: true,
		firstFrameRgba: FIRST_PIXELS,
	});
	const second = createFramescaperBaselineImageFixture({
		sourceId: 'image-source-two',
		clipId: 'image-clip-two',
		originalText: 'second distinct animated image',
		imageOnly: true,
		firstFrameRgba: SECOND_PIXELS,
	});
	const project = applyFramescaperProjectCommand(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		first.project,
		{ type: 'batch', commands: [
			{ type: 'clip/remove', clipId: 'audio-clip' },
			{ type: 'track/remove', trackId: 'audio-track' },
			{ type: 'source/remove', sourceId: 'audio-source' },
			{
				type: 'image-source/set', sourceId: second.source.id,
				expectedSource: null, source: second.source,
			},
			{
				type: 'image-clip/set', clipId: second.clip.id,
				expectedClip: null, expectedPlacement: null,
				clip: { ...second.clip, sequenceStartFrame: first.clip.sequenceFrameCount },
				placement: { scope: 'timeline', trackId: 'video-track' },
			},
		] },
		{ now: NOW },
	);
	assert.notEqual(first.source.contentSha256, second.source.contentSha256);
	return Object.freeze({
		project,
		images: Object.freeze([{
			source: first.source, bytes: first.bytes, pixels: FIRST_PIXELS,
		}, {
			source: second.source, bytes: second.bytes, pixels: SECOND_PIXELS,
		}]),
	});
}

async function seedImages(
	store: Store,
	images: ReturnType<typeof imageProjectFixture>['images'],
): Promise<void> {
	for (const { source, bytes } of images) {
		await store.writeMediaAsset(
			source.storageKey,
			new Blob([Uint8Array.from(bytes).buffer], { type: source.mimeType }),
			{
				name: source.name,
				kind: 'timeline-image',
				encoding: FRAMESCAPER_SCAPE_IMAGE_ASSET_ENCODING_TIMELINE_IMAGE,
				mimeType: source.mimeType,
			},
		);
	}
}

function durableStore(context: TestContext, label: string): Store {
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false,
		databaseName: `${label}-${String(Date.now())}-${String(Math.random())}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}

function imageSources(project: FramescaperProject): ProjectImageSource[] {
	return project.sources.filter((source): source is ProjectImageSource => source.kind === 'image');
}

async function corruptArchiveEntry(archive: Blob, entryName: string): Promise<Blob> {
	const reader = new ZipReader(new BlobReader(archive), { useWebWorkers: false });
	const contents: { readonly filename: string; readonly body: Blob }[] = [];
	let found = false;
	try {
		for (const entry of await reader.getEntries()) {
			if (entry.directory) throw new Error(`Unexpected archive directory ${entry.filename}.`);
			let body = await entry.getData(new BlobWriter());
			if (entry.filename === entryName) {
				const bytes = new Uint8Array(await body.arrayBuffer());
				if (bytes.byteLength < 1) throw new Error('The selected image body is empty.');
				bytes[bytes.byteLength - 1] ^= 0xff;
				body = new Blob([bytes.buffer], { type: body.type });
				found = true;
			}
			contents.push({ filename: entry.filename, body });
		}
	} finally {
		await reader.close();
	}
	if (!found) throw new Error(`Archive entry ${entryName} is missing.`);
	const output = new BlobWriter('application/vnd.soundscaper.scape+zip');
	const writer = new ZipWriter(output, { zip64: true, useWebWorkers: false, level: 0 });
	for (const { filename, body } of contents) {
		await writer.add(filename, body.stream(), { zip64: true, level: 0 });
	}
	return await writer.close(undefined, { zip64: true });
}
