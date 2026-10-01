/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodedUrlPath,
	normalizedInstalledPath,
	origin,
	sourceLineLengths,
} from '../scripts/lib/e2e-coverage-identity-source.mjs';

test('coverage installed identity preserves Windows UNC and drive spelling', () => {
	for (const [value, platform, expected] of [
		['', 'linux', ''],
		['/', 'linux', ''],
		['//root///app/', 'linux', '/root/app'],
		['\\\\Server\\share\\app\\', 'win32', '//Server/share/app'],
		['///Server//share/', 'win32', '//Server/share'],
		['/C:/Program Files/App/', 'win32', 'C:/Program Files/App'],
		['C:\\Program Files\\App\\', 'win32', 'C:/Program Files/App'],
		['/c:/app/', 'linux', '/c:/app'],
		['C:/App/../resource', 'win32', 'C:/App/../resource'],
	]) {
		assert.equal(normalizedInstalledPath(value, platform), expected);
	}
});

test('coverage decoded URLs preserve decoding order and refuse malformed escapes', () => {
	assert.equal(decodedUrlPath('file:///C:/Program%20Files/app.js'), 'C:/Program Files/app.js');
	assert.equal(decodedUrlPath('https://example.org/%5C%5Cresource%2Ffile.js?q=ignored'), 'resource/file.js');
	assert.throws(() => decodedUrlPath('not a URL'), TypeError);
	assert.throws(() => decodedUrlPath('file:///bad%escape'), URIError);
	assert.equal(origin('not a URL'), null);
	assert.equal(origin('file:///path.js'), 'null');
	assert.equal(origin('https://example.org:443/path'), 'https://example.org');
});

test('coverage line lengths preserve CRLF bytes and remove only one trailing empty line', () => {
	assert.deepEqual(sourceLineLengths(''), [0]);
	assert.deepEqual(sourceLineLengths('a\r\nb\r\n'), [2, 2]);
	assert.deepEqual(sourceLineLengths('a\n\n'), [1, 0]);
	assert.deepEqual(sourceLineLengths('\ud83d\ude00\n'), [2]);
	assert.deepEqual(sourceLineLengths(12), [2]);
	assert.deepEqual(sourceLineLengths(null), [4]);
});
