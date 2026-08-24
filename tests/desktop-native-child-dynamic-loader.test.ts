/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
	createNativeChildIsolationLauncher,
	type NativeChildIsolationArtifactDescriptor,
} from '../desktop/native-child-isolation-launcher.ts';
import {
	soundscaperProfessionalRuntimeClosureSha256,
	verifySoundscaperProfessionalReadiness,
} from '../desktop/soundscaper-professional-native-readiness.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const NATIVE_ROOT = join(ROOT, 'native/milestone-5-native-isolation-launcher');
const PROFILE = join(NATIVE_ROOT, 'profiles/linux-v1.json');
const BROKER = join(NATIVE_ROOT, 'profiles/linux-broker-v1.json');
const execute = promisify(execFile);

test('an authenticated staged loader resolves only its exact runtime closure and denies a sibling library', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-loader-closure-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const runtime = join(root, 'runtime');
	await mkdir(runtime);
	const library = join(runtime, 'libreviewed.so');
	const peer = join(root, 'soundscaper_professional_peer');
	const sibling = join(root, 'ungranted-sibling.so');
	const launcherPath = join(root, 'milestone5-native-isolation-launcher');
	await Promise.all([
		writeFile(join(root, 'library.c'), 'int reviewed_marker(void) { return 42; }\n'),
		writeFile(join(root, 'peer.c'), PEER_SOURCE),
		writeFile(sibling, 'unreviewed library bytes'),
	]);
	await execute('cc', ['-shared', '-fPIC', join(root, 'library.c'), '-o', library]);
	await execute('cc', [join(root, 'peer.c'), '-L', runtime, '-lreviewed',
		'-Wl,-rpath,$ORIGIN/runtime', '-o', peer]);
	await execute('cc', ['-std=c17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
		join(NATIVE_ROOT, 'src/linux_launcher.c'), '-o', launcherPath]);
	await Promise.all([chmod(peer, 0o700), chmod(launcherPath, 0o700)]);
	const loader = await stageElfClosure(peer, runtime);
	const runtimeClosure = Object.freeze((await Promise.all((await directoryFiles(runtime)).map(descriptor)))
		.sort((left, right) => left.path.localeCompare(right.path)));
	const [launcherArtifact, profile, broker, peerArtifact, entryExecutable] = await Promise.all([
		descriptor(launcherPath), descriptor(PROFILE), descriptor(BROKER), descriptor(peer), descriptor(loader),
	]);
	const reviewed = await verifiedContract(
		launcherArtifact, profile, broker, peerArtifact, runtimeClosure,
	);
	const launcher = createNativeChildIsolationLauncher({
		target: 'linux-x64', reviewedContract: reviewed,
		artifacts: { launcher: launcherArtifact, sandboxProfile: profile, brokerPolicy: broker },
	});
	const child = await launcher.launch({
		executable: entryExecutable, reviewedPayload: peerArtifact,
		arguments: ['--library-path', runtime, peerArtifact.path, sibling],
		readOnly: [], readExecute: [], writeOnly: [], runtimeClosure,
		resourcePolicy: { maximumJobDurationMs: 5_000, maximumRssBytes: 128 * 1024 ** 2 },
		framedControl: null,
	});
	const completion = await child.completion;
	assert.equal(completion.exitCode, 0, completion.stderr);
	assert.deepEqual(JSON.parse(completion.stdout), { marker: 42, deniedSibling: true });
});

async function stageElfClosure(peer: string, runtime: string): Promise<string> {
	const [{ stdout: interpreterOutput }, { stdout: dependencies }] = await Promise.all([
		execute('readelf', ['-l', peer]), execute('ldd', [peer]),
	]);
	const interpreter = /Requesting program interpreter:\s*([^\]]+)/u.exec(interpreterOutput)?.[1];
	if (!interpreter) throw new Error('The fixture peer has no ELF interpreter.');
	const paths = new Set<string>([interpreter]);
	for (const line of dependencies.split('\n')) {
		for (const match of line.matchAll(/\/[^^\s()]+/gu)) {
			const path = match[0];
			try { await access(path); paths.add(path); } catch { /* virtual dependency */ }
		}
	}
	for (const path of paths) {
		const output = join(runtime, basename(path));
		if (await realpath(path) !== await realpath(output).catch(() => output)) await copyFile(path, output);
	}
	const loader = join(runtime, basename(interpreter));
	await chmod(loader, 0o700);
	return loader;
}

async function directoryFiles(path: string): Promise<string[]> {
	const { readdir } = await import('node:fs/promises');
	return (await readdir(path)).map((name) => join(path, name));
}

async function descriptor(path: string): Promise<NativeChildIsolationArtifactDescriptor> {
	const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
	return Object.freeze({
		path: await realpath(path), byteLength: bytes.byteLength, sha256: hash(bytes),
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
	});
}

async function verifiedContract(
	launcher: NativeChildIsolationArtifactDescriptor,
	profile: NativeChildIsolationArtifactDescriptor,
	broker: NativeChildIsolationArtifactDescriptor,
	peer: NativeChildIsolationArtifactDescriptor,
	runtimeClosure: readonly NativeChildIsolationArtifactDescriptor[],
) {
	const sourceAuthentication = Object.freeze({ schemaVersion: 1 });
	const evidence = Object.freeze({
		schemaVersion: 1, kind: 'soundscaper-professional-native-production-readiness', target: 'linux-x64',
		payload: Object.freeze({ byteLength: peer.byteLength, sha256: peer.sha256 }),
		sourceAuthenticationSha256: hash(Buffer.from('{"schemaVersion":1}')),
		toolchainIdentity: 'fixture-cc-1',
		buildProvenance: Object.freeze({ sourceRevision: 'a'.repeat(40), buildPlanSha256: 'b'.repeat(64),
			nativeHostTreeSha256: 'c'.repeat(64), helperAddonTreeSha256: 'd'.repeat(64) }),
		launcher: Object.freeze({
			schemaVersion: 1, target: 'linux-x64', launcherId: 'soundscaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: launcher.sha256, sandboxProfileSha256: profile.sha256,
			brokerPolicySha256: broker.sha256, peerPayloadSha256: peer.sha256,
			runtimeClosureSha256: soundscaperProfessionalRuntimeClosureSha256(runtimeClosure),
			filesystem: 'broker-grant-only', network: 'denied', childProcesses: 'denied',
			dynamicCode: 'admitted-plugin-only',
		}),
		osIsolationAttested: true, hostilePluginDenialAttested: true,
		realThirdPartyExecutionAttested: true, reviewedAt: '2026-08-24', reviewer: 'Fixture Reviewer',
	});
	const bytes = Buffer.from(JSON.stringify(evidence));
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	return verifySoundscaperProfessionalReadiness({
		schemaVersion: 1, status: 'reviewed', target: 'linux-x64',
		evidence: { path: 'native/soundscaper-professional-host/prebuilt/linux-x64/soundscaper-professional-native-readiness.json',
			byteLength: bytes.byteLength, sha256: hash(bytes) },
		signature: { algorithm: 'ed25519', reviewKeyId: 'fixture-review',
			valueBase64: sign(null, bytes, privateKey).toString('base64') },
	}, { target: 'linux-x64', payload: evidence.payload, sourceAuthentication,
		toolchainIdentity: evidence.toolchainIdentity }, {
		readEvidence: async () => bytes, resolveReviewPublicKey: async () => publicKey,
	});
}

function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

const PEER_SOURCE = String.raw`
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>
extern int reviewed_marker(void);
int main(int argc, char **argv) {
	if (argc != 2) return 2;
	int sibling = open(argv[1], O_RDONLY | O_CLOEXEC);
	printf("{\"marker\":%d,\"deniedSibling\":%s}\n", reviewed_marker(),
		sibling < 0 && (errno == EACCES || errno == EPERM) ? "true" : "false");
	if (sibling >= 0) close(sibling);
	return 0;
}
`;
