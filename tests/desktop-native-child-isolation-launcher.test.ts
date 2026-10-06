/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile, spawn as nodeSpawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import test from 'node:test';

import {
	createNativeChildIsolationLauncher,
	isEnforcedNativeChildLaunch,
	type NativeChildIsolationArtifactDescriptor,
} from '../desktop/native-child-isolation-launcher.ts';
import { bindNativeChildProcess } from '../desktop/native-child-framed-control.ts';
import { createSoundscaperProfessionalPluginPeer } from '../desktop/soundscaper-professional-plugin-peer.ts';
import { createNativeIsolationProbeFixture, FIXTURE_SOURCE } from './helpers/native-child-isolation-probe.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NATIVE_ROOT = join(ROOT, 'native/milestone-5-native-isolation-launcher');
const PROFILE_PATH = join(NATIVE_ROOT, 'profiles/linux-v1.json');
const BROKER_PATH = join(NATIVE_ROOT, 'profiles/linux-broker-v1.json');
const execFileAsync = promisify(execFile);
const probeFixture = createNativeIsolationProbeFixture();
test.after(() => { probeFixture.cleanup(); });

test('the Linux profile names its enforcement handshake without attestation language', async () => {
	const profile = await readFile(PROFILE_PATH, 'utf8');
	assert.match(profile, /"enforcementHandshake":"pre-exec-enforcement-pipe-v1"/u);
	assert.doesNotMatch(profile, /attest/iu);
});

test('caller-supplied review metadata cannot construct a native-child execution authority', () => {
	const artifact = Object.freeze({
		path: '/fixture/native-artifact', byteLength: 1, sha256: 'a'.repeat(64),
		identity: Object.freeze({ dev: 1, ino: 1 }),
	});
	assert.throws(() => createNativeChildIsolationLauncher({
		target: 'linux-x64', reviewedContract: Object.freeze({ status: 'authenticated' }),
		artifacts: { launcher: artifact, sandboxProfile: artifact, brokerPolicy: artifact },
	} as never), /unsupported fields/iu);
});

test('macOS rejects machine workloads whose peer has no pre-work Seatbelt bootstrap', () => {
	const artifact = Object.freeze({
		path: '/fixture/native-artifact', byteLength: 1, sha256: 'a'.repeat(64),
		identity: Object.freeze({ dev: 1, ino: 1 }),
	});
	assert.throws(() => createNativeChildIsolationLauncher({
		target: 'mac-arm64',
		machineWorkload: Object.freeze({ kind: 'media', payloads: [artifact], runtimeLibraries: [] }),
		artifacts: { launcher: artifact, sandboxProfile: artifact, brokerPolicy: artifact },
	}), /only the professional peer has an authenticated pre-work Seatbelt bootstrap/iu);
});

test('the professional peer accepts explicit empty entry arguments for a direct executable', () => {
	const executable = Object.freeze({
		path: '/fixture/professional-peer', byteLength: 1, sha256: 'a'.repeat(64),
		identity: Object.freeze({ dev: 1, ino: 1 }),
	});
	assert.doesNotThrow(() => createSoundscaperProfessionalPluginPeer({
		launcher: {} as never,
		peerExecutable: executable,
		entryExecutable: executable,
		entryArguments: [],
		runtimeReadExecute: [],
		pluginFormats: ['vst3'],
	}));
	assert.throws(() => createSoundscaperProfessionalPluginPeer({
		launcher: {} as never,
		peerExecutable: executable,
		entryExecutable: Object.freeze({ ...executable, path: '/fixture/dynamic-loader' }),
		entryArguments: [],
		runtimeReadExecute: [],
		pluginFormats: ['vst3'],
	}), /loader arguments are invalid/iu);
});

test('native-child completion preserves SIGKILL while normalizing its absent exit code', async () => {
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	const child = Object.assign(new EventEmitter(), {
		stdin: new PassThrough(), stdout, stderr,
		kill: () => true,
	}) as unknown as ChildProcess;
	const binding = bindNativeChildProcess(child, null);
	stdout.end('SOUNDSCAPER_CONTAINMENT_PROBE rss-ceiling pressure-started\n');
	stderr.end();
	child.emit('close', null, 'SIGKILL');
	assert.deepEqual(await binding.completion, {
		exitCode: 128, signal: 'SIGKILL',
		stdout: 'SOUNDSCAPER_CONTAINMENT_PROBE rss-ceiling pressure-started\n', stderr: '',
	});
});

test('Linux launches an exact child only after namespaces, Landlock, and seccomp are enforced', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const fixture = await buildFixture(context);
	const launcherPath = join(fixture.root, 'm5-native-isolation-launcher');
	await execFileAsync('cc', [
		'-std=c17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		join(NATIVE_ROOT, 'src/linux_launcher.c'), '-o', launcherPath,
	]);
	await chmod(launcherPath, 0o700);
	const [launcherArtifact, profile, broker, executable] = await Promise.all([
		descriptor(launcherPath), descriptor(PROFILE_PATH), descriptor(BROKER_PATH), descriptor(fixture.executable),
	]);
	const launcher = createNativeChildIsolationLauncher({
		target: 'linux-x64',
		machineWorkload: machineWorkload(executable),
		artifacts: { launcher: launcherArtifact, sandboxProfile: profile, brokerPolicy: broker },
	});
	assert.deepEqual(await launcher.machineReady(), {
		status: 'ready', target: 'linux-x64', launcherId: 'soundscaper-linux-landlock-seccomp-namespaces-v1',
	});
	await assert.rejects(launcher.launch({
		executable, workloadPayload: await descriptor(fixture.allowedPath), arguments: [],
		readOnly: [], readExecute: [], writeOnly: [], resourcePolicy: policy(), framedControl: null,
	}), /payload is outside its machine-authenticated workload/iu);
	const child = await launcher.launch({
		executable,
		arguments: [fixture.allowedPath, fixture.deniedPath],
		readOnly: [await pathGrant(fixture.allowedPath, 'file')],
		readExecute: [], writeOnly: [],
		resourcePolicy: policy(), framedControl: null,
	});
	assert.equal(isEnforcedNativeChildLaunch(child.enforcement), true);
	const result = await child.completion;
	assert.equal(result.exitCode, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), {
		allowed: 'admitted-body', deniedFilesystem: true, deniedNetwork: true,
		localSocketpair: true, deniedNonLocalSocketpair: true, deniedChild: true,
		pidNamespace: true, userNamespace: true,
	});
	const extra = await launcher.launch({
		executable, arguments: ['--extra-input'], readOnly: [], readExecute: [], writeOnly: [],
		resourcePolicy: policy(), framedControl: null, extraInput: Object.freeze({ childFd: 3 }),
	});
	assert.equal(extra.extraInput?.childFd, 3);
	extra.extraInput?.sink.end(Buffer.from('audio-prefix'));
	assert.deepEqual(JSON.parse((await extra.completion).stdout), {
		body: 'audio-prefix', inheritedArtifactsClosed: true,
	});
	const framed = await launcher.launch({
		executable, arguments: ['--frame-echo'], readOnly: [], readExecute: [], writeOnly: [],
		resourcePolicy: policy(), framedControl: Object.freeze({
			protocolFamily: 'M5F', protocolVersion: 1, maximumMessageBytes: 4096,
			maximumInFlightMessages: 1,
		}),
	});
	assert.ok(framed.control);
	await framed.control.send(Uint8Array.of(1, 3, 5, 7));
	assert.deepEqual(await framed.control.receive(), Uint8Array.of(1, 3, 5, 7));
	assert.equal((await framed.completion).exitCode, 0);
	for (const [mode, expected] of [
		['--frame-malformed', /invalid preamble/iu], ['--frame-oversize', /length is invalid/iu],
	] as const) {
		const hostile = await launcher.launch({
			executable, arguments: [mode], readOnly: [], readExecute: [], writeOnly: [],
			resourcePolicy: policy(), framedControl: frameBinding(),
		});
		await assert.rejects(hostile.completion, expected);
	}
	const unsolicited = await launcher.launch({
		executable, arguments: ['--frame-unsolicited'], readOnly: [], readExecute: [], writeOnly: [],
		resourcePolicy: policy(), framedControl: frameBinding(),
	});
	await unsolicited.control?.send(Uint8Array.of(1));
	await assert.rejects(unsolicited.completion, /unsolicited framed answer/iu);
	const noAnswer = await launcher.launch({
		executable, arguments: ['--frame-no-answer'], readOnly: [], readExecute: [], writeOnly: [],
		resourcePolicy: policy(), framedControl: frameBinding(),
	});
	assert.ok(noAnswer.control);
	await noAnswer.control.send(Uint8Array.of(1));
	await assert.rejects(noAnswer.control.send(Uint8Array.of(2)), /request window is exhausted/iu);
	noAnswer.kill('SIGKILL');
	await noAnswer.completion;
	for (const output of ['stdout', 'stderr']) {
		const hostile = await launcher.launch({
			executable, arguments: [`--overflow-${output}`], readOnly: [], readExecute: [], writeOnly: [],
			resourcePolicy: policy(), framedControl: null,
		});
		await assert.rejects(hostile.completion, new RegExp(`${output}.*oversized`, 'iu'));
	}
	for (const [mode, resourcePolicy] of [
		['--sleep', policy({ maximumJobDurationMs: 50 })],
		['--rss', policy({ maximumRssBytes: 8 * 1024 ** 2 })],
	] as const) {
		const hostile = await launcher.launch({
			executable, arguments: [mode], readOnly: [], readExecute: [], writeOnly: [], resourcePolicy,
			framedControl: null,
		});
		assert.equal((await hostile.completion).exitCode, 125);
	}
	await assert.rejects(execFileAsync(launcherPath, [
		'--enforcement-fd=3', '--enforcement-fd=4', '--profile-fd=5', '--broker-policy-fd=6',
		'--executable-fd=7', '--maximum-duration-ms=1000', '--maximum-rss-bytes=1048576',
		'--', 'child',
	]), (error: unknown) => (error as { code?: number }).code === 125);
});

test('artifact drift fails closed before a launcher process is spawned', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const fixture = await buildFixture(context);
	const launcherPath = fixture.executable;
	const [launcherArtifact, profile, broker] = await Promise.all([
		descriptor(launcherPath), descriptor(PROFILE_PATH), descriptor(BROKER_PATH),
	]);
	let spawns = 0;
	const launcher = createNativeChildIsolationLauncher({
		target: 'linux-x64',
		machineWorkload: machineWorkload(launcherArtifact),
		artifacts: {
			launcher: { ...launcherArtifact, sha256: '0'.repeat(64) },
			sandboxProfile: profile, brokerPolicy: broker,
		},
		spawn: ((..._arguments: never[]) => { spawns += 1; throw new Error('unreachable'); }) as never,
	});
	const machineAvailability = await launcher.machineReady();
	assert.equal(machineAvailability.status, 'unavailable');
	assert.match(machineAvailability.detail, /launcher.*(?:changed|digest)|containment/iu);
	await assert.rejects(launcher.launch({
		executable: launcherArtifact, arguments: [], readOnly: [], readExecute: [], writeOnly: [],
		resourcePolicy: policy(), framedControl: null,
	}), /machine-containment launcher is unavailable/iu);
	assert.equal(spawns, 0);
});

test('the professional plug-in RPC executes only in the enforced isolated child', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const fixture = await buildFixture(context);
	const launcherPath = join(fixture.root, 'm5-native-isolation-launcher');
	const peerPath = join(fixture.root, 'soundscaper-professional-peer');
	const stubPath = join(fixture.root, 'professional-host-stub.cpp');
	await writeFile(stubPath, await readFile(join(ROOT, 'tests/fixtures/soundscaper-professional-host-stub.cpp')));
	await Promise.all([
		execFileAsync('cc', [
			'-std=c17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
			join(NATIVE_ROOT, 'src/linux_launcher.c'), '-o', launcherPath,
		]),
			execFileAsync('c++', [
				'-std=c++20', '-static', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
				join(ROOT, 'native/soundscaper-professional-host/src/professional_host_peer.cpp'),
				join(ROOT, 'native/soundscaper-professional-host/src/professional_host_containment_probe.cpp'),
				stubPath,
			'-I', join(ROOT, 'native/soundscaper-professional-host/src'), '-o', peerPath,
		]),
	]);
	await Promise.all([chmod(launcherPath, 0o700), chmod(peerPath, 0o700)]);
	const cleanEof = spawnSync(peerPath, [], { encoding: 'utf8' });
	assert.equal(cleanEof.status, 0, cleanEof.stderr);
	const malformed = spawnSync(peerPath, [], { encoding: 'utf8', input: Buffer.from([0]) });
	assert.equal(malformed.status, 125, malformed.stderr);
	const truncatedBody = spawnSync(peerPath, [], {
		encoding: 'utf8', input: Buffer.from([0x4d, 0x35, 0x46, 0x32, 2, 0, 0, 0, 1]),
	});
	assert.equal(truncatedBody.status, 125, truncatedBody.stderr);
	const [launcherArtifact, profile, broker, peerExecutable] = await Promise.all([
		descriptor(launcherPath), descriptor(PROFILE_PATH), descriptor(BROKER_PATH), descriptor(peerPath),
	]);
	const launcher = createNativeChildIsolationLauncher({
		target: 'linux-x64', machineWorkload: machineWorkload(peerExecutable),
		artifacts: { launcher: launcherArtifact, sandboxProfile: profile, brokerPolicy: broker },
	});
	const plugin = createSoundscaperProfessionalPluginPeer({
		launcher, peerExecutable, runtimeReadExecute: [], pluginFormats: ['vst3'],
	});
	const pluginStat = await stat(fixture.allowedPath);
	const contextValue = Object.freeze({
		identity: Object.freeze({ dev: Number(pluginStat.dev), ino: Number(pluginStat.ino) }),
		byteLength: pluginStat.size,
		sha256: createHash('sha256').update(await readFile(fixture.allowedPath)).digest('hex'),
		resourcePolicy: Object.freeze({
			maximumInputBytes: 1024, maximumJobDurationMs: 5_000, maximumRssBytes: 128 * 1024 ** 2,
			allowNetwork: false as const, allowChildProcesses: false as const, allowOutputFiles: false as const,
		}),
	});
	const descriptions = await plugin.inspectPluginCandidate(fixture.allowedPath, 'vst3', contextValue);
	assert.deepEqual(descriptions.map(({ stableId }) => stableId), ['fixture:a', 'fixture:b']);
	const instance = await plugin.openPluginInstance(
		fixture.allowedPath, 48_000, 256, 'vst3', 'fixture:b', contextValue,
	);
	const input = [Float32Array.of(1, 2), Float32Array.of(3, 4)];
	const output = [new Float32Array(2), new Float32Array(2)];
	await plugin.processPluginBlock(instance, 2, input, output);
	assert.deepEqual(output.map((plane) => [...plane]), [[2, 4], [6, 8]]);
	assert.equal(await plugin.pluginLatencyFrames(instance), 32);
	assert.deepEqual(await plugin.pluginCapabilities(instance), {
		parameterCount: 1, hasVendorUi: true,
	});
	assert.deepEqual(await plugin.describePluginParameters(instance), [{
		index: 0, id: 'gain', name: 'Gain', label: '', defaultValue: 0.5,
		minimumValue: 0, maximumValue: 1, flags: 8,
	}]);
	assert.equal(await plugin.readPluginParameter(instance, 0), 0.5);
	assert.equal(await plugin.writePluginParameter(instance, 0, 0.75), 0.75);
	assert.equal(await plugin.readPluginParameter(instance, 0), 0.75);
	assert.deepEqual(await plugin.savePluginState(instance), Uint8Array.of(1, 2, 3));
	assert.equal(await plugin.loadPluginState(instance, Uint8Array.of(3, 2, 1)), true);
	const windowCapability = `window_01.${'a'.repeat(64)}`;
	assert.equal(await plugin.openPluginVendorWindow(instance, windowCapability), true);
	await assert.rejects(plugin.closePluginVendorWindow(instance, `window_02.${'b'.repeat(64)}`), /refused/iu);
	assert.equal(await plugin.closePluginVendorWindow(instance, windowCapability), true);
	assert.equal(await plugin.closePluginInstance(instance), true);
});

test('caller-supplied review metadata and an unverified launcher cannot mount execution', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const fixture = await buildFixture(context);
	const [launcherArtifact, profile, broker] = await Promise.all([
		descriptor(fixture.executable), descriptor(PROFILE_PATH), descriptor(BROKER_PATH),
	]);
	assert.throws(() => createNativeChildIsolationLauncher({
		target: 'linux-x64', reviewedContract: Object.freeze({ status: 'authenticated' }),
		artifacts: { launcher: launcherArtifact, sandboxProfile: profile, brokerPolicy: broker },
	} as never), /unsupported fields/iu);
	let childProcess: ChildProcess | null = null;
	let spawnedEnvironment: NodeJS.ProcessEnv | undefined;
	let killedBySignal = false;
	let closed!: () => void;
	const processClosed = new Promise<void>((resolve) => { closed = resolve; });
	const launcher = createNativeChildIsolationLauncher({
		target: 'linux-x64', machineWorkload: machineWorkload(launcherArtifact),
		artifacts: { launcher: launcherArtifact, sandboxProfile: profile, brokerPolicy: broker },
		enforcementTimeoutMs: 100,
		spawn: ((_command: string, _arguments: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
			spawnedEnvironment = options.env;
			childProcess = nodeSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
				stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
			});
			childProcess.once('close', closed);
			childProcess.once('exit', (_code, signal) => { killedBySignal = signal === 'SIGKILL'; });
			return childProcess;
		}) as never,
	});
	await assert.rejects(launcher.launch({
		executable: launcherArtifact, arguments: [], readOnly: [], readExecute: [], writeOnly: [],
		resourcePolicy: policy(), framedControl: null,
	}), /handshake timed out/iu);
	await processClosed;
	assert.equal(Object.hasOwn(spawnedEnvironment ?? {}, 'NODE_V8_COVERAGE'), true);
	assert.equal(spawnedEnvironment?.NODE_V8_COVERAGE, undefined);
	assert.equal(killedBySignal, true);
});

test('machine-authenticated containment is available from verified machine state', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const fixture = await buildFixture(context);
	const [launcherArtifact, profile, broker] = await Promise.all([
		descriptor(fixture.executable), descriptor(PROFILE_PATH), descriptor(BROKER_PATH),
	]);
	let spawns = 0;
	const launcher = createNativeChildIsolationLauncher({
		target: 'linux-x64',
		machineWorkload: Object.freeze({
			kind: 'soundscaper' as const,
			payloads: Object.freeze([launcherArtifact]),
			runtimeClosure: Object.freeze([]),
		}),
		artifacts: { launcher: launcherArtifact, sandboxProfile: profile, brokerPolicy: broker },
		spawn: ((..._arguments: never[]) => { spawns += 1; throw new Error('unreachable'); }) as never,
	});
	const machineAvailability = await launcher.machineReady();
	assert.deepEqual(machineAvailability, {
		status: 'ready', target: 'linux-x64',
		launcherId: 'soundscaper-linux-landlock-seccomp-namespaces-v1',
	});
	assert.equal(spawns, 0);
});

async function buildFixture(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'm5-native-isolation-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, 'sandbox-probe.c');
	const executable = join(root, 'sandbox-probe');
	const allowedPath = join(root, 'allowed.bin');
	const deniedPath = join(root, 'denied.bin');
	await Promise.all([
		writeFile(allowedPath, 'admitted-body'), writeFile(deniedPath, 'secret-body'),
		writeFile(source, FIXTURE_SOURCE),
	]);
	probeFixture.copyTo(executable);
	await chmod(executable, 0o700);
	return { root, executable, allowedPath, deniedPath };
}

async function descriptor(path: string): Promise<NativeChildIsolationArtifactDescriptor> {
	const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
	return Object.freeze({
		path: await realpath(path), byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
	});
}

async function pathGrant(path: string, kind: 'file' | 'directory') {
	const metadata = await stat(path);
	return Object.freeze({ path: await realpath(path), kind,
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }) });
}

function machineWorkload(
	payload: NativeChildIsolationArtifactDescriptor,
	runtimeClosure: readonly NativeChildIsolationArtifactDescriptor[] = [],
) {
	return Object.freeze({
		kind: 'soundscaper' as const,
		payloads: Object.freeze([payload]),
		runtimeClosure: Object.freeze([...runtimeClosure]),
	});
}

function policy(overrides: Partial<{ maximumJobDurationMs: number; maximumRssBytes: number }> = {}) {
	return Object.freeze({
		maximumJobDurationMs: overrides.maximumJobDurationMs ?? 5_000,
		maximumRssBytes: overrides.maximumRssBytes ?? 128 * 1024 ** 2,
	});
}

function frameBinding() {
	return Object.freeze({
		protocolFamily: 'M5F' as const, protocolVersion: 1 as const,
		maximumMessageBytes: 4096, maximumInFlightMessages: 1,
	});
}
