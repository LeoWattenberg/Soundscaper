/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, Input, MP4, Mp4OutputFormat, Output } from 'mediabunny';

import { aacSourceMetadata, readAacSourceMetadata } from '../src/common/editor/aac-source-geometry.ts';
import { embedM4aChapters } from '../src/common/editor/m4a-embedded-chapters.ts';
import { encodeWav } from '../src/common/editor/wav.js';

const chapters = [
	{ startFrame: 12_000, endFrame: 24_000, title: '日本語 = #1;\\\r\n' },
	{ startFrame: 24_000, endFrame: 96_000, title: 'Ends in \\' },
];

function atom(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(8 + parts.reduce((size, part) => size + part.length, 0));
	new DataView(bytes.buffer).setUint32(0, bytes.length);
	bytes.set(new TextEncoder().encode(type), 4);
	let offset = 8;
	for (const part of parts) { bytes.set(part, offset); offset += part.length; }
	return bytes;
}

test('M4A chapters reject container limits and malformed files without truncation', async () => {
	const blob = new Blob([atom('ftyp'), atom('moov')]);
	assert.equal(await embedM4aChapters(blob, [], 48_000), blob);
	await assert.rejects(embedM4aChapters(blob, Array.from({ length: 256 }, () => chapters[0]!), 48_000), /255.*chapter|chapter.*255/iu);
	await assert.rejects(embedM4aChapters(blob, [{ ...chapters[0]!, title: 'é'.repeat(128) }], 48_000), /255.*UTF|UTF.*255/iu);
	await assert.rejects(embedM4aChapters(new Blob([Uint8Array.of(1)]), chapters, 48_000), /M4A|MP4/iu);
	await assert.rejects(embedM4aChapters(new Blob([atom('ftyp')]), chapters, 48_000), /moov|movie/iu);
	const truncated = atom('moov');
	new DataView(truncated.buffer).setUint32(0, 100);
	await assert.rejects(embedM4aChapters(new Blob([atom('ftyp'), truncated]), chapters, 48_000), /M4A|MP4/iu);
});

test('M4A metadata changes read box headers and metadata while retaining encoded media as Blob slices', async () => {
	const media = new Uint8Array(2 * 1024 ** 2);
	media.fill(7);
	class BoundedBlob extends Blob {
		readRanges: [number, number][] = [];
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('whole-file reads are forbidden'); }
		override slice(start = 0, end = this.size, contentType?: string): Blob {
			const part = super.slice(start, end, contentType);
			const read = part.arrayBuffer.bind(part);
			part.arrayBuffer = () => {
				this.readRanges.push([start, end]);
				assert.ok(end - start < media.length, 'the audio payload stays in storage');
				return read();
			};
			return part;
		}
	}
	const source = new BoundedBlob([atom('ftyp'), atom('mdat', media), atom('moov', atom('udta', atom('meta', Uint8Array.of(0, 0, 0, 0))))]);
	const output = await embedM4aChapters(source, chapters, 48_000);
	assert.ok(output.size > source.size);
	assert.deepEqual(new Uint8Array(await output.slice(16, 16 + media.length).arrayBuffer()), media);
	assert.ok(source.readRanges.length >= 4);
});

interface Core {
	FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array; unlink(path: string): void };
	exec(...args: string[]): number;
	ffprobe(...args: string[]): number;
	reset(): void;
	setLogger(listener: (entry: { message: string }) => void): void;
}

async function nativeFragments(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
	const input = new Input({ source: new BlobSource(blob), formats: [MP4] });
	try {
		const track = await input.getPrimaryAudioTrack();
		assert.ok(track);
		const decoderConfig = await track.getDecoderConfig();
		assert.ok(decoderConfig);
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }), target });
		const source = new EncodedAudioPacketSource('aac');
		output.addAudioTrack(source);
		output.setMetadataTags({ title: 'Episode', artist: 'Author', raw: { scaf: aacSourceMetadata(48_000, 1, 96_000) } });
		await output.start();
		let origin: number | null = null;
		for await (const packet of new EncodedPacketSink(track).packets()) {
			origin ??= packet.timestamp;
			await source.add(packet.clone({ timestamp: packet.timestamp - origin }), { decoderConfig });
		}
		await output.finalize();
		assert.ok(target.buffer);
		return new Uint8Array(target.buffer);
	} finally { input.dispose(); }
}

test('the shipped FFmpeg reader decodes native M4A chapters without changing audio, tags, or fragment offsets', async () => {
	const previousSelf: unknown = Reflect.get(globalThis, 'self');
	Reflect.set(globalThis, 'self', { location: { href: import.meta.url } });
	try {
		const coreModuleName = '@ffmpeg/core';
		const { default: createCore } = await import(coreModuleName) as { default(options: { wasmBinary: Uint8Array }): Promise<Core> };
		const core = await createCore({ wasmBinary: await readFile(new URL('../node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url)) });
		const pcm = Float32Array.from({ length: 96_000 }, (_, frame) => Math.sin(frame * 2 * Math.PI * 440 / 48_000) * 0.25);
		core.FS.writeFile('mix.wav', encodeWav([pcm], { sampleRate: 48_000, bitDepth: 16, dither: false }));
		for (const mode of ['tail', 'faststart', 'fragmented', 'native-fragments']) {
			const flags = mode === 'faststart' ? ['-movflags', '+faststart']
				: mode === 'fragmented' ? ['-movflags', 'frag_keyframe+empty_moov+default_base_moof'] : [];
			core.reset();
			assert.equal(core.exec('-i', 'mix.wav', '-c:a', 'aac', '-metadata', 'title=Episode', '-metadata', 'artist=Author', ...flags, '-f', 'mp4', 'input.m4a'), 0);
			let original = new Blob([Uint8Array.from(core.FS.readFile('input.m4a'))], { type: 'audio/mp4' });
			if (mode === 'native-fragments') {
				const bytes = await nativeFragments(original);
				core.FS.writeFile('input.m4a', bytes);
				original = new Blob([bytes], { type: 'audio/mp4' });
			}
			const output = await embedM4aChapters(original, chapters, 48_000);
			core.FS.writeFile('output.m4a', new Uint8Array(await output.arrayBuffer()));
			core.reset();
			const logs: string[] = [];
			core.setLogger(({ message }) => logs.push(message));
			core.ffprobe('-v', 'error', '-show_chapters', '-show_format', '-show_streams', '-of', 'json', 'output.m4a');
			const probe = JSON.parse(logs.join('\n')) as {
				chapters: { start_time: string; tags: { title: string } }[];
				format: { tags: { title: string; artist: string } };
				streams: { codec_type: string }[];
			};
			assert.deepEqual(probe.chapters.map((chapter) => chapter.tags.title), chapters.map((chapter) => chapter.title));
			assert.deepEqual(probe.chapters.map((chapter) => Number(chapter.start_time)), [0.25, 0.5]);
			assert.equal(probe.format.tags.title, 'Episode');
			assert.equal(probe.format.tags.artist, 'Author');
			assert.equal(probe.streams.filter((stream) => stream.codec_type === 'audio').length, 1);
			if (mode === 'native-fragments') assert.equal(await readAacSourceMetadata(output), aacSourceMetadata(48_000, 1, 96_000));
			for (const name of ['input', 'output']) {
				core.reset();
				assert.equal(core.exec('-v', 'error', '-i', `${name}.m4a`, '-map', '0:a:0', '-f', 'f32le', `${name}.pcm`), 0);
			}
			assert.deepEqual(core.FS.readFile('output.pcm'), core.FS.readFile('input.pcm'), 'all encoded audio packets still decode identically');
			for (const path of ['input.m4a', 'output.m4a', 'input.pcm', 'output.pcm']) core.FS.unlink(path);
		}
		core.FS.unlink('mix.wav');
	} finally {
		if (previousSelf === undefined) Reflect.deleteProperty(globalThis, 'self');
		else Reflect.set(globalThis, 'self', previousSelf);
	}
});
