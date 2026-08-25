/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { copyFutureScapeArchive } from '../src/common/editor/scape-archive-copy.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { applyFramescaperProjectCommandV30 } from '../src/framescaper/editor-project-v30-commands.ts';
import { rebindFramescaperSourceIdentitiesV30 } from '../src/framescaper/editor-project-v30-source-rebind.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import {
	createFramescaperProjectV30,
	validateFramescaperProjectV30,
	type FramescaperProjectV30,
} from '../src/framescaper/editor-project-v30.ts';
import { createFramescaperScapeNativeRuntimeV28 } from '../src/framescaper/editor-scape-native-v28.ts';
import { createFramescaperScapeNativeRuntimeV30 } from '../src/framescaper/editor-scape-native-v30.ts';
import { createFramescaperV30ImageFixture } from './helpers/framescaper-v30-image-fixture.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;
const RUNTIME = createFramescaperScapeNativeRuntimeV30(PROFILE);
type Store = ReturnType<typeof createProjectStore>;

test('selected V30 Scape round-trips the exact semantic image body', async (context) => {
	const fixture = imageOnlyFixture();
	const sender = memoryStore(context, 'roundtrip-sender');
	const recipient = memoryStore(context, 'roundtrip-recipient');
	await seedImage(sender, fixture.source.storageKey, fixture.bytes);

	const exported = await RUNTIME.exportScapeProject(fixture.project, sender);
	assert.ok(exported.blob);
	assert.deepEqual(exported.manifest.assets.map(({ kind }: { kind: string }) => kind), [
		'framescaper-image-asset',
	]);
	const inspected = await RUNTIME.inspectScapeProject(
		exported.blob,
		null,
		{ signal: new AbortController().signal },
		{ retain() {} },
	);
	assert.equal(inspected.schemaVersion, 30);
	assert.equal(inspected.readOnly, false);

	const imported = await RUNTIME.importScapeProject(exported.blob, recipient);
	assert.equal(imported.readOnly, false);
	assert.equal(validateFramescaperProjectV30(PROFILE, imported.project), true);
	assert.deepEqual(await bodyBytes(recipient, fixture.source.storageKey), fixture.bytes);
	assert.equal(RUNTIME.copyScapeArchive, copyFutureScapeArchive);
});

test('selected V30 Scape collision import rekeys image source, clip, storage, and body together', async (context) => {
	const fixture = imageOnlyFixture();
	const sender = memoryStore(context, 'collision-sender');
	const recipient = memoryStore(context, 'collision-recipient');
	await seedImage(sender, fixture.source.storageKey, fixture.bytes);
	await recipient.writeMediaAsset(fixture.source.storageKey, new Blob(['occupied']), {
		name: 'occupied.bin', mimeType: 'application/octet-stream',
	});
	const exported = await RUNTIME.exportScapeProject(fixture.project, sender);
	assert.ok(exported.blob);

	const imported = await RUNTIME.importScapeProject(exported.blob, recipient);
	const project = imported.project as FramescaperProjectV30;
	const source = project.sources.find(({ kind }) => kind === 'image');
	const clip = project.clips.find(({ kind }) => kind === 'image');
	assert.ok(source && source.kind === 'image');
	assert.ok(clip && clip.kind === 'image');
	assert.notEqual(source.id, fixture.source.id);
	assert.equal(source.storageKey, source.id);
	assert.equal(clip.sourceId, source.id);
	assert.deepEqual(await bodyBytes(recipient, source.storageKey), fixture.bytes);
	assert.equal(new TextDecoder().decode(await bodyBytes(recipient, fixture.source.storageKey)), 'occupied');
});

test('V30 source rebind is idempotent across pre-rebound and canonical image state', () => {
	const fixture = imageOnlyFixture();
	const project = structuredClone(fixture.project) as unknown as Record<string, unknown>;
	const clip = records(project.clips).find(({ kind }) => kind === 'image')!;
	const bin = record(project.projectBin);
	bin.clips = [{ ...clip, id: 'image-bin-1' }];
	const mapping = new Map([[fixture.source.id, 'image-source-rebound']]);

	rebindFramescaperSourceIdentitiesV30(project, mapping);
	assert.equal(sourceId(project), 'image-source-rebound');
	assert.equal(storageKey(project), 'image-source-rebound');
	assert.equal(records(project.clips)[0]?.sourceId, 'image-source-rebound');
	assert.equal(records(record(project.projectBin).clips)[0]?.sourceId, 'image-source-rebound');
	rebindFramescaperSourceIdentitiesV30(project, mapping);
	assert.equal(sourceId(project), 'image-source-rebound');
	assert.equal(storageKey(project), 'image-source-rebound');
});

test('choosing a V28 Scape archive is the explicit V30 reimport boundary', async (context) => {
	const v28 = createFramescaperProjectV28(
		FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE,
		sourceFreeOptions(),
	);
	const v28Runtime = createFramescaperScapeNativeRuntimeV28(FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE);
	const sender = memoryStore(context, 'v28-sender');
	const recipient = memoryStore(context, 'v28-recipient');
	const exported = await v28Runtime.exportScapeProject(v28, sender);
	assert.ok(exported.blob);

	const inspected = await RUNTIME.inspectScapeProject(
		exported.blob,
		null,
		{ signal: new AbortController().signal },
		{ retain() {} },
	);
	assert.equal(inspected.schemaVersion, 30);
	assert.equal(inspected.readOnly, false);
	const imported = await RUNTIME.importScapeProject(exported.blob, recipient);
	assert.equal(imported.project.schemaVersion, 30);
	assert.equal(validateFramescaperProjectV30(PROFILE, imported.project), true);
});

function imageOnlyFixture() {
	const image = createFramescaperV30ImageFixture();
	const base = createFramescaperProjectV30(PROFILE, sourceFreeOptions());
	const track = base.tracks.find(({ type }) => type === 'video');
	if (!track) throw new Error('The image-only Scape fixture needs a video track.');
	const clip = { ...image.clip, sequenceId: base.primarySequenceId };
	const project = applyFramescaperProjectCommandV30(PROFILE, base, {
		type: 'batch',
		commands: [{
			type: 'image-source/set', sourceId: image.source.id,
			expectedSource: null, source: image.source,
		}, {
			type: 'image-clip/set', clipId: clip.id,
			expectedClip: null, expectedPlacement: null, clip,
			placement: { scope: 'timeline', trackId: track.id },
		}],
	});
	return { project, source: image.source, clip, bytes: image.bytes };
}

function sourceFreeOptions(): Record<string, unknown> {
	const options = framescaperV20Options();
	options.sources = [];
	options.clips = [];
	options.projectBin = { clips: [] };
	for (const track of options.tracks as Record<string, unknown>[]) track.clipIds = [];
	return options;
}

function memoryStore(context: TestContext, label: string): Store {
	const store = createProjectStore({
		indexedDB: null, preferOpfs: false, databaseName: `framescaper-v30-native-${label}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}

async function seedImage(store: Store, storageKeyValue: string, bytes: Uint8Array): Promise<void> {
	await store.writeMediaAsset(storageKeyValue, new Blob([Uint8Array.from(bytes).buffer], {
		type: 'application/vnd.framescaper.image-asset',
	}), {
		name: 'image.fsci', kind: 'timeline-image', encoding: 'framescaper-image-asset-v1',
		mimeType: 'application/vnd.framescaper.image-asset',
	});
}

async function bodyBytes(store: Store, key: string): Promise<Uint8Array> {
	const body = await store.loadMediaAsset(key);
	if (!body) throw new Error(`Missing body ${key}.`);
	return new Uint8Array(await body.arrayBuffer());
}

function sourceId(project: Record<string, unknown>): unknown {
	return records(project.sources).find(({ kind }) => kind === 'image')?.id;
}

function storageKey(project: Record<string, unknown>): unknown {
	return records(project.sources).find(({ kind }) => kind === 'image')?.storageKey;
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a record.');
	return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError('Expected an array.');
	return value.map(record);
}
