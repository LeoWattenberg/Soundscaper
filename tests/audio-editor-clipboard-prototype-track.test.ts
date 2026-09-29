/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createClipboardEditService } from '../src/common/editor/controller/edit/internal/clipboard-edit-service.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import type { AudioEditorClipboard } from '../src/common/editor/commands/protocol.ts';

for (const sourceTrackId of ['__proto__', 'constructor', 'toString']) {
	test(`paste creates a target for source track ID ${sourceTrackId}`, () => {
		const clipboard: AudioEditorClipboard = {
			schemaVersion: 2,
			sampleRate: 1_000,
			durationFrames: 20,
			tracks: [{
				sourceTrackId,
				sourceTrackName: 'Imported track',
				sourceTrackType: 'audio',
				clips: [{
					key: 'clip-1', kind: 'audio', sourceId: 'source-1',
					offsetFrame: 0, sourceStartFrame: 0, durationFrames: 20,
				}],
			}],
		};
		const lifetime = new EditorControllerLifetime();
		lifetime.markReady();
		const service = createClipboardEditService({
			lifetime,
			state: { selectedTrackId: null, selectedClipId: null, clipboard },
			copy: { noSilencesFound: 'No silences.', track: 'Track' },
			session: {
				setClipboard: (descriptor) => ({ clipboard: { descriptor, sources: [] } }),
				clipboardForProject: () => ({ descriptor: clipboard, sources: [{ id: 'source-1' }] }),
			},
			sourceBuffers: new Map(),
			getProject: () => ({
				id: 'destination', schemaVersion: 1, sampleRate: 1_000,
				sources: [{ id: 'source-1' }], tracks: [], clips: [],
			}),
			editingBlocked: () => false,
			getPositionFrames: () => 0,
			normalizeFrame: (value) => Number(value),
			snapFrame: (value) => Number(value),
			createId: () => 'track-created',
			commit: () => undefined,
			setStatus: () => undefined,
		});

		const command = service.prepareControllerPaste('overlap', 0);
		assert.equal(command.type, 'batch');
		if (command.type !== 'batch') return;
		assert.deepEqual(command.commands.map(({ type }) => type), ['track/add', 'clipboard/paste']);
		const paste = command.commands[1];
		assert.equal(paste?.type, 'clipboard/paste');
		if (paste?.type === 'clipboard/paste') {
			assert.equal(paste.trackMap?.[sourceTrackId], 'track-created');
		}
	});
}
