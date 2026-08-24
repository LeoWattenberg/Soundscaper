/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileDesktopProjectLibraryRuntime } from '../scripts/lib/desktop-project-library-runtime.mjs';
import {
	DESKTOP_AUDIO_CODEC_RUNTIME_FILES,
	DESKTOP_CODEC_RUNTIME_FILES,
	DESKTOP_EXTERNAL_FFMPEG_RUNTIME_FILES,
} from '../scripts/lib/desktop-external-ffmpeg-runtime-files.mjs';
import { isForbiddenDesktopFfmpegPath } from '../scripts/lib/desktop-codec-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_CODEC_RUNTIME_FILES = Object.freeze([
	'desktop/desktop-audio-codec-broker.js',
	'desktop/desktop-audio-codec-main-ipc.js',
	'desktop/desktop-audio-codec-operation-contract.js',
	'desktop/desktop-audio-codec-runtime-composition.js',
	'desktop/desktop-audio-ffmpeg-plan.js',
	'desktop/external-ffmpeg-audio-operation-runner.js',
	'src/common/editor/desktop-codec-coordinator.js',
	'src/common/editor/desktop-codec-provider-catalog.js',
]);

test('desktop codec runtime inventory closes over both main audio entry points', async () => {
	assert.deepEqual(DESKTOP_AUDIO_CODEC_RUNTIME_FILES, AUDIO_CODEC_RUNTIME_FILES);
	assert.equal(DESKTOP_EXTERNAL_FFMPEG_RUNTIME_FILES, DESKTOP_CODEC_RUNTIME_FILES);
	for (const file of AUDIO_CODEC_RUNTIME_FILES) {
		assert.equal(DESKTOP_CODEC_RUNTIME_FILES.includes(file), true, file);
	}

	const configuration = JSON.parse(await readFile(resolve(ROOT, 'tsconfig.desktop-runtime.json'), 'utf8'));
	const included = new Set(configuration.include);
	for (const file of AUDIO_CODEC_RUNTIME_FILES) {
		assert.equal(included.has(file.replace(/\.js$/u, '.ts')), true, file);
	}
});

test('desktop codec runtime inventory contains no browser FFmpeg or WASM payload', () => {
	for (const file of DESKTOP_CODEC_RUNTIME_FILES) {
		assert.equal(isForbiddenDesktopFfmpegPath(file), false, file);
		assert.doesNotMatch(file, /(?:^|\/)runtime\/ffmpeg(?:\/|$)|ffmpeg-core|\.wasm$|(?:^|\/)libav(?:codec|device|filter|format|util)/iu, file);
	}
});

test('compiled desktop audio main entry points are importable from the staged runtime graph', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-audio-codec-runtime-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const result = await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot });
	for (const file of AUDIO_CODEC_RUNTIME_FILES) assert.equal(result.files.includes(file), true, file);
	const composition = await import(pathToFileURL(join(
		outputRoot, 'desktop/desktop-audio-codec-runtime-composition.js',
	)).href);
	const ipc = await import(pathToFileURL(join(
		outputRoot, 'desktop/desktop-audio-codec-main-ipc.js',
	)).href);
	assert.equal(typeof composition.createDesktopAudioCodecRuntimeComposition, 'function');
	assert.equal(typeof ipc.registerDesktopAudioCodecMainIpc, 'function');
});
