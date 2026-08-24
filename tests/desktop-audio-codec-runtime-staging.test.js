/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compileDesktopProjectLibraryRuntime } from '../scripts/lib/desktop-project-library-runtime.mjs';
import { stageDesktopBundledFlacRuntime } from '../scripts/lib/desktop-bundled-flac-runtime.mjs';
import { stageDesktopBundledOpusRuntime } from '../scripts/lib/desktop-bundled-opus-runtime.mjs';
import { stageDesktopBundledWavPackRuntime } from '../scripts/lib/desktop-bundled-wavpack-runtime.mjs';
import {
	DESKTOP_AUDIO_CODEC_RUNTIME_FILES,
	DESKTOP_BUNDLED_FLAC_WASM,
	DESKTOP_BUNDLED_OPUS_WASM,
	DESKTOP_BUNDLED_WAVPACK_WASM,
	DESKTOP_CODEC_RUNTIME_FILES,
	DESKTOP_EXTERNAL_FFMPEG_RUNTIME_FILES,
} from '../scripts/lib/desktop-external-ffmpeg-runtime-files.mjs';
import { isForbiddenDesktopFfmpegPath } from '../scripts/lib/desktop-codec-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_CODEC_RUNTIME_FILES = Object.freeze([
	'desktop/bounded-regular-file.js',
	'desktop/bundled-audio-codec-runtime.js',
	'desktop/bundled-flac-audio-codec-runtime.js',
	'desktop/bundled-flac-stream.js',
	'desktop/bundled-opus-audio-codec-runtime.js',
	'desktop/bundled-opus-stream.js',
	'desktop/bundled-wavpack-audio-codec-runtime.js',
	'desktop/bundled-wavpack-stream.js',
	'desktop/desktop-audio-codec-broker.js',
	'desktop/desktop-audio-codec-capability-contract.js',
	'desktop/desktop-audio-codec-main-ipc.js',
	'desktop/desktop-audio-codec-operation-contract.js',
	'desktop/desktop-audio-codec-runtime-composition.js',
	'desktop/desktop-audio-ffmpeg-plan.js',
	'desktop/desktop-audio-ffmpeg-wave-output.js',
	'desktop/desktop-audio-os-codec-candidates.js',
	'desktop/external-ffmpeg-audio-operation-runner.js',
	'desktop/os-audio-codec-canary-adapter.js',
	'desktop/os-audio-codec-operation-runner.js',
	'desktop/os-audio-codec-runtime.js',
	'desktop/os-audio-codec-source-inspection.js',
	'desktop/os-codec-capability-adapter.js',
	'desktop/os-codec-native-canary-runner.js',
	'desktop/process-tree-termination.js',
	'src/common/editor/desktop-codec-coordinator.js',
	'src/common/editor/desktop-codec-provider-catalog.js',
	'src/common/editor/desktop-wavpack-codec-profile.js',
	'src/common/editor/flac/flac.wasm',
	'src/common/editor/opus/opus.wasm',
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

test('desktop codec runtime inventory contains only exact reviewed FLAC, Opus, and WavPack payloads', async () => {
	assert.deepEqual(DESKTOP_BUNDLED_FLAC_WASM, {
		file: 'src/common/editor/flac/flac.wasm',
		byteLength: 153_044,
		sha256: '34acff0d67e3ac7f34816217ed7f5f859bf9a1c70f33eb3c347049f5fdf0d443',
	});
	assert.deepEqual(DESKTOP_BUNDLED_WAVPACK_WASM, {
		file: 'src/common/editor/wavpack/wavpack.wasm',
		byteLength: 145_537,
		sha256: 'c547aca2d5584d643cea4a9d856f9672b9f621fae518ef99444d94500c31f908',
	});
	assert.deepEqual(DESKTOP_BUNDLED_OPUS_WASM, {
		file: 'src/common/editor/opus/opus.wasm',
		byteLength: 385_789,
		sha256: 'c4c9f7ac85071b24b2545f966943c4319fff023a65c899146cfcb016ae0a8853',
	});
	assert.deepEqual(
		DESKTOP_CODEC_RUNTIME_FILES.filter((file) => file.endsWith('.wasm')),
		[DESKTOP_BUNDLED_FLAC_WASM.file, DESKTOP_BUNDLED_OPUS_WASM.file, DESKTOP_BUNDLED_WAVPACK_WASM.file],
	);
	const flacProvider = await import('../desktop/bundled-flac-audio-codec-runtime.ts');
	assert.equal(flacProvider.BUNDLED_FLAC_WASM_BYTE_LENGTH, DESKTOP_BUNDLED_FLAC_WASM.byteLength);
	assert.equal(flacProvider.BUNDLED_FLAC_WASM_SHA256, DESKTOP_BUNDLED_FLAC_WASM.sha256);
	const opusProvider = await import('../desktop/bundled-opus-audio-codec-runtime.ts');
	assert.equal(opusProvider.BUNDLED_OPUS_WASM_BYTE_LENGTH, DESKTOP_BUNDLED_OPUS_WASM.byteLength);
	assert.equal(opusProvider.BUNDLED_OPUS_WASM_SHA256, DESKTOP_BUNDLED_OPUS_WASM.sha256);
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
		[DESKTOP_BUNDLED_FLAC_WASM.file, DESKTOP_BUNDLED_OPUS_WASM.file, DESKTOP_BUNDLED_WAVPACK_WASM.file],
	);
	const stagedFlac = await readFile(join(outputRoot, DESKTOP_BUNDLED_FLAC_WASM.file));
	assert.equal(stagedFlac.byteLength, DESKTOP_BUNDLED_FLAC_WASM.byteLength);
	assert.equal(createHash('sha256').update(stagedFlac).digest('hex'), DESKTOP_BUNDLED_FLAC_WASM.sha256);
	const stagedOpus = await readFile(join(outputRoot, DESKTOP_BUNDLED_OPUS_WASM.file));
	assert.equal(stagedOpus.byteLength, DESKTOP_BUNDLED_OPUS_WASM.byteLength);
	assert.equal(createHash('sha256').update(stagedOpus).digest('hex'), DESKTOP_BUNDLED_OPUS_WASM.sha256);
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

test('FLAC staging refuses a pre-existing destination symlink', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-flac-link-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const destination = join(outputRoot, DESKTOP_BUNDLED_FLAC_WASM.file);
	const victim = join(temporaryRoot, 'victim.wasm');
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(victim, 'preserve-me');
	await symlink(victim, destination);
	await assert.rejects(
		stageDesktopBundledFlacRuntime({ repositoryRoot: ROOT, outputRoot }),
		/(?:EEXIST|file already exists)/iu,
	);
	assert.equal(await readFile(victim, 'utf8'), 'preserve-me');
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

test('Ogg Opus staging refuses a pre-existing destination symlink', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-opus-link-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const destination = join(outputRoot, DESKTOP_BUNDLED_OPUS_WASM.file);
	const victim = join(temporaryRoot, 'victim.wasm');
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(victim, 'preserve-me');
	await symlink(victim, destination);
	await assert.rejects(
		stageDesktopBundledOpusRuntime({ repositoryRoot: ROOT, outputRoot }),
		/(?:EEXIST|file already exists)/iu,
	);
	assert.equal(await readFile(victim, 'utf8'), 'preserve-me');
});
