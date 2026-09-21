/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { professionalPeerLoaderArgumentsValid } from '../desktop/professional-peer-loader-arguments.ts';

test('plugin and Vamp loader preflight admits only an absolute bounded path list', () => {
	assert.equal(professionalPeerLoaderArgumentsValid(['--inhibit-cache', '--library-path', '/usr/lib:/opt/plugins']), true);
	for (const invalid of [
		[], ['--library-path', '/usr/lib'], ['--inhibit-cache', '--library-path', 'relative'],
		['--inhibit-cache', '--library-path', ''], ['--inhibit-cache', '--library-path', '/usr/lib:'],
		['--inhibit-cache', '--library-path', '/usr/lib\0/private'],
		['--inhibit-cache', '--library-path', Array.from({ length: 49 }, () => '/usr/lib').join(':')],
	]) assert.equal(professionalPeerLoaderArgumentsValid(invalid), false);
	assert.equal(professionalPeerLoaderArgumentsValid(['--inhibit-cache', '--library-path', '/usr/lib']), true);
});
