/* SPDX-License-Identifier: AGPL-3.0-only */

// SQLite fixtures the AUP4 database suites share: the pinned native schemas each
// test opens, and the helpers that build and read a database through the browser
// codec. Split out of aup4-database.test.js so its suites can sit in separate
// files.

import { createHash } from 'node:crypto';
import initSqlJs from 'sql.js';
import {
	audacityXmlChildren,
	createAudacityXmlNode,
	encodeAudacityBinaryXml,
} from '../../src/common/editor/audacity-binary-xml.js';
import {
	AUP4_BINARY_XML_VERSION,
	createAup4ProjectTree,
} from '../../src/common/editor/aup4-profile.js';

export const SQL = await initSqlJs();

export function documentBytes(rate, version = AUP4_BINARY_XML_VERSION) {
	return encodeAudacityBinaryXml(createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'xmlns', type: 'string', value: 'http://audacity.sourceforge.net/xml/' },
		{ kind: 'attribute', name: 'version', type: 'string', value: version },
		{ kind: 'attribute', name: 'audacityversion', type: 'string', value: '4.0.0' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: rate, digits: -1 },
	]));
}

export function projectWithBlocks(blockId, sampleCount) {
	return encodeAudacityBinaryXml(projectTreeWithBlocks([{ blockId, start: 0, sampleCount }]));
}

export function projectTreeWithBlocks(blocks) {
	const sampleCount = blocks.reduce((total, block) => total + block.sampleCount, 0);
	return createAup4ProjectTree({
		id: 'project',
		sampleRate: 44_100,
		selection: {},
		metadata: {},
		clips: [{
			id: 'clip', sourceId: 'source', title: 'Audio', timelineStartFrame: 0,
			durationFrames: sampleCount, sourceDurationFrames: sampleCount,
		}],
		tracks: [{
			id: 'track', type: 'audio', name: 'Audio', clipIds: ['clip'], effects: [],
		}],
		sources: [{ id: 'source', frameCount: sampleCount, channelCount: 1, sampleRate: 44_100 }],
		master: { effects: [] },
	}, new Map([['source:0', blocks]]));
}

export function firstSequence(tree) {
	return audacityXmlChildren(audacityXmlChildren(audacityXmlChildren(tree, 'wavetrack')[0], 'waveclip')[0], 'sequence')[0];
}

export function firstWaveBlock(tree) {
	return audacityXmlChildren(firstSequence(tree), 'waveblock')[0];
}

export function portableClipState(clip) {
	return {
		title: clip.title,
		timelineStartFrame: clip.timelineStartFrame,
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		durationFrames: clip.durationFrames,
		groupId: clip.groupId,
		pitchCents: clip.pitchCents,
		speedRatio: clip.speedRatio,
		stretchToTempo: clip.stretchToTempo,
	};
}

export function channelHash(channel) {
	return createHash('sha256')
		.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength))
		.digest('hex');
}

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}
