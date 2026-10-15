/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAudio, parseUploadInput, trustedAssetUrl } from '../functions/api/audiocom/_shared/contracts.ts';

const audio = {
	id: '164620711711840702', title: 'Guitar', username: 'recorder', author_name: 'Recorder',
	slug: 'guitar', description: 'A guitar', license: 'cc-by', is_downloadable: true,
	play: { duration: 23241, url: 'https://s3.audio.com/audio/123.mp3', waveform: '' },
};
test('audio.com normalizes millisecond duration and proxies approved public playback', () => {
	const result = normalizeAudio(audio);
	assert.equal(result.durationSeconds, 23.241);
	assert.equal(result.url, 'https://audio.com/recorder/audio/guitar');
	assert.equal(result.previewUrl, '/api/audiocom/preview?url=https%3A%2F%2Fs3.audio.com%2Faudio%2F123.mp3');
	assert.equal(result.id, '164620711711840702');
});
test('audio.com does not invent playback for processing audio', () => {
	assert.equal(normalizeAudio({ ...audio, play: { duration: 0, url: '', waveform: '' } }).previewUrl, undefined);
});
test('audio.com rejects unknown licenses and unsafe playback destinations', () => {
	assert.throws(() => normalizeAudio({ ...audio, license: 'invented' }));
	for (const url of ['http://s3.audio.com/audio/123', 'https://evil.test/audio/123', 'https://s3.audio.com/private', 'https://s3.audio.com:8443/audio/123', 'https://x:s@s3.audio.com/audio/123']) {
		assert.throws(() => trustedAssetUrl(url));
	}
});
test('audio.com upload parsing enforces metadata, exact size, and supported source formats', () => {
	const request = new Request('https://soundscaper.org/api/audiocom/uploads?title=Guitar&category=music&description=Test&license=arr&listed=0&downloadable=1', {
		method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Audiocom-Filename': 'guitar.wav', 'X-Audiocom-Content-Length': '4' }, body: new Uint8Array(4),
	});
	assert.deepEqual(parseUploadInput(request), { title: 'Guitar', category: 'music', description: 'Test', license: 'arr', is_listed: false, is_downloadable: true, mime: 'audio/wav', name: 'guitar.wav', size: 4 });
	assert.throws(() => parseUploadInput(new Request(request.url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Audiocom-Filename': 'project.aup3', 'X-Audiocom-Content-Length': '4' }, body: new Uint8Array(4) })));
});

test('audio.com upload refuses oversized, duplicate metadata and mismatched length before network activity', () => {
	for (const [query, length, declared] of [['title=T&category=music&title=Other', '4', null], ['title=T&category=music', '100000001', null], ['title=T&category=music', '4', '3']] as const) {
		const headers = new Headers({ 'Content-Type': 'audio/wav', 'X-Audiocom-Filename': 'test.wav', 'X-Audiocom-Content-Length': length });
		if (declared) headers.set('Content-Length', declared);
		assert.throws(() => parseUploadInput(new Request(`https://soundscaper.org/api/audiocom/uploads?${query}`, { method: 'POST', headers, body: new Uint8Array(4) })));
	}
});
