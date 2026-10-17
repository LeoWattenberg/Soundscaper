/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAudioEditorClipboardSourceIds, normalizeAudioEditorClipboardDescriptor,
	normalizeAudioEditorSessionClipboard } from '../src/common/editor/session-clipboard-codec.ts';
import { preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

function descriptor() {
	return { schemaVersion: 7, sampleRate: 48_000, durationFrames: 48_000,
		tracks: [], annotations: [], takeGroups: [], labels: [
			{ title: 'Point', color: 'auto', anchor: 'sample', startOffsetFrame: 0, endOffsetFrame: 0,
				opaqueExtensions: { 'example.test': { sourceId: 'opaque-not-a-media-root' } } },
			{ title: 'Region', color: 'blue', anchor: 'musical', startOffsetFrame: 24_000,
				endOffsetFrame: 48_000, opaqueExtensions: {} },
		] };
}

test('label-only V7 normalizes detached metadata and survives the native session wrapper without media roots', () => {
	const input = descriptor();
	const normalized = normalizeAudioEditorClipboardDescriptor(input);
	assert.deepEqual(normalized, input);
	assert.notEqual(normalized, input);
	assert.deepEqual(collectAudioEditorClipboardSourceIds(normalized), []);
	assert.deepEqual(normalizeAudioEditorSessionClipboard({ schemaVersion: 1, originProjectId: 'source-project',
		descriptor: input, sources: [] }), { schemaVersion: 1, originProjectId: 'source-project', descriptor: input, sources: [] });
	assert.throws(() => preparePasteCommand(normalized), /label clipboard/iu,
		'label-only content must use native label commands, never the media paste planner');
});

test('label clipboard admits point-only spans and rejects mixed, disguised and out-of-span payloads', () => {
	const point = { ...descriptor(), durationFrames: 1, labels: [descriptor().labels[0]] };
	assert.deepEqual(normalizeAudioEditorClipboardDescriptor(point), point);
	assert.throws(() => normalizeAudioEditorClipboardDescriptor({ ...descriptor(), extra: true }), /unsupported|exact|field/iu);
	assert.throws(() => normalizeAudioEditorClipboardDescriptor({ ...descriptor(), schemaVersion: 6 }), /unsupported|field/iu);
	assert.throws(() => normalizeAudioEditorClipboardDescriptor({ ...descriptor(), tracks: [{}] }), /label|empty/iu);
	assert.throws(() => normalizeAudioEditorClipboardDescriptor({ ...descriptor(), labels: [{ ...descriptor().labels[0], startOffsetFrame: -1 }] }), /offset/iu);
	assert.throws(() => normalizeAudioEditorClipboardDescriptor({ ...descriptor(), labels: [{ ...descriptor().labels[0], endOffsetFrame: 48_001 }] }), /span|duration/iu);
	let reads = 0;
	const accessor = descriptor();
	Object.defineProperty(accessor.labels[0], 'title', { enumerable: true, get() { reads++; return 'disguised'; } });
	assert.throws(() => normalizeAudioEditorClipboardDescriptor(accessor), /data|accessor/iu);
	assert.equal(reads, 0);
});

test('label clipboard survives native session snapshot reload after its origin tab closes', () => {
	const origin = createCurrentAudioEditorProject({ id: 'label-origin', sampleRate: 48_000 });
	const session = createAudioEditorSessionController({ projects: [origin] });
	session.setClipboard({ schemaVersion: 1, originProjectId: origin.id, descriptor: descriptor(), sources: [] });
	session.closeProject(origin.id, { force: true });
	const restored = createAudioEditorSessionController({ snapshot: JSON.parse(JSON.stringify(session.getSnapshot())) });
	const destination = createCurrentAudioEditorProject({ id: 'label-destination', sampleRate: 24_000 });
	restored.openProject(destination);
	assert.deepEqual(restored.clipboardForProject(destination.id)?.descriptor, descriptor());
	assert.equal(restored.clipboardForProject(destination.id)?.requiresSampleRateConversion, true);
	assert.deepEqual(restored.clipboardForProject(destination.id)?.sources, []);
	assert.deepEqual(restored.getSnapshot().sourceReferenceCounts, {});
	session.dispose();
	restored.dispose();
});
