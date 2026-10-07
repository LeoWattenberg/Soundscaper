/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';

for (const kind of ['group', 'send'] as const) {
	test(`decoded ${kind} buses and their authored track edges survive baseline import`, () => {
		const source = createAudioSource({ id: 'recording', frameCount: 48_000, channelCount: 1 });
		const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000 });
		const bus = { id: 'bus', name: 'Authored bus', gain: 0.5, pan: -0.25, mute: false, solo: false };
		const decoded = createAudioEditorProjectV17({ sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })],
			mixer: { groups: kind === 'group' ? [bus] : [], sends: kind === 'send' ? [bus] : [],
				routes: { voice: { groupId: kind === 'group' ? bus.id : null, sends: kind === 'send' ? { bus: 0.3 } : {} } } },
		});
		const original = structuredClone(decoded);
		const imported = importSoundscaperAudacityProject(decoded);
		const buses = kind === 'group' ? imported.mixer.groups : imported.mixer.sends;
		assert.equal(buses.length, 1);
		assert.deepEqual([buses[0]!.id, buses[0]!.name, buses[0]!.gain, buses[0]!.pan], ['bus', 'Authored bus', 0.5, -0.25]);
		const edge = imported.mixer.edges.find(value => value.source.kind === 'track'
			&& value.source.id === 'voice' && value.destination.kind === 'mixer-node');
		assert.ok(edge);
		assert.equal(edge.kind, kind === 'group' ? 'assignment' : 'send');
		assert.deepEqual(edge.destination, { kind: 'mixer-node', id: 'bus' });
		assert.equal(edge.level, kind === 'group' ? 1 : 0.3);
		assert.deepEqual(edge.channelMap, [0, 0]);
		assert.ok(imported.mixer.edges.some(value => value.source.kind === 'mixer-node'
			&& value.source.id === 'bus' && value.destination.kind === 'master'));
		assert.deepEqual(decoded, original);
	});
}

test('a folder-owned bus retains its decoded fader and uses one existing folder identity', () => {
	const decoded = createAudioEditorProjectV17({
		tracks: [createAudioTrack({ id: 'voice' })], trackFolders: [{ id: 'folder', name: 'Band' }],
		sequences: [{ id: 'main-sequence', trackNodes: [
			{ kind: 'folder', id: 'folder', parentFolderId: null }, { kind: 'track', id: 'voice', parentFolderId: 'folder' },
		] }],
		mixer: { groups: [{ id: 'folder', name: 'Band', gain: 0.7, pan: 0, mute: false, solo: false }], sends: [],
			routes: { voice: { groupId: 'folder', sends: {} } } },
	});
	const imported = importSoundscaperAudacityProject(decoded);
	assert.deepEqual(imported.mixer.groups.map(bus => [bus.id, bus.gain]), [['folder', 0.7]]);
	assert.deepEqual(imported.trackFolders.map(folder => folder.id), ['folder']);
	assert.deepEqual(imported.mixer.edges.find(value => value.source.kind === 'track'
		&& value.source.id === 'voice')?.destination, { kind: 'mixer-node', id: 'folder' });
});
