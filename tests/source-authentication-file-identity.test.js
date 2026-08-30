/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	collectExtractedSourceTree,
} from '../native/framescaper-media-host/build/source-authentication.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('source authentication keeps file identities lossless and rejects real hard links', (context) => {
	const source = readFileSync(join(
		repositoryRoot, 'native/framescaper-media-host/build/source-authentication.mjs',
	), 'utf8');
	assert.match(source, /lstatSync\(absolute, \{ bigint: true \}\)/u,
		'Windows file IDs must not be rounded before duplicate detection');
	assert.match(source, /fstatSync\(handle, \{ bigint: true \}\)/u,
		'open-file identity checks must retain lossless Windows file IDs');

	const root = mkdtempSync(join(tmpdir(), 'framescaper-hard-linked-source-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	writeFileSync(join(root, 'actual.h'), 'bytes');
	linkSync(join(root, 'actual.h'), join(root, 'alias.h'));
	assert.throws(() => collectExtractedSourceTree(root), /hard-linked duplicate/u);
});
