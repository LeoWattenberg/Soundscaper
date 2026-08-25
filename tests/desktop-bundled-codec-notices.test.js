/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_BUNDLED_CODEC_NOTICE_FILES,
	stageDesktopBundledCodecNotices,
} from '../scripts/lib/desktop-bundled-codec-notices.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

const EXPECTED_DESTINATIONS = Object.freeze([
	'codecs/flac/NOTICE.md',
	'codecs/flac/licenses/FLAC.txt',
	'codecs/flac/source-manifest.json',
	'codecs/lame/NOTICE.md',
	'codecs/lame/licenses/LAME.txt',
	'codecs/lame/licenses/LGPL-2.0.txt',
	'codecs/lame/source-manifest.json',
	'codecs/mpg123/NOTICE.md',
	'codecs/mpg123/licenses/MPG123.txt',
	'codecs/mpg123/source-manifest.json',
	'codecs/opus/NOTICE.md',
	'codecs/opus/licenses/OGG.txt',
	'codecs/opus/licenses/OPUS.txt',
	'codecs/opus/source-manifest.json',
	'codecs/twolame/NOTICE.md',
	'codecs/twolame/SOURCE.md',
	'codecs/twolame/licenses/TWOLAME.txt',
	'codecs/twolame/source-manifest.json',
	'codecs/vorbis/NOTICE.md',
	'codecs/vorbis/licenses/OGG.txt',
	'codecs/vorbis/licenses/VORBIS.txt',
	'codecs/vorbis/source-manifest.json',
	'codecs/wasm-toolchain/licenses/COMPILER_RT.txt',
	'codecs/wasm-toolchain/licenses/EMSCRIPTEN.txt',
	'codecs/wasm-toolchain/licenses/MUSL.txt',
	'codecs/wavpack/NOTICE.md',
	'codecs/wavpack/licenses/WAVPACK.txt',
	'codecs/wavpack/source-manifest.json',
]);

test('desktop codec notice inventory is exact, immutable, and excludes executable payloads', () => {
	assert.deepEqual(
		DESKTOP_BUNDLED_CODEC_NOTICE_FILES.map(({ destination }) => destination),
		EXPECTED_DESTINATIONS,
	);
	assert.equal(Object.isFrozen(DESKTOP_BUNDLED_CODEC_NOTICE_FILES), true);
	for (const entry of DESKTOP_BUNDLED_CODEC_NOTICE_FILES) {
		assert.equal(Object.isFrozen(entry), true);
		assert.match(entry.sha256, /^[a-f\d]{64}$/u);
		assert.ok(Number.isSafeInteger(entry.byteLength) && entry.byteLength > 0);
		assert.doesNotMatch(entry.source, /(?:^|\/)(?:native|.*\.wasm)(?:\/|$)/u);
	}
});

test('desktop codec notices stage only exact regular source bytes', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-codec-notices-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'licenses');
	const result = await stageDesktopBundledCodecNotices({ repositoryRoot: ROOT, outputRoot });
	assert.deepEqual(result, {
		schemaVersion: 1,
		files: DESKTOP_BUNDLED_CODEC_NOTICE_FILES.map(({ destination, byteLength, sha256 }) => ({
			path: destination, byteLength, sha256,
		})),
	});
	for (const entry of DESKTOP_BUNDLED_CODEC_NOTICE_FILES) {
		const [source, staged] = await Promise.all([
			readFile(join(ROOT, entry.source)),
			readFile(join(outputRoot, entry.destination)),
		]);
		assert.deepEqual(staged, source, entry.destination);
		assert.equal(createHash('sha256').update(staged).digest('hex'), entry.sha256);
	}
});

test('desktop codec notice staging refuses source and destination symlinks', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-codec-notice-links-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const victim = join(temporaryRoot, 'victim.txt');
	await writeFile(victim, 'preserve-me');

	const outputRoot = join(temporaryRoot, 'licenses');
	const first = DESKTOP_BUNDLED_CODEC_NOTICE_FILES[0];
	const destination = join(outputRoot, first.destination);
	await mkdir(dirname(destination), { recursive: true });
	await symlink(victim, destination);
	await assert.rejects(
		stageDesktopBundledCodecNotices({ repositoryRoot: ROOT, outputRoot }),
		/(?:regular file|symbolic link|already exists|EEXIST)/iu,
	);
	assert.equal(await readFile(victim, 'utf8'), 'preserve-me');

	const sourceRoot = join(temporaryRoot, 'source-root');
	const linkedSource = join(sourceRoot, first.source);
	await mkdir(dirname(linkedSource), { recursive: true });
	await symlink(victim, linkedSource);
	await assert.rejects(
		stageDesktopBundledCodecNotices({
			repositoryRoot: sourceRoot,
			outputRoot: join(temporaryRoot, 'source-link-output'),
		}),
		/regular file|symbolic link/iu,
	);
});

test('every reviewed codec notice is checked out with the line endings it was hashed with', () => {
	// These files ship byte-for-byte and are verified against the digests above.
	// A Windows runner checks text out as CRLF unless .gitattributes says
	// otherwise, which changes the bytes and fails desktop staging on Windows
	// alone — invisible from a Linux checkout, and from CI until a package job
	// runs. Ask git what it would actually do with each reviewed path.
	const sources = DESKTOP_BUNDLED_CODEC_NOTICE_FILES.map((file) => file.source);
	const outcome = spawnSync('git', ['check-attr', 'eol', '--', ...sources],
		{ cwd: ROOT, encoding: 'utf8' });
	assert.equal(outcome.status, 0, outcome.stderr);
	const declared = new Map(outcome.stdout.split('\n').filter(Boolean).map((line) => {
		const separator = line.lastIndexOf(': eol: ');
		return [line.slice(0, separator), line.slice(separator + ': eol: '.length)];
	}));
	assert.deepEqual(sources.filter((source) => declared.get(source) !== 'lf'), [],
		'add the path to .gitattributes with "text eol=lf" before shipping its digest');
});

test('Electron packages the aggregate and complete staged codec license trees', () => {
	const configuration = require('../electron-builder.config.cjs');
	assert.equal(configuration.extraResources.some(({ from, to }) => (
		from === '.desktop-build/licenses/codecs' && to === 'licenses/codecs'
	)), true);
	assert.equal(configuration.extraResources.some(({ from }) => (
		from === '.desktop-build/licenses/THIRD_PARTY_LICENSES.md'
	)), true);
});
