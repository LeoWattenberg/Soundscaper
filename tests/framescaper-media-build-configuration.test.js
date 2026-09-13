/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createFramescaperMediaHostBuildCommands,
	FRAMESCAPER_FFMPEG_REQUIRED_CONFIGURATION,
	framescaperMediaHostBuildPaths,
	verifyFramescaperFfmpegConfiguration,
} from '../native/framescaper-media-host/build/media-build-commands.mjs';
import {
	collectExtractedSourceTree,
} from '../native/framescaper-media-host/build/source-authentication.mjs';

test('the generated FFmpeg configuration must contain every required component', (context) => {
	const root = mkdtempSync(join(tmpdir(), 'framescaper-ffmpeg-config-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'ffbuild'));
	const path = join(root, 'ffbuild/config.mak');
	writeFileSync(path, `${FRAMESCAPER_FFMPEG_REQUIRED_CONFIGURATION.map(
		(name) => `${name}=yes`,
	).join('\n')}\nCONFIG_NETWORK=no\nCONFIG_SHARED=no\nCONFIG_PROGRAMS=no\n`);
	assert.equal(verifyFramescaperFfmpegConfiguration(root).required.length,
		FRAMESCAPER_FFMPEG_REQUIRED_CONFIGURATION.length);
	writeFileSync(path, 'CONFIG_LIBX264=yes\n');
	assert.throws(() => verifyFramescaperFfmpegConfiguration(root), /omitted required components/u);
});

test('the Windows x265 build explicitly selects the static MSVC runtime', () => {
	const paths = framescaperMediaHostBuildPaths('/work');
	const executables = Object.fromEntries([
		'ar', 'c', 'cmake', 'cxx', 'make', 'msbuild', 'ninja', 'pkgConfig', 'ranlib', 'rc', 'shell',
	].map((role) => [role, { path: `/tools/${role}` }]));
	const commands = createFramescaperMediaHostBuildCommands({
		target: { id: 'win-arm64', cmakePreset: 'win-arm64' }, hostRoot: '/host',
		ffmpegSourceRoot: '/ffmpeg', boostSourceRoot: '/boost', paths,
		externalSourceRoots: Object.fromEntries(
			['x264', 'x265', 'libvpx', 'libopus', 'zlib'].map((id) => [id, `/sources/${id}`]),
		),
		tools: { executables }, environment: { PATH: '/tools' }, configureFlags: [],
	});
	assert.ok(commands.find(({ phase }) => phase === 'x265-configure')
		.args.includes('-DSTATIC_LINK_CRT=ON'));
});

test('source-tree authentication admits genuine names and rejects nonportable entries', (context) => {
	const accepted = mkdtempSync(join(tmpdir(), 'framescaper-portable-source-'));
	context.after(() => rmSync(accepted, { recursive: true, force: true }));
	mkdirSync(join(accepted, 'docs'));
	for (const path of [
		'docs/CMake API.md', 'Icon-29@3x.png', 'juce_(generated)+source~1.cpp', 'hash#percent%.txt',
	]) writeFileSync(join(accepted, ...path.split('/')), path);
	assert.deepEqual(collectExtractedSourceTree(accepted).files.map(({ path }) => path), [
		'Icon-29@3x.png', 'docs/CMake API.md', 'hash#percent%.txt', 'juce_(generated)+source~1.cpp',
	]);
	for (const name of ['bad:name', 'bad\\name', 'trailing.', 'trailing ', 'CON', 'lpt1.txt', 'line\nbreak']) {
		const rejected = mkdtempSync(join(tmpdir(), 'framescaper-nonportable-source-'));
		context.after(() => rmSync(rejected, { recursive: true, force: true }));
		writeFileSync(join(rejected, name), 'bytes');
		assert.throws(() => collectExtractedSourceTree(rejected), /portable canonical path segment/u);
	}
	const collision = mkdtempSync(join(tmpdir(), 'framescaper-case-source-'));
	context.after(() => rmSync(collision, { recursive: true, force: true }));
	writeFileSync(join(collision, 'Case.h'), 'upper');
	writeFileSync(join(collision, 'case.h'), 'lower');
	if (readdirSync(collision).length === 2) {
		assert.throws(() => collectExtractedSourceTree(collision), /not portable across target filesystems/u);
	}
	const linked = mkdtempSync(join(tmpdir(), 'framescaper-linked-source-'));
	context.after(() => rmSync(linked, { recursive: true, force: true }));
	writeFileSync(join(linked, 'actual.h'), 'bytes');
	symlinkSync(join(linked, 'actual.h'), join(linked, 'alias.h'));
	assert.throws(() => collectExtractedSourceTree(linked), /canonical regular file/u);
});
