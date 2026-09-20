/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VAMP_PEER_MAXIMUM_FRAME_BYTES,
	VAMP_PEER_PCM_REQUEST_OVERHEAD_BYTES,
	VAMP_PEER_OPERATION,
	VAMP_PEER_VERSION,
	VampPeerWriter,
	maximumVampPeerPcmFrames,
	splitVampPeerPcmChunkForTransport,
	writeVampAnalyzerPcm,
} from '../desktop/vamp-analyzer-peer-codec.ts';

test('the M5A1 PCM codec reserves framing overhead at the public raw-PCM boundary', () => {
	const channels = Object.freeze(Array.from({ length: 64 }, () => new Float32Array(65_536)));
	const maximumPublicChunk = Object.freeze({
		startFrame: 7,
		frameCount: 65_536,
		channels,
	});

	assert.equal(VAMP_PEER_PCM_REQUEST_OVERHEAD_BYTES, 18);
	assert.equal(maximumVampPeerPcmFrames(channels.length), 65_535);
	const transportChunks = splitVampPeerPcmChunkForTransport(maximumPublicChunk);
	assert.deepEqual(transportChunks.map(({ startFrame, frameCount }) => ({ startFrame, frameCount })), [
		{ startFrame: 7, frameCount: 65_535 },
		{ startFrame: 65_542, frameCount: 1 },
	]);
	assert.equal(transportChunks[0]?.channels[0]?.buffer, channels[0]?.buffer,
		'transport splitting retains zero-copy channel views');

	for (const chunk of transportChunks) {
		const writer = processRequestWriter();
		writeVampAnalyzerPcm(writer, chunk);
		assert.ok(writer.value().byteLength <= VAMP_PEER_MAXIMUM_FRAME_BYTES);
	}
	const oversizedWriter = processRequestWriter();
	assert.throws(() => writeVampAnalyzerPcm(oversizedWriter, maximumPublicChunk), /transport frame/iu);
});

function processRequestWriter(): VampPeerWriter {
	const writer = new VampPeerWriter();
	writer.byte(VAMP_PEER_VERSION);
	writer.byte(VAMP_PEER_OPERATION.process);
	return writer;
}
