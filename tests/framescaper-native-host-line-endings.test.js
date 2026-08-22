/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
	FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST,
	FRAMESCAPER_MEDIA_HOST_ROOT,
	readFramescaperMediaHostSourceManifest,
} from '../scripts/lib/framescaper-media-host-build.mjs';
import {
	FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST,
	FRAMESCAPER_OPENFX_HOST_ROOT,
	readFramescaperOpenFxSourceManifest,
} from '../scripts/lib/framescaper-openfx-host-build.mjs';
import { lineEndingPolicyFindings } from '../scripts/lib/line-ending-policy.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

/**
 * Both Framescaper hosts pin every one of their sources by byte length and SHA-256, so a
 * checkout that rewrites their line endings invalidates the whole closure at once. Windows
 * agents default to `core.autocrlf=true`, which is exactly that rewrite, so the pin is not
 * cosmetic: without it the packaging job on one platform reports hundreds of digest
 * mismatches for sources nobody touched.
 */
test('every digest-pinned Framescaper native input checks out with LF', (context) => {
	if (spawnSync('git', ['-C', repositoryRoot, 'rev-parse', '--git-dir'], {
		encoding: 'utf8',
	}).status !== 0) {
		context.skip('This checkout carries no Git metadata to resolve attributes against.');
		return;
	}
	const pinned = [
		FRAMESCAPER_MEDIA_HOST_PAYLOAD_MANIFEST,
		FRAMESCAPER_OPENFX_PAYLOAD_MANIFEST,
		...readFramescaperMediaHostSourceManifest(repositoryRoot).sourceFiles
			.map(({ path }) => `${FRAMESCAPER_MEDIA_HOST_ROOT}/${path}`),
		...readFramescaperOpenFxSourceManifest(repositoryRoot).sourceFiles
			.map(({ path }) => `${FRAMESCAPER_OPENFX_HOST_ROOT}/${path}`),
	];
	assert.ok(pinned.length > 100, 'the pinned closures did not resolve');
	const resolved = spawnSync('git', ['-C', repositoryRoot, 'check-attr', '--stdin', 'eol'], {
		encoding: 'utf8', input: `${pinned.join('\n')}\n`,
	});
	assert.equal(resolved.status, 0, resolved.stderr);
	const lines = resolved.stdout.split('\n').filter((line) => line !== '');
	assert.equal(lines.length, pinned.length);
	assert.deepEqual(lines.filter((line) => !line.endsWith(': eol: lf')), []);
});

test('the line-ending policy reports each pattern that does not pin LF', (context) => {
	const directory = mkdtempSync(join(tmpdir(), 'framescaper-line-ending-policy-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(join(directory, '.gitattributes'), [
		'/native/framescaper-media-host/** text eol=lf\r',
		'  /config/framescaper-media-host-payload-manifest.json text eol=lf  ',
		'/native/framescaper-openfx-host/** binary',
		'',
	].join('\n'));

	assert.deepEqual(lineEndingPolicyFindings(directory, [
		'/native/framescaper-media-host/**',
		'/config/framescaper-media-host-payload-manifest.json',
	]), []);
	assert.deepEqual(lineEndingPolicyFindings(directory, [
		'/native/framescaper-openfx-host/**',
		'/config/framescaper-openfx-host-payload-manifest.json',
	]), [
		'.gitattributes must pin LF for /native/framescaper-openfx-host/**.',
		'.gitattributes must pin LF for /config/framescaper-openfx-host-payload-manifest.json.',
	]);
});
