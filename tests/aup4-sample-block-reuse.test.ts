/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAup4SnapshotWrites } from '../src/common/editor/aup4-worker-snapshot.js';
import { initializeAup3Database, prepareAup3PortableExport } from '../src/common/editor/aup3-database.ts';
import { initializeAup4Database, prepareAup4PortableExport } from '../src/common/editor/aup4-database.js';
import { createAudacityXmlNode, audacityXmlChildren, audacityXmlAttribute } from '../src/common/editor/audacity-binary-xml.js';
import { SQL } from './helpers/aup4-database-harness.js';
import { createAudacitySampleBlockReuse } from '../src/common/editor/audacity-sample-block-reuse.ts';

type XmlNode = Parameters<typeof audacityXmlAttribute>[0];
const children = audacityXmlChildren as unknown as (node: XmlNode, name: string) => XmlNode[];

function sequence(ids: readonly number[]) {
	return { kind: 'node', node: createAudacityXmlNode('sequence', [
		{ kind: 'attribute', name: 'numsamples', type: 'int', value: ids.length * 3 },
	], ids.map((id, index) => ({ kind: 'node', node: createAudacityXmlNode('waveblock', [
		{ kind: 'attribute', name: 'start', type: 'int', value: index * 3 },
		{ kind: 'attribute', name: 'blockid', type: 'int', value: id },
	]) }))) };
}

test('reuse checks exact bytes and only indexes committed rows', () => {
	const committed = new Map<string, number[]>();
	const row = { sampleformat: 0x0004000f, samples: Uint8Array.of(1, 2, 3, 4) };
	const staged = createAudacitySampleBlockReuse(committed, () => row);
	assert.deepEqual(staged.write(row, () => 1), { blockId: 1, inserted: true });
	assert.equal(committed.size, 0);
	assert.deepEqual(staged.write(row, () => assert.fail('duplicate insertion')), { blockId: 1, inserted: false });
	staged.commit();
	const collision = createAudacitySampleBlockReuse(committed, () => ({ ...row, samples: Uint8Array.of(4, 3, 2, 1) }));
	assert.deepEqual(collision.write(row, () => 2), { blockId: 2, inserted: true });
});

for (const generation of ['aup3', 'aup4']) {
	test(`${generation} saves reordered shared blocks once and keeps their original boundaries`, () => {
		const database = new SQL.Database();
		try {
			if (generation === 'aup3') initializeAup3Database(database);
			else initializeAup4Database(database);
			const entry = { projectId: 'shared-blocks', database, pool: null, targetGeneration: generation };
			const snapshots = createAup4SnapshotWrites({ requireWritableProject: () => entry });
			const sources = ['one', 'two'].map((id, index) => ({ id, frameCount: 6, channelCount: 1, sampleRate: 48_000,
				opaqueExtensions: { aup4ChannelSequences: [sequence(index ? [2, 1] : [1, 2])] },
			}));
			const project = { id: 'project', title: 'Shared', sampleRate: 48_000, selection: {}, metadata: {},
				sources, clips: sources.map((source, index) => ({ id: `clip-${source.id}`, sourceId: source.id,
					timelineStartFrame: index * 6, sourceStartFrame: 0, durationFrames: 6, sourceDurationFrames: 6 })),
				tracks: [{ id: 'track', type: 'audio', clipIds: sources.map((source) => `clip-${source.id}`) }], master: { effects: [] } };
			const context = { id: 'request', checkCancelled() {}, progress() {} };
			const begun = snapshots.begin({ projectId: entry.projectId, project, autosave: false }, context);
			for (const [index, source] of sources.entries()) snapshots.appendSource({ projectId: entry.projectId,
				snapshotId: begun.snapshotId, source: { sourceId: source.id, sampleRate: 48_000,
					channels: [Float32Array.from(index ? [4, 5, 6, 1, 2, 3] : [1, 2, 3, 4, 5, 6])] } }, context);
			snapshots.finalize({ projectId: entry.projectId, snapshotId: begun.snapshotId }, context);
			assert.equal(database.exec('SELECT COUNT(*) FROM sampleblocks')[0]?.values[0]?.[0], 2);
			const validation = generation === 'aup3' ? prepareAup3PortableExport(database) : prepareAup4PortableExport(database);
			assert.ok(validation.document);
			const clips = children(children(validation.document.root, 'wavetrack')[0], 'waveclip');
			const blocks = clips.map((clip) => children(children(clip, 'sequence')[0], 'waveblock')
				.map((block) => audacityXmlAttribute(block, 'blockid')));
			assert.equal(blocks[0]?.length, 2);
			assert.deepEqual(blocks[1], [...blocks[0]!].reverse());
			const repeated = snapshots.begin({ projectId: entry.projectId, project, autosave: false }, { ...context, id: 'repeat' });
			for (const [index, source] of sources.entries()) snapshots.appendSource({ projectId: entry.projectId,
				snapshotId: repeated.snapshotId, source: { sourceId: source.id, sampleRate: 48_000,
					channels: [Float32Array.from(index ? [4, 5, 6, 1, 2, 3] : [1, 2, 3, 4, 5, 6])] } }, context);
			snapshots.finalize({ projectId: entry.projectId, snapshotId: repeated.snapshotId }, context);
			assert.equal(database.exec('SELECT COUNT(*) FROM sampleblocks')[0]?.values[0]?.[0], 2);
		} finally { database.close(); }
	});
}
