/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The hostile format fixtures, exercised end to end.
 *
 * The crash and hang fixtures exist so the supervision is proven against real
 * faults rather than against a simulation of one, which means something has to
 * actually run them: this drives the real scan runner, loading the real addon,
 * inspecting the real aborting and real hanging binaries, inside a real child
 * process supervised by the real `HelperSupervisor` and owned by the real
 * `DesktopPluginScanService`.
 *
 * Nothing here may wedge the run. The hanging fixture blocks its helper's JS
 * thread forever, so it is bounded by the supervisor's own heartbeat watchdog —
 * the machinery under test — and by a test timeout behind it, and every child
 * this file spawns is killed when its test ends whatever the outcome.
 */

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { HelperSupervisor } from '../desktop/helper-supervisor.ts';
import { describeNativeAddonAvailability } from '../desktop/native-addon-payload.ts';
import {
	DesktopPluginScanService,
	PLUGIN_SCAN_RESOURCE_POLICY,
} from '../desktop/plugin-scan-service.ts';
import {
	FIXTURE_PLUGIN_SUFFIX,
	fixturePluginDirectory,
} from '../scripts/lib/native-fixture-plugins.mjs';
import {
	nativeHelperAddonTargetForRuntime,
	readNativeHelperAddonSourceManifest,
} from '../scripts/lib/native-helper-addon-build.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const manifest = readNativeHelperAddonSourceManifest(ROOT);
const hostTarget = nativeHelperAddonTargetForRuntime(process.platform, process.arch);
const built = hostTarget !== null
	&& manifest.targets[hostTarget.id]?.status === 'built'
	&& manifest.fixturePlugins?.targets?.[hostTarget.id]?.status === 'built';

/** Fast enough that a wedged fixture is observed in seconds, slow enough that a
 * cold child loading the addon is not mistaken for one. */
const HEARTBEAT_INTERVAL_MS = 200;
const CRASH_DETECTION_MS = 8_000;
/**
 * The window a test uses when the watchdog is not the thing under test.
 *
 * A fixture that aborts blocks its own thread on the way there, so it misses
 * heartbeats until it dies. With one window shared by every case, whether an
 * abort was called a crash or a hang came down to whether a cold child — node,
 * tsx and the addon — reached the abort inside eight seconds, which on a loaded
 * machine it does not. That is a race between two of this file's own fixtures,
 * not a property of the supervisor, so the cases that are about what the exit
 * meant give the exit room to arrive and only the hang case keeps the short
 * window that makes the watchdog fire.
 */
const EXIT_CLASSIFICATION_CRASH_DETECTION_MS = 60_000;
const TEST_TIMEOUT_MS = 60_000;

const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

function harnessSource() {
	const helperModule = pathToFileURL(join(ROOT, 'desktop/native-helper-process.js')).href;
	const scanModule = pathToFileURL(join(ROOT, 'desktop/native-helper-scan-job.js')).href;
	return [
		'/* SPDX-License-Identifier: AGPL-3.0-only */',
		"import { createHash } from 'node:crypto';",
		"import { readFile } from 'node:fs/promises';",
		`import { createNativeHelperWorker, loadVerifiedNativeAddon } from '${helperModule}';`,
		`import { createNativePluginScanJobRunner } from '${scanModule}';`,
		'const config = JSON.parse(process.argv[2]);',
		'const hashFile = async (path) => {',
		'\tconst bytes = await readFile(path);',
		"\treturn { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };",
		'};',
		'const worker = createNativeHelperWorker({',
		"\trole: 'plugin-scanner',",
		'\tpost: (message) => process.send(message),',
		"\trunDeviceJob: () => { throw new Error('this helper serves plug-in scans only'); },",
		'\trunScanJob: createNativePluginScanJobRunner({',
		'\t\taddonPath: config.addonPath,',
		'\t\taddonSha256: config.addonSha256,',
		'\t\tloadAddon: loadVerifiedNativeAddon,',
		'\t\thashFile,',
		'\t}),',
		'\theartbeatIntervalMs: config.heartbeatIntervalMs,',
		'\texit: (code) => process.exit(code),',
		'});',
		"process.on('message', (message) => worker.handleMessage(message));",
		'',
	].join('\n');
}

/**
 * A scan root holding exactly the named fixtures. The hostile ones are copied
 * out of the pinned set rather than rebuilt, so what is inspected is the audited
 * binary and not a local approximation of it.
 */
async function stagedRoot(context, names) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-fixture-fault-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const source = fixturePluginDirectory(ROOT, hostTarget.id);
	for (const name of names) {
		await copyFile(
			join(source, `${name}${FIXTURE_PLUGIN_SUFFIX}`),
			join(root, `${name}${FIXTURE_PLUGIN_SUFFIX}`),
		);
	}
	return root;
}

/**
 * The real service over the real supervisor over a real forked helper. Only the
 * consent decision and the quarantine store are stand-ins, because both are
 * main-side records rather than anything the fault chain produces.
 */
async function supervisedScanRig(context, options) {
	const { rootPath, availability } = options;
	const harnessRoot = await mkdtemp(join(tmpdir(), 'soundscaper-fixture-helper-'));
	context.after(() => rm(harnessRoot, { recursive: true, force: true }));
	const harnessPath = join(harnessRoot, 'scan-helper.mjs');
	await writeFile(harnessPath, harnessSource());
	const config = JSON.stringify({
		addonPath: availability.descriptor.path,
		addonSha256: availability.descriptor.sha256,
		heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
	});

	const children = [];
	context.after(() => {
		for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
	});
	const spawnHelper = () => {
		const child = fork(harnessPath, [config], {
			cwd: harnessRoot,
			execArgv: ['--import', TSX_IMPORT],
			stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
		});
		const record = { child, exit: null, stderr: '' };
		child.stderr.on('data', (chunk) => { record.stderr += String(chunk); });
		child.stdout.on('data', () => undefined);
		child.once('exit', (code, signal) => { record.exit = { code, signal }; });
		children.push(record);
		return {
			postMessage: (message) => { if (child.connected) child.send(message); },
			onMessage: (listener) => child.on('message', listener),
			onExit: (listener) => child.once('exit', (code) => listener(code)),
			kill: () => child.kill('SIGKILL'),
		};
	};

	const supervisor = new HelperSupervisor({
		spawn: spawnHelper,
		verifyBinary: async () => undefined,
		mintJobId: () => randomBytes(20).toString('hex'),
		crashDetectionMs: options.crashDetectionMs ?? CRASH_DETECTION_MS,
	});
	context.after(() => supervisor.dispose());

	const identity = await stat(rootPath);
	const scanDigest = createHash('sha256').update(rootPath).digest('hex');
	const quarantined = [];
	const service = new DesktopPluginScanService({
		supervisor,
		consent: { isGranted: (format) => format === 'fixture' },
		quarantine: {
			isQuarantined: (digest) => quarantined.some((record) => record.digest === digest),
			quarantine: (digest, reason) => quarantined.push({ digest, reason }),
		},
		roots: {
			resolve: (rootId, format) => (rootId === 'fixtures' && format === 'fixture'
				? {
					path: rootPath,
					identity: { dev: Number(identity.dev), ino: Number(identity.ino) },
					scanDigest,
				}
				: null),
		},
		isEnabled: () => true,
		describePayload: async () => availability,
	});
	context.after(() => service.dispose());
	return { service, supervisor, quarantined, children, scanDigest };
}

async function hostAvailability(context) {
	const availability = await describeNativeAddonAvailability({
		applicationRoot: ROOT,
		packaged: false,
		resourcesPath: '/unused',
	});
	if (availability.status !== 'available') {
		context.skip(`no native addon payload for this host: ${availability.detail}`);
		return null;
	}
	return availability;
}

test('a fixture that really aborts mid-scan is contained and classified a scanner crash', {
	skip: !built,
	timeout: TEST_TIMEOUT_MS,
}, async (context) => {
	const availability = await hostAvailability(context);
	if (!availability) return;
	const rootPath = await stagedRoot(context, ['crash-on-scan']);
	const rig = await supervisedScanRig(context, {
		rootPath, availability, crashDetectionMs: EXIT_CLASSIFICATION_CRASH_DETECTION_MS,
	});

	const outcome = await rig.service.scanRoot({ owner: {}, rootId: 'fixtures', format: 'fixture' });

	assert.equal(outcome.status, 'failed');
	assert.equal(outcome.code, 'helper-failed');
	assert.deepEqual(outcome.fault, { reason: 'scanner-crash', quarantined: false },
		'the crash is named a scanner crash and charged to no binary the scan never got to name');
	assert.deepEqual(rig.quarantined, [], 'quarantine is keyed by the bytes that misbehaved, never by a folder');
	assert.equal(rig.children.length, 1, 'the scan must have run in exactly one supervised helper');
	const [helper] = rig.children;
	assert.ok(helper.exit, 'the aborting fixture must have taken its helper process down');
	assert.equal(helper.exit.signal, 'SIGABRT');
	assert.equal(rig.supervisor.snapshot().recentCrashes, 1);
	assert.equal(rig.supervisor.snapshot().quarantined, false,
		'one scanner crash must cost the scanned location its eligibility, not the whole scanner');
});

test('a fixture that really hangs mid-scan is killed by the heartbeat watchdog and classified a hang', {
	skip: !built,
	timeout: TEST_TIMEOUT_MS,
}, async (context) => {
	const availability = await hostAvailability(context);
	if (!availability) return;
	const rootPath = await stagedRoot(context, ['hang-on-scan']);
	const rig = await supervisedScanRig(context, { rootPath, availability });

	const started = Date.now();
	const outcome = await rig.service.scanRoot({ owner: {}, rootId: 'fixtures', format: 'fixture' });
	const elapsed = Date.now() - started;

	assert.equal(outcome.status, 'failed');
	assert.equal(outcome.code, 'helper-failed');
	assert.deepEqual(outcome.fault, { reason: 'scanner-hang', quarantined: false });
	assert.deepEqual(rig.quarantined, []);
	// The heartbeat watchdog is what gave up, not the job-duration ceiling: a
	// helper whose thread is gone would otherwise hold the scan for five minutes.
	assert.ok(elapsed < PLUGIN_SCAN_RESOURCE_POLICY.maximumJobDurationMs / 4,
		`a wedged scanner must be given up on inside its watchdog budget (took ${String(elapsed)}ms)`);
	const [helper] = rig.children;
	await once(helper.child, 'exit');
	assert.equal(helper.exit.signal, 'SIGKILL', 'the supervisor, not the fixture, must end a hung helper');
	assert.equal(rig.supervisor.snapshot().recentCrashes, 1);
});

test('one aborting candidate costs its healthy neighbours nothing at all', {
	skip: !built,
	timeout: TEST_TIMEOUT_MS,
}, async (context) => {
	const availability = await hostAvailability(context);
	if (!availability) return;
	const rootPath = await stagedRoot(context, ['clean-effect', 'crash-on-scan']);
	const rig = await supervisedScanRig(context, {
		rootPath, availability, crashDetectionMs: EXIT_CLASSIFICATION_CRASH_DETECTION_MS,
	});

	const outcome = await rig.service.scanRoot({ owner: {}, rootId: 'fixtures', format: 'fixture' });

	// The benign candidate beside it is published nowhere: a scan that dies has
	// no partial inventory, because the helper answers once or not at all.
	assert.equal(outcome.status, 'failed');
	assert.equal(outcome.code, 'helper-failed');
	assert.equal(outcome.scan, undefined);
	// Progress carries a ratio and nothing else, so the scan died naming no
	// binary. Quarantining the root instead would block rescans of every healthy
	// plug-in beside the hostile one, and the only exit — an explicit rescan —
	// would re-run the same root into the same abort.
	assert.deepEqual(outcome.fault, { reason: 'scanner-crash', quarantined: false });
	assert.deepEqual(rig.quarantined, [], 'the clean effect beside it keeps its eligibility');

	const again = await rig.service.scanRoot({ owner: {}, rootId: 'fixtures', format: 'fixture' });
	assert.equal(again.status, 'failed');
	assert.notEqual(again.code, 'digest-quarantined', 'the location was never durably withheld');
});

function once(emitter, event) {
	return new Promise((settle) => {
		if (emitter.exitCode !== null || emitter.signalCode !== null) {
			settle();
			return;
		}
		emitter.once(event, () => settle());
	});
}
