/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	SOUNDSCAPER_DELIVERY_RESTART_CRASH_EXIT_CODE,
	SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX,
	SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX,
	createSoundscaperDeliveryRestartSmokePlan,
	decodeSoundscaperDeliveryRestartSmokePlan,
	encodeSoundscaperDeliveryRestartSmokePlan,
	runSoundscaperDeliveryRestartPublicationSmoke,
	soundscaperDeliveryRestartSmokeOutputRoot,
} from '../desktop/soundscaper-delivery-restart-smoke.mjs';
import {
	runDesktopSoundscaperDeliveryRestartPublicationSmoke,
} from '../scripts/lib/desktop-soundscaper-delivery-restart-smoke.mjs';

const TOKEN = '7a'.repeat(16);
const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
const SHA256 = createHash('sha256').update(BYTES).digest('hex');

test('the restart smoke plan is a closed, Soundscaper-only two-stage protocol', () => {
	for (const stage of ['interrupt-publication', 'recover-publication']) {
		const plan = createSoundscaperDeliveryRestartSmokePlan({ stage, token: TOKEN });
		assert.deepEqual(decodeSoundscaperDeliveryRestartSmokePlan(
			encodeSoundscaperDeliveryRestartSmokePlan(plan),
		), plan);
		assert.equal(plan.productId, 'soundscaper');
		assert.equal(Object.isFrozen(plan), true);
	}
	assert.throws(
		() => decodeSoundscaperDeliveryRestartSmokePlan(Buffer.from(JSON.stringify({
			schemaVersion: 1, mode: 'soundscaper-delivery-restart-publication',
			productId: 'soundscaper', stage: 'recover-publication', token: TOKEN, path: '/tmp/escape',
		})).toString('base64url')),
		/unsupported|closed|fields/iu,
	);
});

test('the packaged restart smoke has one canonical npm entry point', async () => {
	const metadata = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
	assert.equal(
		metadata.scripts['desktop:smoke:persistent-delivery-restart'],
		'node scripts/desktop-soundscaper-delivery-restart-smoke.mjs',
	);
});

test('the packaged interrupt stage exits only at the post-link publication fence', async (context) => {
	const userDataPath = await fixtureRoot(context);
	const calls = [];
	const crash = new Error('simulated abrupt process exit');
	const plan = createSoundscaperDeliveryRestartSmokePlan({
		stage: 'interrupt-publication', token: TOKEN,
	});
	const runtime = fakeRuntime({
		async startService(options) {
			calls.push(['start', options.databasePath]);
			return {
				authorizeRoot: async (path) => { calls.push(['authorize', path]); return { grantId: '11'.repeat(24) }; },
				enqueue: async () => ({ jobId: '22'.repeat(24) }),
				claimNext: async () => ({ claimId: '33'.repeat(24) }),
				beginWrite: async () => ({ writeId: '44'.repeat(24) }),
				writeChunk: async ({ bytes }) => { calls.push(['write', [...bytes]]); },
				finishWrite: async () => ({ byteLength: BYTES.byteLength }),
				complete: async () => { options.beforeFileFence('publication-ready'); options.beforeFileFence('publication-link'); },
			};
		},
	});
	await assert.rejects(runSoundscaperDeliveryRestartPublicationSmoke({
		argv: [`${SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX}${encodeSoundscaperDeliveryRestartSmokePlan(plan)}`],
		packaged: true,
		productId: 'soundscaper',
		userDataPath,
		runtime,
		outputBytes: BYTES,
		crashProcess(code) {
			assert.equal(code, SOUNDSCAPER_DELIVERY_RESTART_CRASH_EXIT_CODE);
			calls.push(['crash', code]);
			throw crash;
		},
		log() {},
	}), (error) => error === crash);
	assert.deepEqual(calls.at(-1), ['crash', SOUNDSCAPER_DELIVERY_RESTART_CRASH_EXIT_CODE]);
	assert.equal(calls.filter(([operation]) => operation === 'crash').length, 1);
	assert.deepEqual(calls.find(([operation]) => operation === 'write')?.[1], [...BYTES]);
});

test('the recovery stage authenticates the persisted report, exact bytes, and retired partial', async (context) => {
	const userDataPath = await fixtureRoot(context);
	const outputRoot = soundscaperDeliveryRestartSmokeOutputRoot(userDataPath, TOKEN);
	await mkdir(outputRoot, { recursive: true });
	await writeFile(join(outputRoot, 'restart-master.wav'), BYTES);
	const summary = completedSummary();
	const logs = [];
	const plan = createSoundscaperDeliveryRestartSmokePlan({
		stage: 'recover-publication', token: TOKEN,
	});
	const handled = await runSoundscaperDeliveryRestartPublicationSmoke({
		argv: [`${SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX}${encodeSoundscaperDeliveryRestartSmokePlan(plan)}`],
		packaged: true,
		productId: 'soundscaper',
		userDataPath,
		outputBytes: BYTES,
		runtime: fakeRuntime({
			startService: async () => ({
				list: () => ({ entries: [summary], paused: false, nextCursor: null }),
				close: async () => undefined,
			}),
		}),
		log: (line) => logs.push(line),
	});
	assert.equal(handled, true);
	assert.equal(logs.length, 1);
	assert(logs[0].startsWith(SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX));
	const evidence = JSON.parse(logs[0].slice(SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX.length));
	assert.deepEqual(evidence.publication, summary.result.publication);
	assert.equal(evidence.state, 'completed');
	assert.equal(evidence.attempt, 1);
	assert.equal(evidence.recoveredPreparedJournal, true);
	assert.deepEqual(evidence.visibleFiles, ['restart-master.wav']);
	assert.equal(evidence.persistedReport, true);
	assert.deepEqual([...await readFile(join(outputRoot, 'restart-master.wav'))], [...BYTES]);
});

test('the outer packaged smoke binds both launches to one profile and requires the crash exit', async (context) => {
	const profileRoot = await fixtureRoot(context, 'soundscaper-delivery-restart-');
	const invocations = [];
	const result = await runDesktopSoundscaperDeliveryRestartPublicationSmoke({
		repositoryRoot: resolve('.'),
		arch: 'x64',
		platform: 'linux',
		environment: { SOUNDSCAPER_SMOKE_XVFB: 'true' },
		token: TOKEN,
		createProfile: async () => profileRoot,
		findExecutable: async () => '/packaged/soundscaper',
		removeProfile: async () => undefined,
		async runChild(command, args) {
			assert.equal(command, 'xvfb-run');
			const appArgs = args.slice(2);
			const encoded = appArgs.find((value) => value.startsWith(
				SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX,
			)).slice(SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX.length);
			const plan = decodeSoundscaperDeliveryRestartSmokePlan(encoded);
			invocations.push({ appArgs, plan });
			const outputRoot = soundscaperDeliveryRestartSmokeOutputRoot(profileRoot, TOKEN);
			await mkdir(outputRoot, { recursive: true });
			if (plan.stage === 'interrupt-publication') {
				await writeFile(join(outputRoot, 'restart-master.wav'), BYTES);
				return { code: SOUNDSCAPER_DELIVERY_RESTART_CRASH_EXIT_CODE, stdout: '', stderr: '' };
			}
			const evidence = recoveryEvidence();
			return {
				code: 0,
				stdout: `${SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX}${JSON.stringify(evidence)}\n`,
				stderr: '',
			};
		},
	});
	assert.deepEqual(invocations.map(({ plan }) => plan.stage), [
		'interrupt-publication', 'recover-publication',
	]);
	assert(invocations.every(({ appArgs }) => appArgs.includes(`--user-data-dir=${profileRoot}`)));
	assert.deepEqual(result, recoveryEvidence());
});

test('the real delivery service recovers a prepared publication across abrupt Node processes', async (context) => {
	const userDataPath = await fixtureRoot(context);
	const runStage = async (stage) => {
		const plan = createSoundscaperDeliveryRestartSmokePlan({ stage, token: TOKEN });
		return runRealServiceChild({
			request: `${SOUNDSCAPER_DELIVERY_RESTART_SMOKE_ARGUMENT_PREFIX}${encodeSoundscaperDeliveryRestartSmokePlan(plan)}`,
			userDataPath,
		});
	};
	const interrupted = await runStage('interrupt-publication');
	assert.equal(interrupted.code, SOUNDSCAPER_DELIVERY_RESTART_CRASH_EXIT_CODE, interrupted.stderr);
	const outputRoot = soundscaperDeliveryRestartSmokeOutputRoot(userDataPath, TOKEN);
	assert.deepEqual(
		(await import('node:fs/promises').then(({ readdir }) => readdir(outputRoot))).sort(),
		['restart-master.wav'],
	);
	const recovered = await runStage('recover-publication');
	assert.equal(recovered.code, 0, recovered.stderr);
	const marker = recovered.stdout.split(/\r?\n/u).find((line) => line.startsWith(
		SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX,
	));
	assert(marker, recovered.stdout);
	const evidence = JSON.parse(marker.slice(SOUNDSCAPER_DELIVERY_RESTART_SMOKE_PREFIX.length));
	assert.equal(evidence.state, 'completed');
	assert.equal(evidence.recoveredPreparedJournal, true);
	assert.deepEqual(evidence.visibleFiles, ['restart-master.wav']);
});

function fakeRuntime(overrides) {
	return {
		createDescription: ({ destinationGrantId, plan, projectIdentity }) => ({
			destinationGrantId, planFingerprint: 'aa'.repeat(32), plan, projectIdentity,
		}),
		createPlan: (value) => value,
		...overrides,
	};
}

function completedSummary() {
	return {
		state: 'completed', attempt: 1, lastFailureCode: null,
		result: {
			publication: { fileName: 'restart-master.wav', byteLength: BYTES.byteLength, sha256: SHA256 },
			report: {
				schemaVersion: 1, format: 'delivery', direction: 'export',
				subject: { format: 'wav', container: 'riff', codec: 'pcm-s16le', sampleRate: 48_000,
					channelCount: 1, lossless: true },
				items: [], counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 },
			},
		},
	};
}

function recoveryEvidence() {
	return {
		schemaVersion: 1,
		mode: 'soundscaper-delivery-restart-publication',
		productId: 'soundscaper',
		token: TOKEN,
		state: 'completed',
		attempt: 1,
		recoveredPreparedJournal: true,
		persistedReport: true,
		publication: completedSummary().result.publication,
		visibleFiles: ['restart-master.wav'],
	};
}

async function fixtureRoot(context, prefix = 'delivery-restart-test-') {
	const root = await mkdtemp(join(tmpdir(), prefix));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

function runRealServiceChild({ request, userDataPath }) {
	const source = `
		import { runSoundscaperDeliveryRestartPublicationSmoke } from './desktop/soundscaper-delivery-restart-smoke.mjs';
		import { SOUNDSCAPER_DELIVERY_DATABASE_FILE_NAME } from './desktop/soundscaper-delivery-database.ts';
		import { SoundscaperDeliveryService } from './desktop/soundscaper-delivery-service.ts';
		import { createSoundscaperDeliveryFilesystemFixture } from './tests/helpers/soundscaper-delivery-filesystem-fixture.ts';
		import { createSoundscaperDeliveryDescriptionV1 } from './src/common/editor/soundscaper-delivery-contract-v1.ts';
		import { createSoundscaperPersistentAudioDeliveryPlanV1 } from './src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
		const runtime = {
			databaseFileName: SOUNDSCAPER_DELIVERY_DATABASE_FILE_NAME,
			startService: (options) => SoundscaperDeliveryService.start({
				...options,
				filesystem: createSoundscaperDeliveryFilesystemFixture(
					process.env.SOUNDSCAPER_RESTART_PRIVATE_STAGING,
				),
			}),
			createDescription: createSoundscaperDeliveryDescriptionV1,
			createPlan: createSoundscaperPersistentAudioDeliveryPlanV1,
		};
		await runSoundscaperDeliveryRestartPublicationSmoke({
			argv: [process.env.SOUNDSCAPER_RESTART_REQUEST], packaged: true,
			productId: 'soundscaper', userDataPath: process.env.SOUNDSCAPER_RESTART_USER_DATA,
			runtime, log: console.log, crashProcess: (code) => process.exit(code),
		});
	`;
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
			cwd: resolve('.'),
			env: {
				...process.env,
				SOUNDSCAPER_RESTART_REQUEST: request,
				SOUNDSCAPER_RESTART_USER_DATA: userDataPath,
				SOUNDSCAPER_RESTART_PRIVATE_STAGING: join(userDataPath, 'private-staging'),
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => { stdout += String(chunk); });
		child.stderr.on('data', (chunk) => { stderr += String(chunk); });
		child.once('error', reject);
		child.once('close', (code, signal) => {
			if (signal) reject(new Error(`Persistent delivery service test child exited with ${signal}.`));
			else resolvePromise({ code, stdout, stderr });
		});
	});
}
