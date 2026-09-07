/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
} from '../src/common/editor/audacity-binary-xml.js';
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js';

type XmlNode = ReturnType<typeof createAudacityXmlNode>;

const importedWaveTrack = () => ({ kind: 'node' as const, node: createAudacityXmlNode('wavetrack') });

const monoSourceProject = (clipIds: readonly string[]) => ({
	id: 'project-1',
	title: 'Formerly stereo',
	sampleRate: 48_000,
	clips: [{
		id: 'clip-1', sourceId: 'source-1', name: 'Mono clip',
		timelineStartFrame: 0, durationFrames: 480, sourceDurationFrames: 480,
	}],
	sources: [{ id: 'source-1', frameCount: 480, channelCount: 1, sampleRate: 48_000 }],
	tracks: [{
		id: 'track-1', kind: 'audio', name: 'Formerly stereo', gain: 1, pan: 0,
		mute: false, solo: false, clipIds: [...clipIds], effects: [],
		// What an AUP4 import leaves behind on a track that arrived as stereo.
		opaqueExtensions: { aup4WaveTracks: [importedWaveTrack(), importedWaveTrack()] },
	}],
	master: { effects: [] },
});

// The export pipeline keys sample blocks per resolved channel, so a track whose
// clips are all mono only ever gets channel-0 blocks registered for it.
const monoChannelBlocks = () => new Map([['source-1:0', [{ blockId: 21, sampleCount: 480 }]]]);

function assertSequencesMatchTheirBlocks(tree: XmlNode) {
	let sequences = 0;
	for (const waveTrack of audacityXmlChildren(tree, 'wavetrack')) {
		for (const waveClip of audacityXmlChildren(waveTrack, 'waveclip')) {
			for (const sequence of audacityXmlChildren(waveClip, 'sequence')) {
				sequences += 1;
				const declared = Number(audacityXmlAttribute(sequence, 'numsamples', 0));
				const stored = audacityXmlChildren(sequence, 'waveblock')
					.reduce((total, block) => total + Number(audacityXmlAttribute(block, 'length', 0)), 0);
				assert.equal(declared, stored, 'a sequence must declare exactly the samples its blocks hold');
			}
		}
	}
	return sequences;
}

test('a track imported as stereo whose clips are now mono exports one wavetrack', () => {
	const tree = createAup4ProjectTree(monoSourceProject(['clip-1']), monoChannelBlocks());

	const waveTracks = audacityXmlChildren(tree, 'wavetrack');
	assert.equal(waveTracks.length, 1, 'the stale imported channel count must not add a blockless channel');
	assert.equal(audacityXmlAttribute(waveTracks[0], 'channel'), 0);
	assert.equal(assertSequencesMatchTheirBlocks(tree), 1);
});

test('an empty track imported as stereo keeps both of its imported channels', () => {
	// The opaque channel count is what a genuinely empty imported stereo track
	// has left to go on, so it still decides the shape when nothing resolves.
	const tree = createAup4ProjectTree(monoSourceProject([]), new Map());

	const waveTracks = audacityXmlChildren(tree, 'wavetrack');
	assert.equal(waveTracks.length, 2);
	assert.deepEqual(waveTracks.map((node) => audacityXmlAttribute(node, 'channel')), [0, 1]);
	assert.equal(assertSequencesMatchTheirBlocks(tree), 0);
});

test('a track imported as stereo whose clip is stereo still exports both channels', () => {
	const project = monoSourceProject(['clip-1']);
	project.sources[0].channelCount = 2;
	const blocks = new Map([
		['source-1:0', [{ blockId: 21, sampleCount: 480 }]],
		['source-1:1', [{ blockId: 22, sampleCount: 480 }]],
	]);

	const tree = createAup4ProjectTree(project, blocks);

	assert.equal(audacityXmlChildren(tree, 'wavetrack').length, 2);
	assert.equal(assertSequencesMatchTheirBlocks(tree), 2);
});

test('a track with no imported channel history exports one wavetrack per mono clip', () => {
	const project = monoSourceProject(['clip-1']);
	delete (project.tracks[0] as { opaqueExtensions?: unknown }).opaqueExtensions;

	const tree = createAup4ProjectTree(project, monoChannelBlocks());

	assert.equal(audacityXmlChildren(tree, 'wavetrack').length, 1);
	assert.equal(assertSequencesMatchTheirBlocks(tree), 1);
});
