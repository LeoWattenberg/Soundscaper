/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { createAup4ProjectTree, createAup4SampleBlock } from '../src/common/editor/aup4-profile.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

function tree() {
	const source = createAudioSource({ id: 'source', name: 'Audio', frameCount: 4, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceDurationFrames: 4, durationFrames: 4 });
	const track = createAudioTrack({ id: 'track', name: 'Audio', clipIds: [clip.id] });
	const project = createCurrentAudioEditorProject({ sampleRate: 48_000, sources: [source], clips: [clip], tracks: [track] });
	return createAup4ProjectTree(project, new Map([['source:0', [{ blockId: 1, start: 0, sampleCount: 4 }]]]));
}

for (const accept of [false, true]) test(`Audacity decoded PCM size warning ${accept ? 'admits' : 'cancels'} oversized buffered decoding`, async () => {
	let loads = 0;
	const warnings: number[] = [];
	const decode = decodeAudacityProjectTree(tree(), async () => { loads += 1; return createAup4SampleBlock(Float32Array.of(0, 0.25, 0.5, 1)); }, {
		maxDecodedBytes: 8, confirmFileSizeWarning: async (warning: { byteLength: number }) => { warnings.push(warning.byteLength); return accept; },
	});
	if (accept) assert.equal((await decode).sources[0]?.channels?.[0]?.length, 4);
	else await assert.rejects(decode, { name: 'AbortError' });
	assert.deepEqual(warnings, [16]);
	assert.equal(loads, accept ? 1 : 0);
});
