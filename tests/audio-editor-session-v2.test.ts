/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';
import { createAudioEditorSessionControllerV2 } from '../src/common/editor/session-v2.ts';
import { createAudioEditorSessionClipboardV2 } from '../src/common/editor/session-clipboard-codec-v2.ts';
import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';

const key = `lut-sha256:${'ab'.repeat(32)}`;
const project = () => ({ schemaVersion: 1, id: 'origin', title: 'Origin', sampleRate: 48_000,
	sources: [{ id: 'source', storageKey: 'original' }], clips: [], tracks: [] });
function clipboard() {
	return createAudioEditorSessionClipboardV2(project(), { descriptor: { schemaVersion: 7, sampleRate: 48_000, durationFrames: 4800,
		annotations: [], takeGroups: [], tracks: [{ sourceTrackId: 'track', sourceTrackName: 'Video', sourceTrackType: 'video',
			sourceSequenceId: 'main', sourceLaneGroupId: null, clips: [{ key: 'clip', kind: 'video', sourceId: 'source', offsetFrame: 0,
				sourceStartFrame: 0, durationFrames: 4800, sequenceId: 'main', sequenceFrameCount: 1, videoComposition: DEFAULT_VIDEO_CLIP_COMPOSITION,
				videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: { storageKey: key,
					sha256: 'ab'.repeat(32), byteLength: 84, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }] }] }],
	} });
}

test('named session2 owns current clipboard source and disabled LUT roots across origin-tab close, snapshot and clear', () => {
	const session = createAudioEditorSessionControllerV2({ currentSchemaVersion: 1 });
	session.openProject(project()); session.setClipboard(clipboard());
	assert.equal(session.clipboardForProject('origin')!.descriptor.schemaVersion, 7);
	assert.deepEqual([...session.getHistoryStorageKeys()], ['original', key]);
	assert.equal(session.getSourceReferenceCounts().source, 2);
	const closed = session.closeProject('origin', { force: true }); assert.equal(closed.closed, true);
	assert.equal(session.getSourceReferenceCounts().source, 1); assert.deepEqual([...session.getHistoryStorageKeys()], [key]);
	const snapshot = session.serialize(); assert.equal(snapshot.schemaVersion, 2); assert.equal(snapshot.clipboard!.schemaVersion, 2);
	assert.throws(() => createAudioEditorSessionController({ currentSchemaVersion: 1, snapshot }), /schema version/iu);
	const restored = createAudioEditorSessionControllerV2({ currentSchemaVersion: 1, snapshot });
	assert.deepEqual(restored.serialize().clipboard, snapshot.clipboard); assert.deepEqual([...restored.getHistoryStorageKeys()], [key]);
	assert.equal(restored.getSourceReferenceCounts().source, 1);
	assert.deepEqual(restored.clearClipboard().releasedSourceIds, ['source']); assert.deepEqual([...restored.getHistoryStorageKeys()], []);
	assert.deepEqual(restored.getSourceReferenceCounts(), {}); restored.dispose(); session.dispose();
});

test('current session2 preserves old wrapper1 snapshots through an explicit legacy snapshot import and refuses malformed current restoration atomically', () => {
	const old = createAudioEditorSessionController({ currentSchemaVersion: 1 }); old.openProject(project());
	old.setClipboard({ schemaVersion: 1, sampleRate: 48_000, durationFrames: 1, tracks: [] });
	const snapshot = old.serialize();
	const current = createAudioEditorSessionControllerV2({ currentSchemaVersion: 1, snapshot });
	assert.equal(current.serialize().schemaVersion, 2); assert.deepEqual(current.serialize().clipboard, snapshot.clipboard);
	assert.throws(() => current.setClipboard({ ...clipboard(), descriptor: { ...clipboard().descriptor, schemaVersion: 6 } }), /V7/u);
	assert.deepEqual(current.serialize().clipboard, snapshot.clipboard); current.dispose(); old.dispose();
});

test('current session2 keeps an explicitly legacy raw descriptor on its legacy wrapper without promoting its recipe', () => {
	const session = createAudioEditorSessionControllerV2({ currentSchemaVersion: 1 }); session.openProject(project());
	const descriptor = { schemaVersion: 1 as const, sampleRate: 48_000, durationFrames: 1, tracks: [] };
	session.setClipboard(descriptor);
	assert.equal(session.serialize().clipboard!.schemaVersion, 1);
	assert.deepEqual(session.serialize().clipboard!.descriptor, descriptor);
	assert.deepEqual([...session.getHistoryStorageKeys()], ['original']);
	session.dispose();
});
