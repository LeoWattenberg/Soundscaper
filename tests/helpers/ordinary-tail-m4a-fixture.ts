/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny';
import { aacLcM4a44_100Fixture } from './os-audio-codec-fixtures.ts';

/** Author a normal longer AAC programme, retaining its encoder's ordinary packets. */
export async function ordinaryTailM4aFixture(fastStart: false | 'in-memory' = false): Promise<File> {
	const input = new Input({ source: new BlobSource(new Blob([Uint8Array.from(aacLcM4a44_100Fixture())])), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.ok(track);
		const decoderConfig = await track.getDecoderConfig();
		assert.ok(decoderConfig);
		const packet = await new EncodedPacketSink(track).getPacket(0);
		assert.ok(packet);
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat({ fastStart }), target });
		const source = new EncodedAudioPacketSource('aac');
		output.addAudioTrack(source);
		await output.start();
		for (let index = 0; index < 4_000; index += 1) {
			await source.add(packet.clone({ timestamp: index * 1024 / 44_100, duration: 1024 / 44_100 }), { decoderConfig });
		}
		await output.finalize();
		assert.ok(target.buffer);
		assert.ok(target.buffer.byteLength > 1024 ** 2);
		return new File([target.buffer], 'Programme.m4a', { type: 'audio/mp4' });
	} finally { input.dispose(); }
}
