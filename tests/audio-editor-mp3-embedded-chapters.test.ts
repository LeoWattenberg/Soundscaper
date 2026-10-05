/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmbeddedMp3ChapterTag, embedAudioChapters } from '../src/common/editor/audio-embedded-chapter-container.ts';

function synchsafe(bytes: Uint8Array, offset: number): number {
	return bytes.subarray(offset, offset + 4).reduce((value, byte) => value * 128 + byte, 0);
}

function frames(tag: Uint8Array) {
	const result: { id: string; payload: Uint8Array }[] = [];
	for (let offset = 10; offset < tag.length;) {
		const size = synchsafe(tag, offset + 4);
		result.push({ id: new TextDecoder().decode(tag.subarray(offset, offset + 4)), payload: tag.subarray(offset + 10, offset + 10 + size) });
		offset += 10 + size;
	}
	return result;
}

test('native MP3 chapters write ID3 CHAP frames with literal UTF-8 titles and millisecond bounds', () => {
	const chapters = [
		{ startFrame: 0, endFrame: 24_000, title: 'Intro 日本語 \\' },
		{ startFrame: 24_000, endFrame: 48_000, title: 'Line\r\nTwo' },
	];
	const tag = createEmbeddedMp3ChapterTag(chapters, 48_000);
	assert.equal(new TextDecoder().decode(tag.subarray(0, 3)), 'ID3');
	assert.equal(tag[3], 4);
	assert.equal(synchsafe(tag, 6), tag.length - 10);
	const actual = frames(tag);
	assert.deepEqual(actual.map(({ id }) => id), ['CTOC', 'CHAP', 'CHAP']);
	for (const [index, chapter] of actual.filter(({ id }) => id === 'CHAP').entries()) {
		const offset = chapter.payload.indexOf(0) + 1;
		const view = new DataView(chapter.payload.buffer, chapter.payload.byteOffset, chapter.payload.byteLength);
		assert.equal(view.getUint32(offset), index * 500);
		assert.equal(view.getUint32(offset + 4), (index + 1) * 500);
		assert.equal(view.getUint32(offset + 8), 0xffff_ffff);
		assert.equal(view.getUint32(offset + 12), 0xffff_ffff);
		assert.equal(new TextDecoder().decode(chapter.payload.subarray(offset + 16, offset + 20)), 'TIT2');
		assert.equal(new TextDecoder().decode(chapter.payload.subarray(offset + 27)), chapters[index]!.title);
	}
});

test('MP3 tables of contents support more than 255 labels with ordered nested nodes', () => {
	const chapters = Array.from({ length: 300 }, (_, index) => ({ startFrame: index * 48_000, endFrame: (index + 1) * 48_000, title: String(index) }));
	const actual = frames(createEmbeddedMp3ChapterTag(chapters, 48_000));
	assert.equal(actual.filter(({ id }) => id === 'CHAP').length, 300);
	const contents = actual.filter(({ id }) => id === 'CTOC');
	assert.equal(contents.length, 3);
	assert.equal(contents.filter(({ payload }) => payload[payload.indexOf(0) + 1]! & 2).length, 1);
	assert.equal(contents.every(({ payload }) => payload[payload.indexOf(0) + 1]! & 1), true);
	const children = contents.map(({ payload }) => payload[payload.indexOf(0) + 2]);
	assert.deepEqual(children, [2, 255, 45]);
});

test('chapter decoration keeps encoded MP3 bytes intact and ordinary exports unchanged', async () => {
	const audio = new Blob([Uint8Array.of(0xff, 0xfb, 10, 20)], { type: 'audio/mpeg' });
	assert.equal(await embedAudioChapters(audio, 'mp3', [], 48_000), audio);
	const chapters = [{ startFrame: 0, endFrame: 48_000, title: '' }];
	const tag = createEmbeddedMp3ChapterTag(chapters, 48_000);
	const decorated = await embedAudioChapters(audio, 'mp3', chapters, 48_000);
	assert.equal(decorated.type, audio.type);
	assert.equal(decorated.size, audio.size + tag.length);
	assert.deepEqual(new Uint8Array(await decorated.slice(tag.length).arrayBuffer()), new Uint8Array(await audio.arrayBuffer()));
	await assert.rejects(embedAudioChapters(audio, 'flac', chapters, 48_000), /chapter/iu);
	assert.throws(() => createEmbeddedMp3ChapterTag([{ startFrame: 0, endFrame: 4_294_967_295 * 48, title: 'Too long' }], 48_000), /timestamp/iu);
});
