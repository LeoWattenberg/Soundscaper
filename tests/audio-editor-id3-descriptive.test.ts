/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';
import { ID3_DESCRIPTIVE_FIELDS, id3ProjectFieldValue, isId3ProjectTag, projectAudioMetadata, updateId3ProjectField } from '../src/common/editor/id3-descriptive-fields.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';

test('the descriptive catalog covers every ID3v2.4 text and URL frame', () => {
	const expected = 'TALB TBPM TCOM TCON TCOP TDEN TDLY TDOR TDRC TDRL TDTG TENC TEXT TFLT TIPL TIT1 TIT2 TIT3 TKEY TLAN TLEN TMCL TMED TMOO TOAL TOFN TOLY TOPE TOWN TPE1 TPE2 TPE3 TPE4 TPOS TPRO TPUB TRCK TRSN TRSO TSOA TSOP TSOT TSRC TSSE TSST WCOM WCOP WOAF WOAR WOAS WORS WPAY WPUB';
	const actual = ID3_DESCRIPTIVE_FIELDS.map(field => field.frame);
	for (const frame of expected.split(' ')) assert.ok(actual.includes(frame), frame);
	assert.ok(actual.includes('USLT'));
	assert.ok(actual.includes('USER'));
});

test('project ID3 edits share General fields and seed the export without losing extended tags', () => {
	const metadata = { title: 'Before', artist: '', album: '', trackNumber: '', year: '', comments: '', tags: {} };
	Object.assign(metadata, updateId3ProjectField(metadata, 'title', 'After'));
	Object.assign(metadata, updateId3ProjectField(metadata, 'genre', 'Ambient'));
	Object.assign(metadata, updateId3ProjectField(metadata, 'composer', 'Élodie'));
	assert.equal(metadata.title, 'After');
	assert.deepEqual(projectAudioMetadata(metadata), { title: 'After', genre: 'Ambient', composer: 'Élodie' });
	const exportSettings = createExportDialogInitialSettings({ metadata });
	assert.equal(exportSettings.metadataGenre, 'Ambient');
	assert.equal((JSON.parse(exportSettings.metadataCustom) as Record<string, string>).composer, 'Élodie');
});

test('legacy tag aliases appear in standard fields and an edit replaces every spelling', () => {
	const metadata = { title: 'Project title', artist: '', tags: { TITLE: 'Old title', GENRE: 'Ambient', ARTIST: 'Élodie', album_artist: 'Ensemble', custom: 'Kept' } };
	assert.equal(isId3ProjectTag('GENRE'), true);
	assert.equal(id3ProjectFieldValue(metadata, 'genre'), 'Ambient');
	assert.equal(id3ProjectFieldValue(metadata, 'artist'), 'Élodie');
	assert.deepEqual(projectAudioMetadata(metadata), { title: 'Project title', genre: 'Ambient', artist: 'Élodie', albumArtist: 'Ensemble', custom: 'Kept' });
	Object.assign(metadata, updateId3ProjectField(metadata, 'genre', 'Classical'));
	assert.equal(id3ProjectFieldValue(metadata, 'genre'), 'Classical');
	assert.equal(Object.hasOwn(metadata.tags, 'GENRE'), false);
	Object.assign(metadata, updateId3ProjectField(metadata, 'artist', ''));
	assert.equal(id3ProjectFieldValue(metadata, 'artist'), '');
	assert.equal(projectAudioMetadata(metadata).artist, undefined);
	const cleared = { genre: 'Legacy root', tags: { GENRE: 'Legacy tag', genre: '' } };
	assert.equal(id3ProjectFieldValue(cleared, 'genre'), '');
	assert.equal(projectAudioMetadata(cleared).genre, undefined);
	assert.equal(createExportDialogInitialSettings({ metadata: cleared }).metadataGenre, '');
	const frames = readFrames(createAudioMetadataId3Tag(projectAudioMetadata(metadata)));
	assert.equal(new TextDecoder().decode(frames.find(frame => frame.id === 'TCON')!.payload.subarray(1)), 'Classical');
});

test('descriptive fields emit their native frames, language and credit pairs', () => {
	const frames = readFrames(createAudioMetadataId3Tag({
		genre: 'Ambient', albumArtist: 'Ensemble', composer: 'Élodie', discNumber: '2/3',
		artistUrl: 'https://example.org/artist', lyrics: '東京\nSecond line', lyricsLanguage: 'jpn',
		involvedPeople: 'producer=Alice\nengineer=Bob', musicianCredits: 'piano=Carol',
		termsOfUse: 'Personal listening only', commentLanguage: 'deu', comments: 'Notiz',
	}));
	const text = (id: string): string => new TextDecoder().decode(frames.find(frame => frame.id === id)!.payload.subarray(1));
	assert.equal(text('TCON'), 'Ambient');
	assert.equal(text('TPE2'), 'Ensemble');
	assert.equal(text('TCOM'), 'Élodie');
	assert.equal(text('TPOS'), '2/3');
	assert.equal(text('TIPL'), 'producer\0Alice\0engineer\0Bob');
	assert.equal(text('TMCL'), 'piano\0Carol');
	assert.equal(new TextDecoder().decode(frames.find(frame => frame.id === 'WOAR')!.payload), 'https://example.org/artist');
	assert.equal(new TextDecoder().decode(frames.find(frame => frame.id === 'USLT')!.payload), '\u0003jpn\0東京\nSecond line');
	assert.equal(new TextDecoder().decode(frames.find(frame => frame.id === 'COMM')!.payload), '\u0003deu\0Notiz');
	assert.equal(frames.filter(frame => frame.id === 'TXXX').length, 0);
});

test('ownership, offers, timed lyrics, counters and custom URLs use structured ID3 frames', () => {
	const frames = readFrames(createAudioMetadataId3Tag({
		ownershipSeller: 'Élodie', ownershipPrice: 'EUR12.99', ownershipDate: '20261010',
		commercialPrice: 'EUR4.99', commercialValidUntil: '20261231', commercialContactUrl: 'https://example.org/buy',
		commercialReceivedAs: '3', commercialSeller: 'Label', commercialDescription: 'Download',
		synchronizedLyrics: '[00:01.250]Hello\n[00:02.500]World',
		uniqueIdentifier: 'release-1', identifierOwner: 'https://example.org',
		playCount: '1234', rating: '200', ratingEmail: 'listener@example.org', 'url.store': 'https://example.org/store',
	}));
	for (const id of ['OWNE', 'COMR', 'SYLT', 'UFID', 'PCNT', 'POPM', 'WXXX']) assert.ok(frames.some(frame => frame.id === id), id);
	const counter = frames.find(frame => frame.id === 'PCNT')!.payload;
	assert.equal(new DataView(counter.buffer, counter.byteOffset, counter.byteLength).getUint32(0), 1234);
	assert.equal(frames.filter(frame => frame.id === 'TXXX').length, 0);
	assert.throws(() => createAudioMetadataId3Tag({ musicianCredits: 'piano Alice' }), /role=name/u);
	assert.throws(() => createAudioMetadataId3Tag({ ownershipSeller: 'Alice', ownershipPrice: 'EUR1', ownershipDate: '20260230' }), /Invalid ownership/u);
});

test('artwork embeds its literal image bytes and malformed data is refused', () => {
	const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';
	const artwork = [{ mimeType: 'image/png', pictureType: 3, description: '東京 cover', data: image }];
	const frames = readFrames(createAudioMetadataId3Tag({ id3Artwork: JSON.stringify(artwork) }));
	assert.equal(frames.length, 1);
	assert.equal(frames[0]!.id, 'APIC');
	assert.ok(Buffer.from(frames[0]!.payload).includes(Buffer.from(image, 'base64')));
	assert.throws(() => createAudioMetadataId3Tag({ id3Artwork: JSON.stringify([{ ...artwork[0], pictureType: 21 }]) }), /picture type/u);
	assert.throws(() => createAudioMetadataId3Tag({ id3Artwork: JSON.stringify([{ ...artwork[0], data: 'abcd' }]) }), /Artwork/u);
	assert.throws(() => createAudioMetadataId3Tag({ id3Artwork: JSON.stringify([artwork[0], artwork[0]]) }), /unique description/u);
	assert.throws(() => createAudioMetadataId3Tag({ id3Artwork: JSON.stringify([{ ...artwork[0], pictureType: 1 }]) }), /32.*32/u);
});

export function readFrames(tag: Uint8Array): { id: string; payload: Uint8Array }[] {
	const frames = [];
	for (let offset = 10; offset < tag.length;) {
		const length = tag.subarray(offset + 4, offset + 8).reduce((value, byte) => value * 128 + byte, 0);
		frames.push({ id: new TextDecoder().decode(tag.subarray(offset, offset + 4)), payload: tag.subarray(offset + 10, offset + 10 + length) });
		offset += 10 + length;
	}
	return frames;
}
