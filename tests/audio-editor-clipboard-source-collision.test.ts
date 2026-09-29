/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createClipboardEditService } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { AudioEditorClipboard } from '../src/common/editor/commands/protocol.ts';

const clipboard: AudioEditorClipboard = {
	schemaVersion: 2,
	sampleRate: 48_000,
	durationFrames: 100,
	tracks: [{
		sourceTrackId: 'origin-track',
		sourceTrackName: 'Origin',
		sourceTrackType: 'audio',
		clips: [{ key: 'copied', kind: 'audio', sourceId: 'shared-source', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 100 }],
	}],
};

function pasteWithExistingSource(storageKey: string | undefined, kind = 'audio'): ReturnType<ReturnType<typeof createClipboardEditService>['prepareControllerPaste']> {
	const lifetime = new EditorControllerLifetime();
	lifetime.markReady();
	const service = createClipboardEditService({
		lifetime,
		state: { selectedTrackId: 'target-track', selectedClipId: null, clipboard },
		copy: { noSilencesFound: 'No silences.', track: 'Track' },
		session: {
			setClipboard: (descriptor) => ({ clipboard: { descriptor, sources: [] } }),
			clipboardForProject: () => ({ descriptor: clipboard, sources: [{ id: 'shared-source', kind: 'audio', storageKey: 'origin-media' }] }),
		},
		sourceBuffers: new Map(),
		getProject: () => ({
			id: 'target-project', schemaVersion: 1, sampleRate: 48_000,
			sources: [{ id: 'shared-source', kind, storageKey }],
			tracks: [{ id: 'target-track', name: 'Target', type: 'audio', clipIds: [] }],
			clips: [],
		}),
		editingBlocked: () => false,
		getPositionFrames: () => 0,
		normalizeFrame: (value) => Number(value),
		snapFrame: (value) => Number(value),
		createId: (prefix) => `${prefix}-new`,
		commit: () => undefined,
		setStatus: () => undefined,
	});
	return service.prepareControllerPaste('overlap', 0);
}

test('cross-project paste refuses a reused source ID backed by different media', () => {
	assert.throws(() => pasteWithExistingSource('target-media'), /clipboard source shared-source.*different media/iu);
});

test('cross-project paste reuses a source ID backed by the same media', () => {
	const command = pasteWithExistingSource('origin-media');
	assert.equal(command.type, 'clipboard/paste');
});

test('cross-project paste refuses a reused source ID with a different media kind', () => {
	assert.throws(() => pasteWithExistingSource('origin-media', 'video'), /clipboard source shared-source.*different media/iu);
});

test('cross-project paste refuses a reused source ID when the destination lacks media identity', () => {
	assert.throws(() => pasteWithExistingSource(undefined), /clipboard source shared-source.*different media/iu);
});
