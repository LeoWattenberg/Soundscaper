/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The milestone-5A-0b acceptance that no injected channel can satisfy: the
 * native helper is launched through Electron's real `utilityProcess`, loads the
 * verified addon in that separate process, and speaks contract v1 across the
 * genuine channel. The rendered audio is compared against the same addon loaded
 * directly in this process, so the proof is that identical pinned bytes produce
 * identical samples on both sides of a real process boundary.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { describeNativeAddonAvailability } from '../desktop/native-addon-payload.ts';
import {
	SYNTHETIC_ENGINE_MODES,
	SYNTHETIC_LOOPBACK_DEVICE_HANDLE,
} from '../desktop/native-helper-process.js';
import { validateHelperAudioDeviceOpenResult } from '../desktop/native-helper-results.ts';
import {
	DESKTOP_RUNTIME_PACKAGE_IMPORTS,
	compileDesktopProjectLibraryRuntime,
	stageDesktopApplicationSources,
} from '../scripts/lib/desktop-project-library-runtime.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ELECTRON = join(ROOT, 'node_modules/.bin/electron');
const SMOKE_PREFIX = 'NATIVE-HELPER-SMOKE ';
const BLOCK_FRAMES = 1_024;
const BLOCKS = 8;

test('the real-process harness terminates a helper that exceeds its protocol deadline', async () => {
	const source = await readFile(join(ROOT, 'tests/fixtures/native-helper-real-process-main.cjs'), 'utf8');
	assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?child\.kill\(\);[\s\S]*?settle\('timeout'\);/u);
});

test('the native helper runs the verified addon across a real Electron utility process', async (context) => {
	const availability = await describeNativeAddonAvailability({
		applicationRoot: ROOT,
		packaged: false,
		resourcesPath: '/unused',
	});
	if (availability.status !== 'available') {
		// A host whose target has no built payload cannot run this proof; the
		// audit already fails closed on a target that claims one and lacks it.
		context.skip(`no native addon payload for this host: ${availability.detail}`);
		return;
	}

	const temporaryRoot = await mkdtemp(join(tmpdir(), 'soundscaper-native-helper-'));
	context.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const applicationRoot = join(temporaryRoot, 'application');
	await compileDesktopProjectLibraryRuntime({ repositoryRoot: ROOT, outputRoot: join(temporaryRoot, 'runtime') });
	await stageDesktopApplicationSources({
		desktopSourceRoot: join(ROOT, 'desktop'),
		applicationDesktopRoot: join(applicationRoot, 'desktop'),
		runtimeRoot: join(temporaryRoot, 'runtime'),
	});
	await writeFile(join(applicationRoot, 'package.json'), `${JSON.stringify({
		name: 'soundscaper-native-helper-smoke',
		version: '0.0.0',
		private: true,
		type: 'module',
		main: 'native-helper-real-process-main.cjs',
		imports: DESKTOP_RUNTIME_PACKAGE_IMPORTS,
	}, null, '\t')}\n`);

	const plan = {
		helperModulePath: join(applicationRoot, 'desktop/native-helper-process.js'),
		addonPath: availability.descriptor.path,
		addonSha256: availability.descriptor.sha256,
		firstJobId: randomBytes(20).toString('hex'),
		secondJobId: randomBytes(20).toString('hex'),
		thirdJobId: randomBytes(20).toString('hex'),
		grant: {
			backend: 'synthetic',
			deviceHandle: SYNTHETIC_LOOPBACK_DEVICE_HANDLE,
			direction: 'duplex',
			mode: 'shared',
		},
		resourcePolicy: { maximumInputBytes: 1_024, maximumJobDurationMs: 30_000, maximumRssBytes: 512 * 1024 * 1024 },
		livenessHoldMs: 2_500,
		timeoutMs: 60_000,
	};

	// The harness runs from the staged application root, not the checkout: an
	// entry point inside the repository resolves `electron` to the npm wrapper
	// instead of Electron's built-in module, exactly as a packaged app would
	// not.
	await cp(
		join(ROOT, 'tests/fixtures/native-helper-real-process-main.cjs'),
		join(applicationRoot, 'native-helper-real-process-main.cjs'),
	);
	const run = await runElectron([
		applicationRoot,
		`--user-data-dir=${join(temporaryRoot, 'profile')}`,
		`--smoke-plan=${JSON.stringify(plan)}`,
	]);
	const lines = run.output.split(/\r?\n/u).filter((line) => line.startsWith(SMOKE_PREFIX));
	assert.equal(lines.length, 1, `the harness must emit exactly one result:\n${run.output}`);
	const observed = JSON.parse(lines[0].slice(SMOKE_PREFIX.length));
	assert.equal(observed.outcome, 'exit', `the helper must exit cleanly:\n${run.output}`);
	assert.equal(observed.exitCode, 0);
	assert.equal(observed.stage, 'shutdown');
	assert.equal(run.code, 0);

	const progress = observed.messages.filter(({ type }) => type === 'progress');
	const terminal = observed.messages.filter(({ type }) => type !== 'progress');
	assert.deepEqual(terminal.map(({ type }) => type), ['hello', 'result', 'cancelled', 'error']);
	const [hello, result, cancelled, refused] = terminal;
	assert.deepEqual(hello.kinds, ['audio-device']);
	assert.ok(observed.heartbeats >= 2,
		`the helper must keep reporting liveness across the real channel while idle (saw ${observed.heartbeats})`);

	const firstJobProgress = progress.filter(({ jobId }) => jobId === plan.firstJobId).map(({ value }) => value);
	assert.deepEqual(firstJobProgress, Array.from({ length: BLOCKS }, (_, index) => (index + 1) / BLOCKS));
	const cancelledJobProgress = progress.filter(({ jobId }) => jobId === plan.secondJobId);
	assert.ok(cancelledJobProgress.length >= 1, 'the cancelled job must have demonstrably started');
	assert.ok(cancelledJobProgress.length < BLOCKS,
		'a cancelled job must stop early rather than run to completion and be silently suppressed');
	assert.equal(progress.filter(({ jobId }) => jobId === plan.thirdJobId).length, 0);

	const admitted = validateHelperAudioDeviceOpenResult(result.result);
	assert.equal(result.jobId, plan.firstJobId);
	assert.equal(admitted.backend, 'synthetic');
	assert.equal(admitted.deviceHandle, SYNTHETIC_LOOPBACK_DEVICE_HANDLE);
	assert.equal(admitted.channelCount, 2);
	assert.equal(admitted.blockFrames, BLOCK_FRAMES);
	assert.equal(admitted.blocksRendered, BLOCKS);
	assert.equal(admitted.framesRendered, BLOCK_FRAMES * BLOCKS);
	assert.equal(admitted.addon.napiVersion, 8);
	assert.equal(admitted.renderedSha256, referenceRenderDigest(availability.descriptor.path));

	assert.equal(cancelled.jobId, plan.secondJobId);
	assert.equal(refused.jobId, plan.thirdJobId);
	assert.match(refused.error.message, /implements only the synthetic:loopback device/u);
});

/**
 * Recomputes the helper's answer with the same addon loaded here. A digest that
 * matches proves the bytes crossed the process boundary unaltered and produced
 * identical samples; nothing weaker distinguishes a real native run from a
 * plausible-looking stub.
 */
function referenceRenderDigest(addonPath) {
	const addon = createRequire(import.meta.url)(addonPath);
	const engine = addon.createSyntheticEngine({
		channelCount: 2,
		frameCount: BLOCK_FRAMES,
		sampleRate: 48_000,
		generation: 1,
		mode: SYNTHETIC_ENGINE_MODES.tone,
		fault: 0,
		gain: 1,
		faultFrame: 0,
	});
	const channels = [new Float32Array(BLOCK_FRAMES), new Float32Array(BLOCK_FRAMES)];
	const digest = createHash('sha256');
	for (let block = 0; block < BLOCKS; block += 1) {
		addon.renderSyntheticBlock(engine, block * BLOCK_FRAMES, BLOCK_FRAMES, null, channels);
		for (const channel of channels) {
			digest.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
		}
	}
	return digest.digest('hex');
}

function runElectron(argv) {
	return new Promise((settle, fail) => {
		const environment = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
		// A packaged build cannot run as plain Node — the RunAsNode fuse is off —
		// so the proof must not either, whatever the developer's shell exports.
		delete environment.ELECTRON_RUN_AS_NODE;
		// The subject here is the helper lifecycle, not the sandbox. Where the
		// kernel forbids unprivileged user namespaces — Ubuntu 24.04 with the
		// AppArmor restriction on, which is every GitHub runner — Chromium falls
		// back to the SUID helper and aborts on sight of a checkout's non-setuid
		// chrome-sandbox, before the helper is ever forked. The packaged sandbox
		// posture is proven where it belongs, in the packaging smokes that chown
		// and chmod the shipped binary and then assert it.
		const child = spawn(ELECTRON, ['--no-sandbox', ...argv], {
			cwd: ROOT,
			env: environment,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		child.stdout.on('data', (chunk) => { output += String(chunk); });
		child.stderr.on('data', (chunk) => { output += String(chunk); });
		child.once('error', fail);
		child.once('close', (code) => settle({ code, output }));
	});
}
