/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, Input, OGG, OggOutputFormat, Output, WEBM } from 'mediabunny';
import { createMonoCameraFixture } from '../browser/fixtures/mono-camera-media.js';

let fixtureBytes: Promise<ArrayBuffer> | undefined;

/** Mux the committed ordinary microphone-tone capture's Opus packets into their normal Ogg container. */
export async function ordinaryOggOpusFixture(extension: 'ogg' | 'opus' = 'ogg'): Promise<File> {
	const bytes = await (fixtureBytes ??= createOrdinaryOggOpusBytes());
	return new File([bytes], `Programme.${extension}`, { type: 'audio/ogg; codecs=opus' });
}

async function createOrdinaryOggOpusBytes(): Promise<ArrayBuffer> {
	const camera = createMonoCameraFixture('Microphone.webm');
	const input = new Input({ source: new BlobSource(new Blob([Uint8Array.from(camera.buffer)])), formats: [WEBM] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.ok(track);
		assert.equal(track.codec, 'opus');
		const decoderConfig = await track.getDecoderConfig();
		assert.ok(decoderConfig);
		const target = new BufferTarget();
		const output = new Output({ format: new OggOutputFormat(), target });
		const source = new EncodedAudioPacketSource('opus');
		output.addAudioTrack(source);
		await output.start();
		for await (const packet of new EncodedPacketSink(track).packets()) await source.add(packet, { decoderConfig });
		await output.finalize();
		assert.ok(target.buffer);
		const file = new File([target.buffer], 'Programme.ogg', { type: 'audio/ogg; codecs=opus' });
		const readback = new Input({ source: new BlobSource(file), formats: [OGG] });
		try {
			const audio = await readback.getPrimaryAudioTrack();
			assert.equal(audio?.codec, 'opus');
			assert.equal(audio?.sampleRate, 48_000);
			assert.equal(audio?.numberOfChannels, 1);
			assert.ok(await readback.computeDuration() > 0.5);
		} finally { readback.dispose(); }
		return target.buffer;
	} finally { input.dispose(); }
}
