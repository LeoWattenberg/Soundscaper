/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	compileDesktopProjectLibraryRuntime,
	stageDesktopApplicationSources,
} from '../scripts/lib/desktop-project-library-runtime.mjs';
import {
	DESKTOP_AUDIO_CODEC_RUNTIME_FILES,
} from '../scripts/lib/desktop-external-ffmpeg-runtime-files.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPILED_OS_CODEC_FILES = Object.freeze([
	'desktop/desktop-audio-os-codec-candidates.js',
	'desktop/os-audio-codec-runtime.js',
	'desktop/os-audio-codec-canary-adapter.js',
	'desktop/os-audio-codec-operation-runner.js',
	'desktop/os-codec-capability-adapter.js',
	'desktop/os-codec-native-canary-runner.js',
]);

test('desktop runtime inventory closes over the supervised OS audio codec tier', async () => {
	for (const file of COMPILED_OS_CODEC_FILES) {
		assert.equal(DESKTOP_AUDIO_CODEC_RUNTIME_FILES.includes(file), true, file);
	}
	const configuration = JSON.parse(await readFile(join(ROOT, 'tsconfig.desktop-runtime.json'), 'utf8'));
	for (const file of COMPILED_OS_CODEC_FILES) {
		assert.equal(configuration.include.includes(file.replace(/\.js$/u, '.ts')), true, file);
	}
});

test('desktop staging ships importable OS codec runtime plus its exact helper process', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-os-codec-stage-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const runtimeRoot = join(temporaryRoot, 'runtime');
	const applicationDesktopRoot = join(temporaryRoot, 'application', 'desktop');
	await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot: runtimeRoot });
	await stageDesktopApplicationSources({
		desktopSourceRoot: join(ROOT, 'desktop'), applicationDesktopRoot, runtimeRoot,
	});
	await access(join(applicationDesktopRoot, 'os-audio-codec-helper-process.js'));
	await access(join(applicationDesktopRoot, 'os-audio-codec-electron-spawn.mjs'));
	for (const file of COMPILED_OS_CODEC_FILES) {
		await access(join(applicationDesktopRoot, 'project-library-runtime', file));
	}
	const runner = await import(pathToFileURL(join(
		applicationDesktopRoot, 'project-library-runtime/desktop/os-audio-codec-operation-runner.js',
	)).href);
	const canary = await import(pathToFileURL(join(
		applicationDesktopRoot, 'project-library-runtime/desktop/os-audio-codec-canary-adapter.js',
	)).href);
	assert.equal(typeof runner.createOperatingSystemAudioCodecOperationRunner, 'function');
	assert.equal(typeof canary.createOperatingSystemAudioCodecCanaryAdapter, 'function');
});
