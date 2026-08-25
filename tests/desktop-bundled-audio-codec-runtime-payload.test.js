/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_NAME,
	DESKTOP_BUNDLED_AUDIO_CODEC_CONTROL_FILES,
	DESKTOP_BUNDLED_AUDIO_CODEC_EXECUTION_FILES,
	DESKTOP_BUNDLED_AUDIO_CODEC_ISOLATION_FILES,
	createBundledAudioCodecRuntimeManifest,
	createBundledAudioCodecRuntimeVerifier,
	serializeBundledAudioCodecRuntimeManifest,
} from '../desktop/bundled-audio-codec-runtime-payload.mjs';
import {
	assertBundledAudioCodecRuntimeClosure,
} from '../scripts/lib/desktop-bundled-audio-codec-runtime-closure.mjs';
import {
	createBundledAudioCodecOperationRunner,
} from '../desktop/bundled-audio-codec-operation-runner.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function stagedFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-bundled-payload-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const desktopRoot = join(root, 'desktop');
	for (const file of DESKTOP_BUNDLED_AUDIO_CODEC_ISOLATION_FILES) {
		const output = join(desktopRoot, file.path);
		await mkdir(dirname(output), { recursive: true });
		if (file.role === 'wasm') {
			const repositoryPath = join(ROOT, file.path.replace(/^project-library-runtime\//u, ''));
			await copyFile(repositoryPath, output);
		} else {
			await writeFile(output, `reviewed ${file.role} ${file.codec ?? 'control'} ${file.path}\n`);
		}
	}
	const manifest = await createBundledAudioCodecRuntimeManifest({ desktopRoot });
	await writeFile(
		join(desktopRoot, BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_NAME),
		serializeBundledAudioCodecRuntimeManifest(manifest), { flag: 'wx' },
	);
	return { root, desktopRoot, manifest };
}

test('staged manifest closes over control, helper, runner, seven modules, and seven pinned wasm files', async (context) => {
	const fixture = await stagedFixture(context);
	assert.equal(fixture.manifest.files.length, DESKTOP_BUNDLED_AUDIO_CODEC_ISOLATION_FILES.length);
	assert.deepEqual(
		fixture.manifest.files.filter(({ role }) => role === 'wasm').map(({ codec }) => codec).sort(),
		['flac', 'lame', 'mpg123', 'opus', 'twolame', 'vorbis', 'wavpack'],
	);
	for (const required of [
		'project-library-runtime/desktop/bounded-regular-file.js',
		'project-library-runtime/desktop/bundled-audio-codec-helper-configuration.js',
		'project-library-runtime/desktop/bundled-audio-codec-helper-process.js',
		'project-library-runtime/desktop/bundled-audio-codec-operation-runner.js',
		'project-library-runtime/desktop/bundled-audio-codec-isolated-runtime.js',
		'bundled-audio-codec-electron-spawn.mjs',
	]) assert.equal(fixture.manifest.files.some(({ path }) => path === required), true, required);
	assert.equal(fixture.manifest.files.some(({ path }) => /ffmpeg/iu.test(path)), false);

	const verify = createBundledAudioCodecRuntimeVerifier({
		desktopRoot: fixture.desktopRoot, target: 'linux-arm64',
	});
	const flac = await verify('flac');
	assert.deepEqual(flac, {
		contractVersion: 1, target: 'linux-arm64', codec: 'flac',
		runtimeRoot: join(fixture.desktopRoot, 'project-library-runtime'),
		moduleBytes: fixture.manifest.files.find(({ role, codec }) => role === 'module' && codec === 'flac').byteLength,
		moduleSha256: fixture.manifest.files.find(({ role, codec }) => role === 'module' && codec === 'flac').sha256,
		dependencies: [
			'desktop/bundled-flac-stream.js',
			'desktop/desktop-audio-codec-operation-contract.js',
			'src/common/editor/desktop-codec-provider-catalog.js',
		].map((path) => {
			const staged = fixture.manifest.files.find((file) => (
				file.path === `project-library-runtime/${path}`
			));
			return { path, byteLength: staged.byteLength, sha256: staged.sha256 };
		}),
		wasmBytes: 153_044,
		wasmSha256: '34acff0d67e3ac7f34816217ed7f5f859bf9a1c70f33eb3c347049f5fdf0d443',
	});
});

test('main rejects a changed transitive dependency before forking and rejects an inexact manifest', async (context) => {
	const changed = await stagedFixture(context);
	const verifyChanged = createBundledAudioCodecRuntimeVerifier({
		desktopRoot: changed.desktopRoot, target: 'mac-arm64',
	});
	await writeFile(join(
		changed.desktopRoot,
		'project-library-runtime/desktop/desktop-audio-codec-operation-contract.js',
	), 'changed');
	await assert.rejects(() => verifyChanged('opus'), /(?:control file|dependency).*digest/iu);
	let forks = 0;
	const runner = createBundledAudioCodecOperationRunner({
		target: 'mac-arm64', scratchRoot: join(changed.root, 'scratch'),
		verifyPayload: verifyChanged,
		spawn: () => { forks += 1; throw new Error('must not fork'); },
	});
	const result = await runner.execute(
		'opus', Object.freeze({
			operation: 'audio-decode', format: 'opus', input: Uint8Array.of(1),
			maximumOutputBytes: 1024, sampleRate: null, channelCount: null,
			settings: Object.freeze({ sampleFormat: 'f32le' }),
		}), Object.freeze({
			direction: 'decode', mediaKind: 'audio', container: 'ogg', codec: 'opus',
			profile: 'opus', sampleFormat: 'f32', pixelFormat: null,
			sampleRate: null, channelCount: null, width: null, height: null,
		}),
	);
	assert.deepEqual(result, {
		status: 'failed', reason: 'security-failed',
		detail: 'The isolated bundled codec payload identity changed.',
	});
	assert.equal(forks, 0);

	const inexact = await stagedFixture(context);
	const manifestPath = join(inexact.desktopRoot, BUNDLED_AUDIO_CODEC_RUNTIME_MANIFEST_NAME);
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	manifest.extra = true;
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	const verifyInexact = createBundledAudioCodecRuntimeVerifier({
		desktopRoot: inexact.desktopRoot, target: 'win-x64',
	});
	await assert.rejects(() => verifyInexact('lame'), /manifest.*inexact shape/iu);
});

test('runtime verifier refuses symbolic staged members and macOS x64 aliases', async (context) => {
	const fixture = await stagedFixture(context);
	const helper = join(
		fixture.desktopRoot,
		'project-library-runtime/desktop/bundled-audio-codec-helper-process.js',
	);
	const victim = join(fixture.root, 'victim.js');
	await writeFile(victim, 'victim');
	await rm(helper);
	await symlink(victim, helper);
	const verify = createBundledAudioCodecRuntimeVerifier({
		desktopRoot: fixture.desktopRoot, target: 'win-arm64',
	});
	await assert.rejects(() => verify('wavpack'), /control file.*identity/iu);
	assert.throws(() => createBundledAudioCodecRuntimeVerifier({
		desktopRoot: fixture.desktopRoot, target: 'mac-x64',
	}), /target.*unsupported/iu);
});

test('build audit rejects any transitive module outside the authenticated per-codec closure', async (context) => {
	const fixture = await stagedFixture(context);
	const controlEntry = 'project-library-runtime/desktop/bundled-audio-codec-isolated-runtime.js';
	const controlRoots = new Set([
		'bundled-audio-codec-electron-spawn.mjs',
		'bundled-audio-codec-runtime-payload.mjs',
		'project-library-runtime/desktop/bundled-audio-codec-helper-process.js', controlEntry,
	]);
	await writeFile(join(
		fixture.desktopRoot,
		'project-library-runtime/desktop/bundled-audio-codec-helper-process.js',
	), 'await import(pathToFileURL(path).href);\n');
	const controlImports = DESKTOP_BUNDLED_AUDIO_CODEC_CONTROL_FILES
		.filter((path) => !controlRoots.has(path))
		.map((path) => {
			const specifier = relative(dirname(controlEntry), path).replaceAll('\\', '/');
			return `import '${specifier.startsWith('.') ? specifier : `./${specifier}`}';`;
		});
	await writeFile(join(fixture.desktopRoot, controlEntry), `${controlImports.join('\n')}\n`);
	for (const files of Object.values(DESKTOP_BUNDLED_AUDIO_CODEC_EXECUTION_FILES)) {
		const entry = files.find((path) => /bundled-[^-]+-audio-codec-runtime\.js$/u.test(path)
			|| path.includes('bundled-mpg123-audio-codec-runtime.js'));
		assert.ok(entry);
		const imports = files.filter((path) => path !== entry).map((path) => {
			const specifier = relative(dirname(entry), path).replaceAll('\\', '/');
			return `import '${specifier.startsWith('.') ? specifier : `./${specifier}`}';`;
		});
		await writeFile(join(fixture.desktopRoot, entry), `${imports.join('\n')}\n`);
	}
	await assertBundledAudioCodecRuntimeClosure({ desktopRoot: fixture.desktopRoot });

	const flacEntry = DESKTOP_BUNDLED_AUDIO_CODEC_EXECUTION_FILES.flac.find((path) => (
		path.includes('bundled-flac-audio-codec-runtime.js')
	));
	await writeFile(join(fixture.desktopRoot, flacEntry), "import './not-in-the-manifest.js';\n", { flag: 'a' });
	await assert.rejects(
		() => assertBundledAudioCodecRuntimeClosure({ desktopRoot: fixture.desktopRoot }),
		/unauthenticated module/iu,
	);
});
