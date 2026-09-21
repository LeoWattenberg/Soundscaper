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
import { stageDesktopBundledLameRuntime } from '../scripts/lib/desktop-bundled-lame-runtime.mjs';
import { stageDesktopBundledMpg123Runtime } from '../scripts/lib/desktop-bundled-mpg123-runtime.mjs';
import { stageDesktopBundledOpusRuntime } from '../scripts/lib/desktop-bundled-opus-runtime.mjs';
import { stageDesktopBundledTwolameRuntime } from '../scripts/lib/desktop-bundled-twolame-runtime.mjs';
import { stageDesktopBundledVorbisRuntime } from '../scripts/lib/desktop-bundled-vorbis-runtime.mjs';
import { stageDesktopBundledWavPackRuntime } from '../scripts/lib/desktop-bundled-wavpack-runtime.mjs';
import {
	DESKTOP_AUDIO_CODEC_RUNTIME_FILES,
	DESKTOP_BUNDLED_FLAC_WASM,
	DESKTOP_BUNDLED_LAME_WASM,
	DESKTOP_BUNDLED_MPG123_WASM,
	DESKTOP_BUNDLED_OPUS_WASM,
	DESKTOP_BUNDLED_TWOLAME_WASM,
	DESKTOP_BUNDLED_VORBIS_WASM,
	DESKTOP_BUNDLED_WAVPACK_WASM,
	DESKTOP_CODEC_RUNTIME_FILES,
	DESKTOP_EXTERNAL_FFMPEG_RUNTIME_FILES,
} from '../scripts/lib/desktop-external-ffmpeg-runtime-files.mjs';
import { isForbiddenDesktopFfmpegPath } from '../scripts/lib/desktop-codec-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_CODEC_RUNTIME_FILES = Object.freeze([
	'desktop/bounded-regular-file.js',
	'desktop/bundled-audio-codec-composite-provider.js',
	'desktop/bundled-audio-codec-helper-configuration.js',
	'desktop/bundled-audio-codec-helper-process.js',
	'desktop/bundled-audio-codec-isolated-runtime.js',
	'desktop/bundled-audio-codec-operation-runner.js',
	'desktop/bundled-audio-codec-provider-catalog.js',
	'desktop/bundled-audio-codec-runtime.js',
	'desktop/bundled-flac-audio-codec-runtime.js',
	'desktop/bundled-flac-stream.js',
	'desktop/bundled-lame-audio-codec-runtime.js',
	'desktop/bundled-mpeg-audio-stream.js',
	'desktop/bundled-mpg123-audio-codec-runtime.js',
	'desktop/bundled-opus-audio-codec-runtime.js',
	'desktop/bundled-opus-stream.js',
	'desktop/bundled-twolame-audio-codec-runtime.js',
	'desktop/bundled-vorbis-audio-codec-runtime.js',
	'desktop/bundled-vorbis-stream.js',
	'desktop/bundled-wavpack-audio-codec-runtime.js',
	'desktop/bundled-wavpack-stream.js',
	'src/common/editor/ogg-page-crc.js',
	'desktop/desktop-audio-codec-broker.js',
	'desktop/desktop-audio-codec-capability-contract.js',
	'desktop/desktop-audio-codec-main-ipc.js',
	'desktop/desktop-audio-codec-operation-contract.js',
	'desktop/desktop-audio-codec-runtime-composition.js',
	'desktop/desktop-audio-ffmpeg-plan.js',
	'desktop/desktop-audio-ffmpeg-wave-output.js',
	'desktop/desktop-audio-os-codec-candidates.js',
	'desktop/external-ffmpeg-audio-operation-runner.js',
	'desktop/external-ffmpeg-environment.js',
	'desktop/external-ffmpeg-process-security.js',
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
	'src/common/editor/wavpack-float32-chunk-layout.js',
	'src/common/editor/flac/flac.wasm',
	'src/common/editor/lame/lame.wasm',
	'src/common/editor/mpg123/mpg123.wasm',
	'src/common/editor/opus/opus.wasm',
	'src/common/editor/twolame/twolame.wasm',
	'src/common/editor/vorbis/vorbis.wasm',
	'src/common/editor/wavpack/wavpack.wasm',
	'desktop/audio-codec-stream-helper.js',
	'desktop/desktop-audio-stream-contract.js',
	'src/common/editor/browser-dedicated-audio-codec.js',
	'src/common/editor/browser-dedicated-audio-profiles.js',
	'src/common/editor/browser-dedicated-audio-output-validation.js',
	'src/common/editor/dedicated-audio-encode-session.js',
	'src/common/editor/large-audio-policy.js',
	'desktop/desktop-audio-stream-service.js',
	'desktop/desktop-audio-stream-job-runner.js',
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

test('desktop codec runtime inventory contains only exact reviewed audio payloads', async () => {
	assert.deepEqual(DESKTOP_BUNDLED_FLAC_WASM, {
		file: 'src/common/editor/flac/flac.wasm',
		byteLength: 154763,
		sha256: '6246c5d6979f25b733e399383004a6a861478802c376d59885a7b2c7130a1584',
	});
	assert.deepEqual(DESKTOP_BUNDLED_LAME_WASM, {
		file: 'src/common/editor/lame/lame.wasm',
		byteLength: 214198,
		sha256: 'e8ca1786d95a56ead1fc2294be98ea68d31eed5837abd79d2a3322a0af946c6f',
	});
	assert.deepEqual(DESKTOP_BUNDLED_WAVPACK_WASM, {
		file: 'src/common/editor/wavpack/wavpack.wasm',
		byteLength: 148868,
		sha256: '5197fb8fd8e6cbef210acad11eb2a9dd8395a519b5fd64ba14a1b4978041b0c5',
	});
	assert.deepEqual(DESKTOP_BUNDLED_OPUS_WASM, {
		file: 'src/common/editor/opus/opus.wasm',
		byteLength: 388526,
		sha256: 'cc5577fa2a6c74781b7eb57bd754f7d9b50b2355a83d85b0f0cfe96415607dce',
	});
	assert.deepEqual(DESKTOP_BUNDLED_MPG123_WASM, {
		file: 'src/common/editor/mpg123/mpg123.wasm',
		byteLength: 173764,
		sha256: '1aa30e6e25a9503be94ce3720ce6c4af649b2412c191a6f800f36dd619270bc2',
	});
	assert.deepEqual(DESKTOP_BUNDLED_TWOLAME_WASM, {
		file: 'src/common/editor/twolame/twolame.wasm',
		byteLength: 148312,
		sha256: '8b89b6a12eab302c92960865c6b1c7d33df86d6d8760c8549a8ee38a99ef2b30',
	});
	assert.deepEqual(DESKTOP_BUNDLED_VORBIS_WASM, {
		file: 'src/common/editor/vorbis/vorbis.wasm',
		byteLength: 526926,
		sha256: 'cfa42717394ce29f8af676fb0ad7bff632306f75e536211eb85b7cc5aaf09aa0',
	});
	assert.deepEqual(
		DESKTOP_CODEC_RUNTIME_FILES.filter((file) => file.endsWith('.wasm')),
		[
			DESKTOP_BUNDLED_FLAC_WASM.file, DESKTOP_BUNDLED_LAME_WASM.file,
			DESKTOP_BUNDLED_MPG123_WASM.file,
			DESKTOP_BUNDLED_OPUS_WASM.file, DESKTOP_BUNDLED_TWOLAME_WASM.file,
			DESKTOP_BUNDLED_VORBIS_WASM.file, DESKTOP_BUNDLED_WAVPACK_WASM.file,
		],
	);
	const flacProvider = await import('../desktop/bundled-flac-audio-codec-runtime.ts');
	assert.equal(flacProvider.BUNDLED_FLAC_WASM_BYTE_LENGTH, DESKTOP_BUNDLED_FLAC_WASM.byteLength);
	assert.equal(flacProvider.BUNDLED_FLAC_WASM_SHA256, DESKTOP_BUNDLED_FLAC_WASM.sha256);
	const lameProvider = await import('../desktop/bundled-lame-audio-codec-runtime.ts');
	assert.equal(lameProvider.BUNDLED_LAME_WASM_BYTE_LENGTH, DESKTOP_BUNDLED_LAME_WASM.byteLength);
	assert.equal(lameProvider.BUNDLED_LAME_WASM_SHA256, DESKTOP_BUNDLED_LAME_WASM.sha256);
	const opusProvider = await import('../desktop/bundled-opus-audio-codec-runtime.ts');
	assert.equal(opusProvider.BUNDLED_OPUS_WASM_BYTE_LENGTH, DESKTOP_BUNDLED_OPUS_WASM.byteLength);
	assert.equal(opusProvider.BUNDLED_OPUS_WASM_SHA256, DESKTOP_BUNDLED_OPUS_WASM.sha256);
	const mpg123Provider = await import('../desktop/bundled-mpg123-audio-codec-runtime.ts');
	assert.equal(mpg123Provider.BUNDLED_MPG123_WASM_BYTE_LENGTH, DESKTOP_BUNDLED_MPG123_WASM.byteLength);
	assert.equal(mpg123Provider.BUNDLED_MPG123_WASM_SHA256, DESKTOP_BUNDLED_MPG123_WASM.sha256);
	const twolameProvider = await import('../desktop/bundled-twolame-audio-codec-runtime.ts');
	assert.equal(twolameProvider.BUNDLED_TWOLAME_WASM_BYTE_LENGTH, DESKTOP_BUNDLED_TWOLAME_WASM.byteLength);
	assert.equal(twolameProvider.BUNDLED_TWOLAME_WASM_SHA256, DESKTOP_BUNDLED_TWOLAME_WASM.sha256);
	const vorbisProvider = await import('../desktop/bundled-vorbis-audio-codec-runtime.ts');
	assert.equal(vorbisProvider.BUNDLED_VORBIS_WASM_BYTE_LENGTH, DESKTOP_BUNDLED_VORBIS_WASM.byteLength);
	assert.equal(vorbisProvider.BUNDLED_VORBIS_WASM_SHA256, DESKTOP_BUNDLED_VORBIS_WASM.sha256);
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
		[
			DESKTOP_BUNDLED_FLAC_WASM.file, DESKTOP_BUNDLED_LAME_WASM.file,
			DESKTOP_BUNDLED_MPG123_WASM.file,
			DESKTOP_BUNDLED_OPUS_WASM.file, DESKTOP_BUNDLED_TWOLAME_WASM.file,
			DESKTOP_BUNDLED_VORBIS_WASM.file, DESKTOP_BUNDLED_WAVPACK_WASM.file,
		],
	);
	const stagedFlac = await readFile(join(outputRoot, DESKTOP_BUNDLED_FLAC_WASM.file));
	assert.equal(stagedFlac.byteLength, DESKTOP_BUNDLED_FLAC_WASM.byteLength);
	assert.equal(createHash('sha256').update(stagedFlac).digest('hex'), DESKTOP_BUNDLED_FLAC_WASM.sha256);
	const stagedLame = await readFile(join(outputRoot, DESKTOP_BUNDLED_LAME_WASM.file));
	assert.equal(stagedLame.byteLength, DESKTOP_BUNDLED_LAME_WASM.byteLength);
	assert.equal(createHash('sha256').update(stagedLame).digest('hex'), DESKTOP_BUNDLED_LAME_WASM.sha256);
	const stagedOpus = await readFile(join(outputRoot, DESKTOP_BUNDLED_OPUS_WASM.file));
	assert.equal(stagedOpus.byteLength, DESKTOP_BUNDLED_OPUS_WASM.byteLength);
	assert.equal(createHash('sha256').update(stagedOpus).digest('hex'), DESKTOP_BUNDLED_OPUS_WASM.sha256);
	const stagedMpg123 = await readFile(join(outputRoot, DESKTOP_BUNDLED_MPG123_WASM.file));
	assert.equal(stagedMpg123.byteLength, DESKTOP_BUNDLED_MPG123_WASM.byteLength);
	assert.equal(createHash('sha256').update(stagedMpg123).digest('hex'), DESKTOP_BUNDLED_MPG123_WASM.sha256);
	const stagedTwolame = await readFile(join(outputRoot, DESKTOP_BUNDLED_TWOLAME_WASM.file));
	assert.equal(stagedTwolame.byteLength, DESKTOP_BUNDLED_TWOLAME_WASM.byteLength);
	assert.equal(createHash('sha256').update(stagedTwolame).digest('hex'), DESKTOP_BUNDLED_TWOLAME_WASM.sha256);
	const stagedVorbis = await readFile(join(outputRoot, DESKTOP_BUNDLED_VORBIS_WASM.file));
	assert.equal(stagedVorbis.byteLength, DESKTOP_BUNDLED_VORBIS_WASM.byteLength);
	assert.equal(createHash('sha256').update(stagedVorbis).digest('hex'), DESKTOP_BUNDLED_VORBIS_WASM.sha256);
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

test('Ogg Vorbis staging refuses a pre-existing destination symlink', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-vorbis-link-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const destination = join(outputRoot, DESKTOP_BUNDLED_VORBIS_WASM.file);
	const victim = join(temporaryRoot, 'victim.wasm');
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(victim, 'preserve-me');
	await symlink(victim, destination);
	await assert.rejects(
		stageDesktopBundledVorbisRuntime({ repositoryRoot: ROOT, outputRoot }),
		/(?:EEXIST|file already exists)/iu,
	);
	assert.equal(await readFile(victim, 'utf8'), 'preserve-me');
});

test('mpg123 staging refuses a pre-existing destination symlink', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-mpg123-link-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const destination = join(outputRoot, DESKTOP_BUNDLED_MPG123_WASM.file);
	const victim = join(temporaryRoot, 'victim.wasm');
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(victim, 'preserve-me');
	await symlink(victim, destination);
	await assert.rejects(
		stageDesktopBundledMpg123Runtime({ repositoryRoot: ROOT, outputRoot }),
		/(?:EEXIST|file already exists)/iu,
	);
	assert.equal(await readFile(victim, 'utf8'), 'preserve-me');
});

test('LAME staging refuses a pre-existing destination symlink', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-lame-link-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const destination = join(outputRoot, DESKTOP_BUNDLED_LAME_WASM.file);
	const victim = join(temporaryRoot, 'victim.wasm');
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(victim, 'preserve-me');
	await symlink(victim, destination);
	await assert.rejects(
		stageDesktopBundledLameRuntime({ repositoryRoot: ROOT, outputRoot }),
		/(?:EEXIST|file already exists)/iu,
	);
	assert.equal(await readFile(victim, 'utf8'), 'preserve-me');
});

test('TwoLAME staging refuses a pre-existing destination symlink', async (context) => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-twolame-link-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const outputRoot = join(temporaryRoot, 'runtime');
	const destination = join(outputRoot, DESKTOP_BUNDLED_TWOLAME_WASM.file);
	const victim = join(temporaryRoot, 'victim.wasm');
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(victim, 'preserve-me');
	await symlink(victim, destination);
	await assert.rejects(
		stageDesktopBundledTwolameRuntime({ repositoryRoot: ROOT, outputRoot }),
		/(?:EEXIST|file already exists)/iu,
	);
	assert.equal(await readFile(victim, 'utf8'), 'preserve-me');
});
