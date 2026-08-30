/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile, spawn as nodeSpawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
	createNativeChildIsolationLauncher,
	isEnforcedNativeChildLaunch,
	type NativeChildIsolationArtifactDescriptor,
} from '../desktop/native-child-isolation-launcher.ts';
import { createSoundscaperProfessionalPluginPeer } from '../desktop/soundscaper-professional-plugin-peer.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NATIVE_ROOT = join(ROOT, 'native/milestone-5-native-isolation-launcher');
const PROFILE_PATH = join(NATIVE_ROOT, 'profiles/linux-v1.json');
const BROKER_PATH = join(NATIVE_ROOT, 'profiles/linux-broker-v1.json');
const execFileAsync = promisify(execFile);

test('human review metadata cannot construct a native-child execution authority', () => {
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
			protocolVersion: 1, maximumMessageBytes: 4096, maximumInFlightMessages: 1,
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
		'--attestation-fd=3', '--attestation-fd=4', '--profile-fd=5', '--broker-policy-fd=6',
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

test('the professional plug-in RPC executes only in the attested isolated child', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const fixture = await buildFixture(context);
	const launcherPath = join(fixture.root, 'm5-native-isolation-launcher');
	const peerPath = join(fixture.root, 'soundscaper-professional-peer');
	const stubPath = join(fixture.root, 'professional-host-stub.cpp');
	await writeFile(stubPath, PROFESSIONAL_HOST_STUB);
	await Promise.all([
		execFileAsync('cc', [
			'-std=c17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
			join(NATIVE_ROOT, 'src/linux_launcher.c'), '-o', launcherPath,
		]),
		execFileAsync('c++', [
			'-std=c++20', '-static', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
			join(ROOT, 'native/soundscaper-professional-host/src/professional_host_peer.cpp'), stubPath,
			'-I', join(ROOT, 'native/soundscaper-professional-host/src'), '-o', peerPath,
		]),
	]);
	await Promise.all([chmod(launcherPath, 0o700), chmod(peerPath, 0o700)]);
	const cleanEof = spawnSync(peerPath, [], { encoding: 'utf8' });
	assert.equal(cleanEof.status, 0, cleanEof.stderr);
	const malformed = spawnSync(peerPath, [], { encoding: 'utf8', input: Buffer.from([0]) });
	assert.equal(malformed.status, 125, malformed.stderr);
	const truncatedBody = spawnSync(peerPath, [], {
		encoding: 'utf8', input: Buffer.from([0x4d, 0x35, 0x46, 0x31, 2, 0, 0, 0, 1]),
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
	assert.deepEqual(await plugin.savePluginState(instance), Uint8Array.of(1, 2, 3));
	assert.equal(await plugin.loadPluginState(instance, Uint8Array.of(3, 2, 1)), true);
	const windowCapability = `window_01.${'a'.repeat(64)}`;
	assert.equal(await plugin.openPluginVendorWindow(instance, windowCapability), true);
	await assert.rejects(plugin.closePluginVendorWindow(instance, `window_02.${'b'.repeat(64)}`), /refused/iu);
	assert.equal(await plugin.closePluginVendorWindow(instance, windowCapability), true);
	assert.equal(await plugin.closePluginInstance(instance), true);
});

test('human review metadata and a launcher that never attests cannot mount execution', {
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
	let killedBySignal = false;
	let closed!: () => void;
	const processClosed = new Promise<void>((resolve) => { closed = resolve; });
	const launcher = createNativeChildIsolationLauncher({
		target: 'linux-x64', machineWorkload: machineWorkload(launcherArtifact),
		artifacts: { launcher: launcherArtifact, sandboxProfile: profile, brokerPolicy: broker },
		enforcementTimeoutMs: 100,
		spawn: ((_command: string, _arguments: readonly string[], _options: unknown) => {
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
	assert.equal(killedBySignal, true);
});

test('machine-authenticated containment is available without a human release review', {
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
	await execFileAsync('cc', [
		'-std=c17', '-static', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror', source, '-o', executable,
	]);
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
	return Object.freeze({ protocolVersion: 1 as const, maximumMessageBytes: 4096, maximumInFlightMessages: 1 });
}

const FIXTURE_SOURCE = String.raw`#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static int exact_io(int fd, unsigned char *bytes, size_t length, int writing) {
	size_t offset = 0u;
	while (offset < length) {
		ssize_t count = writing ? write(fd, bytes + offset, length - offset) : read(fd, bytes + offset, length - offset);
		if (count <= 0) return 0;
		offset += (size_t)count;
	}
	return 1;
}

int main(int argc, char **argv) {
	if (argc == 2 && !strcmp(argv[1], "--extra-input")) {
		char bytes[32] = {0}; size_t offset = 0u;
		for (;;) {
			const ssize_t count = read(3, bytes + offset, sizeof(bytes) - 1u - offset);
			if (count < 0) return 28;
			if (count == 0) break;
			offset += (size_t)count;
			if (offset >= sizeof(bytes) - 1u) return 29;
		}
		int closed = 1;
		for (int fd = 4; fd < 64; ++fd) if (fcntl(fd, F_GETFD) >= 0 || errno != EBADF) closed = 0;
		printf("{\"body\":\"%s\",\"inheritedArtifactsClosed\":%s}\n", bytes, closed ? "true" : "false");
		return !strcmp(bytes, "audio-prefix") && closed ? 0 : 30;
	}
	if (argc == 2 && !strcmp(argv[1], "--frame-echo")) {
		unsigned char header[8];
		if (!exact_io(STDIN_FILENO, header, sizeof(header), 0) || memcmp(header, "M5F1", 4u) != 0) return 22;
		unsigned int length = (unsigned int)header[4] | ((unsigned int)header[5] << 8u)
			| ((unsigned int)header[6] << 16u) | ((unsigned int)header[7] << 24u);
		if (length == 0u || length > 4096u) return 23;
		unsigned char *body = malloc(length);
		if (body == NULL || !exact_io(STDIN_FILENO, body, length, 0)
			|| !exact_io(STDOUT_FILENO, header, sizeof(header), 1)
			|| !exact_io(STDOUT_FILENO, body, length, 1)) return 24;
		free(body); return 0;
	}
	if (argc == 2 && (!strcmp(argv[1], "--frame-malformed") || !strcmp(argv[1], "--frame-oversize"))) {
		unsigned char header[8] = {'M', '5', 'F', '1', 1, 0, 0, 0};
		if (!strcmp(argv[1], "--frame-malformed")) header[0] = 'X'; else { header[4] = 1; header[5] = 16; }
		if (!exact_io(STDOUT_FILENO, header, sizeof(header), 1)) return 25;
		for (;;) pause();
	}
	if (argc == 2 && (!strcmp(argv[1], "--frame-unsolicited") || !strcmp(argv[1], "--frame-no-answer"))) {
		unsigned char header[8], body[1];
		if (!exact_io(STDIN_FILENO, header, sizeof(header), 0)
			|| !exact_io(STDIN_FILENO, body, 1u, 0)) return 26;
		if (!strcmp(argv[1], "--frame-unsolicited")) {
			if (!exact_io(STDOUT_FILENO, header, sizeof(header), 1)
				|| !exact_io(STDOUT_FILENO, body, 1u, 1)
				|| !exact_io(STDOUT_FILENO, header, sizeof(header), 1)
				|| !exact_io(STDOUT_FILENO, body, 1u, 1)) return 27;
		}
		for (;;) pause();
	}
	if (argc == 2 && (!strcmp(argv[1], "--overflow-stdout") || !strcmp(argv[1], "--overflow-stderr"))) {
		char bytes[8192]; memset(bytes, 'x', sizeof(bytes));
		const int output = !strcmp(argv[1], "--overflow-stdout") ? STDOUT_FILENO : STDERR_FILENO;
		for (int index = 0; index < 256; ++index) if (write(output, bytes, sizeof(bytes)) < 0) return 20;
		for (;;) pause();
	}
	if (argc == 2 && !strcmp(argv[1], "--sleep")) for (;;) pause();
	if (argc == 2 && !strcmp(argv[1], "--rss")) {
		char *bytes = malloc(32u * 1024u * 1024u); if (bytes == NULL) return 21;
		for (size_t index = 0u; index < 32u * 1024u * 1024u; index += 4096u) bytes[index] = 1;
		for (;;) pause();
	}
	char body[32] = {0};
	if (argc != 3) return 10;
	int admitted = open(argv[1], O_RDONLY | O_CLOEXEC);
	if (admitted < 0 || read(admitted, body, sizeof(body) - 1u) < 1) return 11;
	close(admitted);
	int denied = open(argv[2], O_RDONLY | O_CLOEXEC);
	if (denied >= 0) { close(denied); return 12; }
	const int deniedFilesystem = errno == EACCES || errno == EPERM;
	int network = socket(AF_INET, SOCK_STREAM, 0);
	if (network >= 0) { close(network); return 13; }
	const int deniedNetwork = errno == EPERM;
	int local[2] = {-1, -1};
	if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, local) != 0) return 17;
	const int localSocketpair = close(local[0]) == 0 && close(local[1]) == 0;
	int nonLocal[2] = {-1, -1};
	if (socketpair(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0, nonLocal) == 0) return 18;
	const int deniedNonLocalSocketpair = errno == EPERM;
	pid_t child = fork();
	if (child == 0) _exit(14);
	if (child > 0) { waitpid(child, NULL, 0); return 15; }
	const int deniedChild = errno == EPERM;
	printf("{\"allowed\":\"%s\",\"deniedFilesystem\":%s,\"deniedNetwork\":%s,"
		"\"localSocketpair\":%s,\"deniedNonLocalSocketpair\":%s,"
		"\"deniedChild\":%s,\"pidNamespace\":%s,\"userNamespace\":%s}\n",
		body, deniedFilesystem ? "true" : "false", deniedNetwork ? "true" : "false",
		localSocketpair ? "true" : "false", deniedNonLocalSocketpair ? "true" : "false",
		deniedChild ? "true" : "false",
		getpid() == 1 ? "true" : "false",
		geteuid() == 0 ? "true" : "false");
	return deniedFilesystem && deniedNetwork && localSocketpair && deniedNonLocalSocketpair && deniedChild
		&& getpid() == 1 && geteuid() == 0 ? 0 : 16;
}
`;

const PROFESSIONAL_HOST_STUB = String.raw`#include "professional_host_api.h"
#include <algorithm>
#include <cstring>

struct soundscaper_pro_plugin_instance { int selected; const char *window; };
struct soundscaper_pro_audio_session {};

static void text(char *output, size_t length, const char *value) {
	std::strncpy(output, value, length - 1u);
}

extern "C" soundscaper_pro_status soundscaper_pro_plugin_scan(
	const char *format, const char *, soundscaper_pro_plugin_description *values,
	size_t capacity, size_t *written) {
	if (std::strcmp(format, "vst3") != 0 || written == nullptr) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	*written = 2u;
	if (values == nullptr || capacity == 0u) return SOUNDSCAPER_PRO_OK;
	if (capacity < 2u) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
	for (size_t index = 0u; index < 2u; ++index) {
		values[index] = {}; values[index].status = SOUNDSCAPER_PRO_OK;
		text(values[index].format, sizeof(values[index].format), "vst3");
		text(values[index].stable_id, sizeof(values[index].stable_id), index == 0u ? "fixture:a" : "fixture:b");
		text(values[index].name, sizeof(values[index].name), index == 0u ? "Fixture A" : "Fixture B");
		text(values[index].vendor, sizeof(values[index].vendor), "Soundscaper");
		text(values[index].version, sizeof(values[index].version), "1.0.0");
		values[index].input_channels = 2u; values[index].output_channels = 2u; values[index].latency_frames = 32u;
	}
	return SOUNDSCAPER_PRO_OK;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_open(
	const char *, const char *, const char *stable, double, uint32_t,
	soundscaper_pro_plugin_instance **instance) {
	if (std::strcmp(stable, "fixture:b") != 0) return SOUNDSCAPER_PRO_PLUGIN_UNREADABLE;
	*instance = new soundscaper_pro_plugin_instance{2, nullptr}; return SOUNDSCAPER_PRO_OK;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_process(
	soundscaper_pro_plugin_instance *, const float *const *input, uint32_t inputs,
	float **output, uint32_t outputs, uint32_t frames) {
	if (inputs != 2u || outputs != 2u) return SOUNDSCAPER_PRO_PLUGIN_MALFORMED;
	for (uint32_t channel = 0u; channel < outputs; ++channel)
		for (uint32_t frame = 0u; frame < frames; ++frame) output[channel][frame] = input[channel][frame] * 2.0f;
	return SOUNDSCAPER_PRO_OK;
}
extern "C" uint32_t soundscaper_pro_plugin_latency(soundscaper_pro_plugin_instance *) { return 32u; }
extern "C" soundscaper_pro_status soundscaper_pro_plugin_save_state(
	soundscaper_pro_plugin_instance *, uint8_t *bytes, size_t capacity, size_t *written) {
	*written = 3u; if (bytes == nullptr || capacity == 0u) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	if (capacity < 3u) return SOUNDSCAPER_PRO_STATE_TOO_LARGE;
	bytes[0] = 1u; bytes[1] = 2u; bytes[2] = 3u; return SOUNDSCAPER_PRO_OK;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_load_state(
	soundscaper_pro_plugin_instance *, const uint8_t *bytes, size_t length) {
	return length == 3u && bytes[0] == 3u ? SOUNDSCAPER_PRO_OK : SOUNDSCAPER_PRO_STATE_REJECTED;
}
extern "C" soundscaper_pro_status soundscaper_pro_plugin_open_vendor_window(
	soundscaper_pro_plugin_instance *instance, const char *capability) {
	if (instance == nullptr || capability == nullptr) return SOUNDSCAPER_PRO_UNSUPPORTED;
	instance->window = capability; return SOUNDSCAPER_PRO_OK;
}
extern "C" void soundscaper_pro_plugin_close_vendor_window(soundscaper_pro_plugin_instance *instance) {
	if (instance != nullptr) instance->window = nullptr;
}
extern "C" void soundscaper_pro_plugin_close(soundscaper_pro_plugin_instance *instance) { delete instance; }
namespace soundscaper { void shutdownJuceMessageDispatcher() {} }
`;
