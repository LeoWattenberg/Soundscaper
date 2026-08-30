/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
	createNativeChildIsolationLauncher,
	type NativeChildIsolationArtifactDescriptor,
} from '../desktop/native-child-isolation-launcher.ts';
import {
	parseSoundscaperProfessionalLinuxLoaderList,
	resolveSoundscaperProfessionalLinuxSystemRuntime,
} from '../desktop/soundscaper-professional-linux-system-runtime.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NATIVE_ROOT = join(ROOT, 'native/milestone-5-native-isolation-launcher');
const PROFILE = join(NATIVE_ROOT, 'profiles/linux-v1.json');
const BROKER = join(NATIVE_ROOT, 'profiles/linux-broker-v1.json');
const execute = promisify(execFile);

test('the host loader inventory parser admits only reviewed absolute system libraries', () => {
	assert.deepEqual(parseSoundscaperProfessionalLinuxLoaderList([
		'linux-vdso.so.1 (0x00007ffc00000000)',
		'libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f0000000000)',
		'/lib64/ld-linux-x86-64.so.2 (0x00007f0000001000)',
	].join('\n'), 'linux-x64'), [
		{ name: 'ld-linux-x86-64.so.2', path: '/lib64/ld-linux-x86-64.so.2' },
		{ name: 'libc.so.6', path: '/lib/x86_64-linux-gnu/libc.so.6' },
	]);
	assert.throws(() => parseSoundscaperProfessionalLinuxLoaderList(
		'libcurl.so.4 => /lib/x86_64-linux-gnu/libcurl.so.4 (0x00007f0000000000)',
		'linux-x64',
	), /unreviewed system dependency/u);
	assert.throws(() => parseSoundscaperProfessionalLinuxLoaderList(
		'libc.so.6 => not found',
		'linux-x64',
	), /unavailable/u);
});

test('the host resolver rejects a packaged Linux runtime before loader inspection', async () => {
	const artifact = Object.freeze({
		path: '/professional-peer', byteLength: 1, sha256: '0'.repeat(64),
		identity: Object.freeze({ dev: 1, ino: 1 }),
	});
	let invokedPort = false;
	await assert.rejects(resolveSoundscaperProfessionalLinuxSystemRuntime({
		target: 'linux-x64', peer: artifact, runtimeClosure: [artifact],
	}, {
		readArtifact: async () => {
			invokedPort = true;
			return artifact;
		},
		run: () => {
			invokedPort = true;
			return { signal: null, status: 0, stdout: '', stderr: '' };
		},
	}), /packaged ELF runtime closure must be empty/u);
	assert.equal(invokedPort, false);
});

test('an authenticated host loader resolves only its exact runtime closure and denies a sibling file', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-loader-closure-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, 'source');
	await mkdir(source);
	const peer = join(source, 'soundscaper_professional_peer');
	const sibling = join(root, 'ungranted-sibling.so');
	const launcherPath = join(root, 'milestone5-native-isolation-launcher');
	await Promise.all([
		writeFile(join(root, 'peer.c'), PEER_SOURCE),
		writeFile(sibling, 'ungranted library bytes'),
	]);
	await execute('cc', [join(root, 'peer.c'), '-o', peer]);
	await execute('cc', ['-std=c17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		join(NATIVE_ROOT, 'src/linux_launcher.c'), '-o', launcherPath]);
	await Promise.all([chmod(peer, 0o700), chmod(launcherPath, 0o700)]);
	const [launcherArtifact, profile, broker, peerArtifact] = await Promise.all([
		descriptor(launcherPath), descriptor(PROFILE), descriptor(BROKER), descriptor(peer),
	]);
	const systemRuntime = await resolveSoundscaperProfessionalLinuxSystemRuntime({
		target: 'linux-x64', peer: peerArtifact,
	});
	assert.equal(systemRuntime.schemaVersion, 1);
	assert.equal(systemRuntime.policy, 'host-system-elf-runtime-v1');
	const launcher = createNativeChildIsolationLauncher({
		target: 'linux-x64',
		machineWorkload: Object.freeze({
			kind: 'soundscaper' as const,
			payloads: Object.freeze([peerArtifact]),
			runtimeClosure: systemRuntime.runtimeClosure,
		}),
		artifacts: { launcher: launcherArtifact, sandboxProfile: profile, brokerPolicy: broker },
	});
	const child = await launcher.launch({
		executable: systemRuntime.entryExecutable, workloadPayload: peerArtifact,
		arguments: [...systemRuntime.loaderArguments, peerArtifact.path, sibling],
		readOnly: [], readExecute: [], writeOnly: [], runtimeClosure: systemRuntime.runtimeClosure,
		resourcePolicy: { maximumJobDurationMs: 5_000, maximumRssBytes: 128 * 1024 ** 2 },
		framedControl: null,
	});
	const completion = await child.completion;
	assert.equal(completion.exitCode, 0, completion.stderr);
	assert.deepEqual(JSON.parse(completion.stdout), { marker: 42, deniedSibling: true });
});

async function descriptor(path: string): Promise<NativeChildIsolationArtifactDescriptor> {
	const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
	return Object.freeze({
		path: await realpath(path), byteLength: bytes.byteLength, sha256: hash(bytes),
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
	});
}

function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

const PEER_SOURCE = String.raw`
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>
int main(int argc, char **argv) {
	if (argc != 2) return 2;
	int sibling = open(argv[1], O_RDONLY | O_CLOEXEC);
	printf("{\"marker\":42,\"deniedSibling\":%s}\n",
		sibling < 0 && (errno == EACCES || errno == EPERM) ? "true" : "false");
	if (sibling >= 0) close(sibling);
	return 0;
}
`;
