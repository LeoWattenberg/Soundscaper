/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityXmlNode } from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';

test('a lone AUP3 wavetrack gain remains volume rather than spectrogram gain', async () => {
	const root = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000 },
	], [{ kind: 'node', node: createAudacityXmlNode('wavetrack', [
		{ kind: 'attribute', name: 'name', type: 'string', value: 'Classic track' },
		{ kind: 'attribute', name: 'rate', type: 'double', value: 48_000 },
		{ kind: 'attribute', name: 'gain', type: 'double', value: 0.5 },
	]) }]);
	let nextId = 0;
	const decoded = await decodeAudacityProjectTree(root, async () => null, {
		sourceGeneration: 'aup3',
		idFactory: (prefix) => `${prefix}-${String(++nextId)}`,
	});
	const track = decoded.project.tracks.find((candidate) => candidate.type === 'audio');
	assert.equal(track.gain, 0.5);
	assert.equal(track.spectrogram.gain, 20);
});
