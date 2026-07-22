import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeAuBlockFile, decodeLegacyAupProject } from '../src/common/editor/aup-legacy.js';

test('legacy AUP import decodes AU blocks into structured tracks and labels', async () => {
	const block = auFloatBlock([0, 0.5, -0.5, 1], 44_100);
	const xml = `<?xml version="1.0"?>
		<project rate="44100" projname="Legacy.aup" sel0="0" sel1="1">
			<wavetrack name="Voice" channel="2" rate="44100">
				<waveclip offset="1"><sequence numsamples="4"><waveblock start="0"><simpleblockfile filename="e0000.au" len="4"/></waveblock></sequence></waveclip>
			</wavetrack>
			<labeltrack name="Markers"><label t="1" t1="2" title="Chorus"/></labeltrack>
		</project>`;
	const decoded = await decodeLegacyAupProject(
		{ name: 'Legacy.aup', text: async () => xml },
		[{ name: 'e0000.au', webkitRelativePath: 'Legacy_data/e00/d00/e0000.au', arrayBuffer: async () => block.buffer.slice(0) }],
	);
	assert.equal(decoded.sampleRate, 44_100);
	assert.equal(decoded.tracks.length, 2);
	assert.deepEqual([...decoded.tracks[0].clips[0].channels[0]], [0, 0.5, -0.5, 1]);
	assert.equal(decoded.tracks[1].labels[0].title, 'Chorus');
	assert.equal(decoded.metadata.title, 'Legacy');
});

test('legacy AUP import reports missing and corrupt block files explicitly', async () => {
	const xml = '<project rate="44100"><wavetrack><waveclip><sequence><waveblock><simpleblockfile filename="missing.au" len="4"/></waveblock></sequence></waveclip></wavetrack></project>';
	await assert.rejects(
		decodeLegacyAupProject({ name: 'broken.aup', text: async () => xml }, []),
		(error) => error.code === 'MISSING_BLOCK_FILES' && error.details.filenames[0] === 'missing.au',
	);
	assert.throws(() => decodeAuBlockFile(new Uint8Array(24)), (error) => error.code === 'CORRUPT_BLOCK_FILE');
});

function auFloatBlock(samples, sampleRate) {
	const bytes = new Uint8Array(24 + samples.length * 4);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x2e736e64, false);
	view.setUint32(4, 24, false);
	view.setUint32(8, samples.length * 4, false);
	view.setUint32(12, 6, false);
	view.setUint32(16, sampleRate, false);
	view.setUint32(20, 1, false);
	for (let index = 0; index < samples.length; index += 1) view.setFloat32(24 + index * 4, samples[index], false);
	return bytes;
}
