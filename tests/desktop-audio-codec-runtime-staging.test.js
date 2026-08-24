/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileDesktopProjectLibraryRuntime } from '../scripts/lib/desktop-project-library-runtime.mjs';
import { stageDesktopBundledWavPackRuntime } from '../scripts/lib/desktop-bundled-wavpack-runtime.mjs';
import {
	DESKTOP_AUDIO_CODEC_RUNTIME_FILES,
	DESKTOP_BUNDLED_WAVPACK_WASM,
	DESKTOP_CODEC_RUNTIME_FILES,
	DESKTOP_EXTERNAL_FFMPEG_RUNTIME_FILES,
} from '../scripts/lib/desktop-external-ffmpeg-runtime-files.mjs';
import { isForbiddenDesktopFfmpegPath } from '../scripts/lib/desktop-codec-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_CODEC_RUNTIME_FILES = Object.freeze([
	'desktop/bundled-wavpack-audio-codec-runtime.js',
	'desktop/bundled-wavpack-stream.js',
	'desktop/desktop-audio-codec-broker.js',
	'desktop/desktop-audio-codec-capability-contract.js',
	'desktop/desktop-audio-codec-main-ipc.js',
	'desktop/desktop-audio-codec-operation-contract.js',
	'desktop/desktop-audio-codec-runtime-composition.js',
	'desktop/desktop-audio-ffmpeg-plan.js',
	'desktop/external-ffmpeg-audio-operation-runner.js',
	'src/common/editor/desktop-codec-coordinator.js',
	'src/common/editor/desktop-codec-provider-catalog.js',
	'src/common/editor/desktop-wavpack-codec-profile.js',
	'src/common/editor/wavpack/wavpack.wasm',
]);

test('desktop codec runtime inventory closes over both main audio entry points', async () => {
	assert.deepEqual(DESKTOP_AUDIO_CODEC_RUNTIME_FILES, AUDIO_CODEC_RUNTIME_FILES);
	assert.equal(DESKTOP_EXTERNAL_FFMPEG_RUNTIME_FILES, DESKTOP_CODEC_RUNTIME_FILES);
	for (const file of AUDIO_CODEC_RUNTIME_FILES) {
		assert.equal(DESKTOP_CODEC_RUNTIME_FILES.includes(file), true, file);
	}

	const configuration = JSON.parse(await readFile(resolve(ROOT, 'tsconfig.desktop-runtime.json'), 'utf8'));
	const included = new Set(configuration.include);
	for (const file of AUDIO_CODEC_RUNTIME_FILES.filter((name) => name.startsWith('desktop/'))) {
		assert.equal(included.has(file.replace(/\.js$/u, '.ts')), true, file);
	}
});

test('desktop codec runtime inventory contains only the exact reviewed WavPack WASM payload', async () => {
	assert.deepEqual(DESKTOP_BUNDLED_WAVPACK_WASM, {
		file: 'src/common/editor/wavpack/wavpack.wasm',
		byteLength: 145_537,
		sha256: 'c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908',
	});
	assert.deepEqual(
		DESKTOP_CODEC_RUNTIME_FILES.filter((file) => file.endsWith('.wasm')),
		[DESKTOP_BUNDLED_WAVPACK_WASM.file],
	);
	const provider = await import('../desktop/bundled-wavpack-audio-codec-runtime.ts');
	assert.equal(provider.BUNDLED_WAVPACK_WASM_BYTE_LENGTH, DESKTOP_BUNDLED_WAVPACK_WASM.byteLength);
	assert.equal(provider.BUNDLED_WAVPACK_WASM_SHA256, DESKTOP_BUNDLED_WAVPACK_WASM.sha256);
	for (const file of DESKTOP_CODEC_RUNTIME_FILES) {
		assert.equal(isForbiddenDesktopFfmpegPath(file), false, file);
		assert.doesNotMatch(file, /(?:^|\/)runtime\/ffmpeg(?:\/|$)|ffmpeg-core|(?:^|\/)libav(?:codec|device|filter|format|util)/iu, file);
	}
});

test('compiled desktop audio main entry points are importable from the staged runtime graph', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-audio-codec-runtime-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const result = await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot });
	for (const file of AUDIO_CODEC_RUNTIME_FILES) assert.equal(result.files.includes(file), true, file);
	assert.equal(result.files.includes('src/common/editor/wavpack/runtime.js'), true);
	assert.deepEqual(
		result.files.filter((file) => file.endsWith('.wasm')),
		[DESKTOP_BUNDLED_WAVPACK_WASM.file],
	);
	const stagedWasm = await readFile(join(outputRoot, DESKTOP_BUNDLED_WAVPACK_WASM.file));
	assert.equal(stagedWasm.byteLength, DESKTOP_BUNDLED_WAVPACK_WASM.byteLength);
	assert.equal(createHash('sha256').update(stagedWasm).digest('hex'), DESKTOP_BUNDLED_WAVPACK_WASM.sha256);
	const composition = await import(pathToFileURL(join(
		outputRoot, 'desktop/desktop-audio-codec-runtime-composition.js',
	)).href);
	const ipc = await import(pathToFileURL(join(
		outputRoot, 'desktop/desktop-audio-codec-main-ipc.js',
	)).href);
	assert.equal(typeof composition.createDesktopAudioCodecRuntimeComposition, 'function');
	assert.equal(typeof ipc.registerDesktopAudioCodecMainIpc, 'function');
});

test('WavPack staging refuses a pre-existing destination symlink', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-wavpack-link-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const destination = join(outputRoot, DESKTOP_BUNDLED_WAVPACK_WASM.file);
	const victim = join(temporaryRoot, 'victim.wasm');
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(victim, 'preserve-me');
	await symlink(victim, destination);
	await assert.rejects(
		stageDesktopBundledWavPackRuntime({ repositoryRoot: ROOT, outputRoot }),
		/(?:EEXIST|file already exists)/iu,
	);
	assert.equal(await readFile(victim, 'utf8'), 'preserve-me');
});
