/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAudiocomLinkUrl } from '../desktop/audiocom-links.ts';

test('desktop audio.com links allow provider pages and precisely displayed Creative Commons deeds', () => {
	for (const url of [
		'https://audio.com/', 'https://audio.com/field-recorder',
		'https://audio.com/field-recorder/audio/garden-rain',
		'https://audio.com/h%C3%B6rspiel/audio/%E9%9B%A8',
		'https://creativecommons.org/publicdomain/zero/1.0/',
		'https://creativecommons.org/licenses/by/4.0/',
		'https://creativecommons.org/licenses/by-nc-sa/4.0/',
	]) assert.equal(assertAudiocomLinkUrl(url), url);
	for (const url of [
		'https://audio.com.evil.example/user/audio/take', 'https://evil.example/',
		'http://audio.com/user/audio/take', 'https://user:password@audio.com/user/audio/take',
		'https://audio.com/auth/authorize?client_id=x', 'https://audio.com/user/audio/take?next=evil',
		'https://audio.com/user/audio/take#fragment',
		'https://audio.com/user/audio/%2fescape', 'https://audio.com/user/audio/%5cescape',
		'https://audio.com/user/audio/%00control', 'https://audio.com/user/audio/%2e%2e',
		'https://audio.com/user/audio/%252e%252e', 'https://audio.com/user/audio/%ZZ', 'https://audio.com/user/audio/take/extra',
		'https://creativecommons.org/', 'https://creativecommons.org/licenses/by-nc-sa/3.0/',
		' https://audio.com/auth/authorize', 'javascript:alert(1)', 'file:///private/file',
	]) assert.throws(() => assertAudiocomLinkUrl(url), /audio.com link/u);
});
