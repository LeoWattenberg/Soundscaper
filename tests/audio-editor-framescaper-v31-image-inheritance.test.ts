/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createClipboardDescriptor,
	preparePasteCommand,
} from '../src/common/editor/commands/clipboard-runtime.js';
import type { AudioEditorCommandPayloads } from '../src/common/editor/commands/protocol.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createEditorProjectRuntimeV31Selection } from '../src/framescaper/editor-project-runtime-v31-selection.ts';
import {
	applyFramescaperProjectCommandV31,
} from '../src/framescaper/editor-project-v31-commands.ts';
import {
	framescaperProjectForRuntimeConsumersV31,
} from '../src/framescaper/editor-project-v31-runtime.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v31.ts';
import {
	reimportFramescaperProjectV31,
	validateFramescaperProjectV31,
} from '../src/framescaper/editor-project-v31.ts';
import { createFramescaperV32ImageFixture } from './helpers/framescaper-v32-image-fixture.ts';

type Store = ReturnType<typeof createProjectStore>;
type ClipboardPasteCommand = Readonly<{
	readonly type: 'clipboard/paste';
} & AudioEditorCommandPayloads['clipboard/paste']>;

test('selected F31 reimports V32 image authority without dropping assistance custody', () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const project = reimportFramescaperProjectV31(
		FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
		fixture.project,
	);

	assert.equal(project.schemaVersion, 31);
	assert.deepEqual(project.assistanceAssets, []);
	assert.deepEqual(records(project.sources).find(({ id }) => id === fixture.source.id), fixture.source);
	assert.deepEqual(records(project.clips).find(({ id }) => id === fixture.clip.id), fixture.clip);
	assert.equal(project.featureRequirements.requirements.some(
		({ featureId }) => featureId === PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
	), true);
	assert.equal(validateFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, project), true);

	const runtime = framescaperProjectForRuntimeConsumersV31(
		FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
		project,
	);
	assert.equal(runtime.schemaVersion, 31);
	assert.equal((runtime.sources as readonly Readonly<Record<string, unknown>>[])
		.some(({ id, kind }) => id === fixture.source.id && kind === 'image'), true);
});

test('selected F31 executes V32 image commands while retaining its own schema', () => {
	const fixture = createFramescaperV32ImageFixture({ imageOnly: true });
	const project = reimportFramescaperProjectV31(
		FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
		fixture.project,
	);
	const track = records(project.tracks).find(({ clipIds }) => (
		Array.isArray(clipIds) && clipIds.includes(fixture.clip.id)
	));
	assert.ok(track);

	const moved = applyFramescaperProjectCommandV31(
		FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
		project,
		{
			type: 'image-clip/set',
			clipId: fixture.clip.id,
			expectedClip: fixture.clip,
			expectedPlacement: { scope: 'timeline', trackId: String(track.id) },
			clip: fixture.clip,
			placement: { scope: 'project-bin' },
		},
		{ now: '2026-08-26T12:00:00.000Z' },
	);

	assert.equal(moved.schemaVersion, 31);
	assert.deepEqual(moved.assistanceAssets, []);
	assert.equal(records(moved.tracks).some(({ clipIds }) => (
		Array.isArray(clipIds) && clipIds.includes(fixture.clip.id)
	)), false);
	assert.equal(records(record(moved.projectBin).clips)
		.some(({ id }) => id === fixture.clip.id), true);
	assert.equal(validateFramescaperProjectV31(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE, moved), true);
});

test('selected F31 copy and paste retains V32 image body ownership', async (context) => {
	const fixture = createFramescaperV32ImageFixture();
	const runtime = createEditorProjectRuntimeV31Selection(FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE);
	const project = reimportFramescaperProjectV31(
		FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
		fixture.project,
	);
	const projected = runtime.projectForEditClipboardConsumers(project);
	const descriptor = createClipboardDescriptor(projected, {
		startFrame: 0,
		endFrame: 240_000,
		trackIds: ['video-track'],
		clipIds: [fixture.clip.id],
	});
	const clipboard = runtime.createEditSessionClipboard(project, descriptor);
	assert.equal(clipboard.schemaVersion, 13);
	assert.deepEqual(clipboard.images.sourceIds, [fixture.source.id]);

	let serial = 0;
	const createId = (prefix = 'id') => `${prefix}-f31-${String(++serial)}`;
	const base = preparePasteCommand(descriptor, {
		project: projected,
		atFrame: 720_000,
		trackMap: { 'video-track': 'video-track' },
		mode: 'overlap',
	}, createId) as ClipboardPasteCommand;
	const prepared = runtime.prepareEditClipboardPaste(project, clipboard, base, createId);
	assert.equal(prepared.bodyTransfers[0]?.mode, 'reuse');

	const store = memoryStore(context);
	await seedImage(store, fixture.source.storageKey, fixture.bytes);
	const staged = await runtime.stageEditClipboardPasteBodies(prepared, store);
	const pasted = runtime.applyCommand(project, prepared.command);
	staged.complete();
	const descriptorKey = String(descriptor.tracks[0]?.clips[0]?.key);
	const pastedId = base.clipIds?.[descriptorKey];
	const clip = records(pasted.clips).find(({ id }) => id === pastedId);
	assert.ok(clip && clip.kind === 'image');
	assert.equal(pasted.schemaVersion, 31);
	assert.deepEqual(pasted.assistanceAssets, []);
});

function memoryStore(context: TestContext): Store {
	const store = createProjectStore({
		indexedDB: null, preferOpfs: false, databaseName: 'framescaper-v31-selected-clipboard',
	});
	context.after(async () => { await store.close(); });
	return store;
}

async function seedImage(store: Store, storageKey: string, bytes: Uint8Array): Promise<void> {
	await store.writeMediaAsset(storageKey, new Blob([Uint8Array.from(bytes).buffer], {
		type: 'application/vnd.framescaper.image-asset',
	}), {
		name: 'image.fsci', kind: 'timeline-image', encoding: 'framescaper-image-asset-v1',
		mimeType: 'application/vnd.framescaper.image-asset',
	});
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value));
	return value as Readonly<Record<string, unknown>>;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	assert.ok(Array.isArray(value));
	return value.map(record);
}
