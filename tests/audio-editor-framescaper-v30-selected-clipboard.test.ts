/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createClipboardDescriptor,
	preparePasteCommand,
} from '../src/common/editor/commands/clipboard-runtime.js';
import type {
	AudioEditorCommandPayloads,
} from '../src/common/editor/commands/protocol.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createEditorProjectRuntimeV30Selection } from '../src/framescaper/editor-project-runtime-v30-selection.ts';
import { FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v30.ts';
import { createFramescaperV30ImageFixture } from './helpers/framescaper-v30-image-fixture.ts';

const PROFILE = FRAMESCAPER_V30_PROJECT_RUNTIME_PROFILE;
type Store = ReturnType<typeof createProjectStore>;
type ClipboardPasteCommand = Readonly<{
	readonly type: 'clipboard/paste';
} & AudioEditorCommandPayloads['clipboard/paste']>;

test('selected V30 runtime copies and pastes an image through V13 with explicit body ownership', async (context) => {
	const fixture = createFramescaperV30ImageFixture();
	const runtime = createEditorProjectRuntimeV30Selection(PROFILE);
	const projected = runtime.projectForEditClipboardConsumers(fixture.project);
	const descriptor = createClipboardDescriptor(projected, {
		startFrame: 0,
		endFrame: 240_000,
		trackIds: ['video-track'],
		clipIds: [fixture.clip.id],
	});
	assert.equal(descriptor.tracks[0]?.clips[0]?.kind, 'video');
	assert.equal(descriptor.tracks[0]?.clips[0]?.sourceId, fixture.source.id);
	const clipboard = runtime.createEditSessionClipboard(fixture.project, descriptor);
	assert.equal(clipboard.schemaVersion, 13);
	assert.deepEqual(clipboard.images.sourceIds, [fixture.source.id]);
	assert.deepEqual(clipboard.images.clips, [fixture.clip]);

	let serial = 0;
	const createId = (prefix = 'id') => `${prefix}-selected-${String(++serial)}`;
	const base = preparePasteCommand(descriptor, {
		project: projected,
		atFrame: 720_000,
		trackMap: { 'video-track': 'video-track' },
		mode: 'overlap',
	}, createId) as ClipboardPasteCommand;
	const prepared = runtime.prepareEditClipboardPaste(
		fixture.project, clipboard, base, createId,
	);
	assert.deepEqual(prepared.imageSourceIdMap, new Map([[fixture.source.id, fixture.source.id]]));
	assert.equal(prepared.bodyTransfers[0]?.mode, 'reuse');

	const store = memoryStore(context);
	await seedImage(store, fixture.source.storageKey, fixture.bytes);
	const staged = await runtime.stageEditClipboardPasteBodies(prepared, store);
	assert.equal(staged.publicationCount, 0);
	const pasted = runtime.applyCommand(fixture.project, prepared.command);
	staged.complete();
	const descriptorKey = String(descriptor.tracks[0]?.clips[0]?.key);
	const pastedId = base.clipIds?.[descriptorKey];
	const clip = pasted.clips.find(({ id }) => id === pastedId);
	assert.ok(clip && clip.kind === 'image');
	assert.equal(clip.sourceId, fixture.source.id);
	assert.equal(pasted.sources.filter(({ id }) => id === fixture.source.id).length, 1);
	assert.deepEqual(
		runtime.prepareEditClipboardPasteCommand(fixture.project, clipboard, base, createId).type,
		prepared.command.type,
	);
});

function memoryStore(context: TestContext): Store {
	const store = createProjectStore({
		indexedDB: null, preferOpfs: false, databaseName: 'framescaper-v30-selected-clipboard',
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
