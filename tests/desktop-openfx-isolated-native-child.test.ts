/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
	access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import type {
	FramescaperOpenFxExecutableDescriptor,
	FramescaperOpenFxHostDescriptor,
} from '../desktop/framescaper-openfx-host-payload.ts';
import { createIsolatedOpenFxNativeChildAuthority } from '../desktop/openfx-isolated-native-child.ts';
import { verifyOpenFxProductionReadiness } from '../desktop/openfx-production-readiness.ts';

const ROOT = resolve(import.meta.dirname, '..');
const NATIVE_ROOT = join(ROOT, 'native/milestone-5-native-isolation-launcher');
const PROFILE = join(NATIVE_ROOT, 'profiles/linux-v1.json');
const BROKER = join(NATIVE_ROOT, 'profiles/linux-broker-v1.json');
const execFileAsync = promisify(execFile);

test('the actual OpenFX scanner child executes only the one signed-and-granted plug-in', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'openfx-isolated-child-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const launcherPath = join(root, 'm5-native-isolation-launcher');
	const scannerPath = join(root, 'scanner');
	const runtimePath = join(root, 'runtime');
	const runtimeRoot = join(root, 'runtime-libraries');
	const bundleRoot = join(root, 'Effect.ofx.bundle');
	const sourcePath = join(root, 'scanner.c');
	const admittedPath = join(bundleRoot, 'admitted.ofx');
	const siblingPath = join(bundleRoot, 'sibling.ofx');
	const resourcePath = join(bundleRoot, 'preset.json');
	await Promise.all([mkdir(runtimeRoot), mkdir(bundleRoot)]);
	await Promise.all([
		writeFile(sourcePath, HOST_SOURCE),
		writeFile(join(root, 'admitted.c'), 'int openfx_marker(void) { return 42; }\n'),
		writeFile(join(root, 'sibling.c'), 'int openfx_marker(void) { return 7; }\n'),
		writeFile(resourcePath, '{"gain":1}\n'),
		execFileAsync('cc', [
			'-std=c17', '-O2', '-Wall', '-Wextra', '-Werror',
			join(NATIVE_ROOT, 'src/linux_launcher.c'), '-o', launcherPath,
		]),
	]);
	await execFileAsync('cc', [
		'-std=c17', '-O2', '-Wall', '-Wextra', '-Werror', sourcePath, '-ldl', '-o', scannerPath,
	]);
	await Promise.all([
		execFileAsync('cc', ['-shared', '-fPIC', join(root, 'admitted.c'), '-o', admittedPath]),
		execFileAsync('cc', ['-shared', '-fPIC', join(root, 'sibling.c'), '-o', siblingPath]),
	]);
	await copyFile(scannerPath, runtimePath);
	await stageElfClosure(scannerPath, runtimeRoot);
	await Promise.all([
		chmod(launcherPath, 0o700), chmod(scannerPath, 0o700), chmod(runtimePath, 0o700),
		chmod(admittedPath, 0o700), chmod(siblingPath, 0o700),
	]);
	const runtimeLibraries = Object.freeze((await Promise.all(
		(await readdir(runtimeRoot)).map((name) => descriptor(join(runtimeRoot, name))),
	)).sort((left, right) => left.path.localeCompare(right.path)));
	const [launcher, sandboxProfile, brokerPolicy, scanner, runtimeHost, plugin] = await Promise.all([
		descriptor(launcherPath), descriptor(PROFILE), descriptor(BROKER), descriptor(scannerPath),
		descriptor(runtimePath), descriptor(admittedPath),
	]);
	const productionReadiness = await signedReadiness({
		launcher, sandboxProfile, brokerPolicy, scanner, runtimeHost, runtimeLibraries,
	});
	const descriptorValue: FramescaperOpenFxHostDescriptor = Object.freeze({
		target: 'linux-x64', runtime: 'linux-x64', hostVersion: '1.0.0',
		openfxVersion: '1.5.1', openfxCommit: 'ab77951', scanner, runtimeHost,
		isolation: Object.freeze({ launcher, sandboxProfile, brokerPolicy, runtimeLibraries }),
		productionReadiness,
	});
	const authority = createIsolatedOpenFxNativeChildAuthority(descriptorValue);
	assert.equal((await authority.productionReady()).status, 'ready');
	const result = await authority.invoke({
		executablePath: scanner.path,
		arguments: ['--scan', plugin.path, '--sha256', plugin.sha256],
	}, {
		plugin: await pathGrant(plugin.path),
		pluginResources: [await pathGrant(resourcePath)], pluginRuntime: [],
		readOnly: [], writeOnly: [],
	}).completion;
	assert.equal(result.exitCode, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), { admittedResult: 42, siblingDenied: true });
	assert.throws(() => createIsolatedOpenFxNativeChildAuthority({
		...descriptorValue,
		scanner: Object.freeze({ ...scanner, sha256: 'ff'.repeat(32) }),
	}), /differ.*signed readiness/iu);
	assert.throws(() => createIsolatedOpenFxNativeChildAuthority({
		...descriptorValue, productionReadiness: structuredClone(productionReadiness),
	}), /branded.*Ed25519/iu);
});

test('the isolated runtime admits the Interact invocation form without write authority', {
	skip: process.platform !== 'linux' || process.arch !== 'x64',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'openfx-interact-authority-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const launcherPath = join(root, 'm5-native-isolation-launcher');
	const scannerPath = join(root, 'scanner');
	const runtimePath = join(root, 'runtime');
	const runtimeRoot = join(root, 'runtime-libraries');
	const loaderPath = join(runtimeRoot, 'ld-linux-x86-64.so.2');
	const pluginPath = join(root, 'admitted.ofx');
	const grantPath = join(root, 'interact-v1-grant.json');
	await mkdir(runtimeRoot);
	// Authority admission is synchronous and precedes any spawn, so plain
	// placeholder bytes are enough: nothing here may actually launch.
	await Promise.all([
		writeFile(launcherPath, 'placeholder'), writeFile(scannerPath, 'placeholder'),
		writeFile(runtimePath, 'placeholder'), writeFile(loaderPath, 'placeholder'),
		writeFile(pluginPath, 'placeholder'), writeFile(grantPath, '{"schemaVersion":1}\n'),
	]);
	const runtimeLibraries = Object.freeze([await descriptor(loaderPath)]);
	const [launcher, sandboxProfile, brokerPolicy, scanner, runtimeHost] = await Promise.all([
		descriptor(launcherPath), descriptor(PROFILE), descriptor(BROKER),
		descriptor(scannerPath), descriptor(runtimePath),
	]);
	const productionReadiness = await signedReadiness({
		launcher, sandboxProfile, brokerPolicy, scanner, runtimeHost, runtimeLibraries,
	});
	const authority = createIsolatedOpenFxNativeChildAuthority(Object.freeze({
		target: 'linux-x64', runtime: 'linux-x64', hostVersion: '1.0.0',
		openfxVersion: '1.5.1', openfxCommit: 'ab77951', scanner, runtimeHost,
		isolation: Object.freeze({ launcher, sandboxProfile, brokerPolicy, runtimeLibraries }),
		productionReadiness,
	}));
	const grantSha256 = digest(await readFile(grantPath));
	const interactInvocation = {
		executablePath: runtimeHost.path,
		arguments: ['--interact-v1-grant', grantPath, '--grant-sha256', grantSha256],
	};
	const interactAuthority = {
		plugin: await pathGrant(pluginPath), pluginResources: [], pluginRuntime: [],
		readOnly: [await pathGrant(grantPath)], writeOnly: [],
	};
	// The Interact form crosses authority admission; the placeholder launcher
	// then fails to execute, which is past the seam this test pins.
	const handle = authority.invoke(interactInvocation, interactAuthority);
	await handle.completion.catch(() => undefined);
	assert.throws(() => authority.invoke(interactInvocation, {
		...interactAuthority,
		writeOnly: [{ path: root, kind: 'directory', identity: interactAuthority.plugin.identity }],
	}), /may not receive write authority/u);
	assert.throws(() => authority.invoke({
		executablePath: runtimeHost.path,
		arguments: ['--invoke-v12-grant', grantPath, '--grant-sha256', grantSha256],
		cancellationFrame: `${JSON.stringify({
			schemaVersion: 1, type: 'cancel', invocationId: 'invocation-1', abortSignalId: 'abort-1',
		})}\n`,
	}, interactAuthority), /one output directory/u);
});

async function signedReadiness(input: Readonly<{
	launcher: FramescaperOpenFxExecutableDescriptor;
	sandboxProfile: FramescaperOpenFxExecutableDescriptor;
	brokerPolicy: FramescaperOpenFxExecutableDescriptor;
	scanner: FramescaperOpenFxExecutableDescriptor;
	runtimeHost: FramescaperOpenFxExecutableDescriptor;
	runtimeLibraries: readonly FramescaperOpenFxExecutableDescriptor[];
}>) {
	const evidence = Object.freeze({
		schemaVersion: 1, kind: 'framescaper-openfx-production-readiness', target: 'linux-x64',
		scannerSha256: input.scanner.sha256, runtimeHostSha256: input.runtimeHost.sha256,
		qualifiedGpuBackends: ['opengl', 'opencl', 'cuda'],
		runtimeLibraries: Object.freeze(input.runtimeLibraries.map((library) => Object.freeze({
			name: basename(library.path), byteLength: library.byteLength, sha256: library.sha256,
		}))),
		launcher: Object.freeze({
			schemaVersion: 1, target: 'linux-x64',
			launcherId: 'framescaper-linux-landlock-seccomp-namespaces-v1',
			launcherPayloadSha256: input.launcher.sha256,
			sandboxProfileSha256: input.sandboxProfile.sha256,
			brokerPolicySha256: input.brokerPolicy.sha256,
			filesystem: 'broker-only', network: 'denied', childProcesses: 'denied',
			dynamicCode: 'admitted-plugin-only',
		}),
		openfxVersion: '1.5.1', osIsolationAttested: true, hostilePluginDenialAttested: true,
		realThirdPartyExecutionAttested: true, reviewedAt: '2026-08-24', reviewer: 'Fixture Reviewer',
	});
	const bytes = Buffer.from(JSON.stringify(evidence));
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	return verifyOpenFxProductionReadiness(Object.freeze({
		schemaVersion: 2, status: 'reviewed', target: 'linux-x64',
		evidence: Object.freeze({
			path: 'config/framescaper-openfx-production-readiness/linux-x64.json',
			byteLength: bytes.byteLength, sha256: digest(bytes),
		}),
		signature: Object.freeze({
			algorithm: 'ed25519', reviewKeyId: 'fixture-openfx-review',
			valueBase64: sign(null, bytes, privateKey).toString('base64'),
		}),
	}), {
		scannerSha256: input.scanner.sha256, runtimeHostSha256: input.runtimeHost.sha256,
		isolation: {
			launcherSha256: input.launcher.sha256, sandboxProfileSha256: input.sandboxProfile.sha256,
			brokerPolicySha256: input.brokerPolicy.sha256,
			runtimeLibraries: input.runtimeLibraries.map((library) => ({
				name: basename(library.path), byteLength: library.byteLength, sha256: library.sha256,
			})),
		},
	}, {
		readEvidence: async () => Buffer.from(bytes),
		resolveReviewPublicKey: async () => publicKey.export({ type: 'spki', format: 'pem' }),
	});
}

async function stageElfClosure(host: string, runtimeRoot: string): Promise<void> {
	const [{ stdout: programHeaders }, { stdout: dependencies }] = await Promise.all([
		execFileAsync('readelf', ['-l', host]), execFileAsync('ldd', [host]),
	]);
	const interpreter = /Requesting program interpreter:\s*([^\]]+)/u.exec(programHeaders)?.[1];
	if (!interpreter) throw new Error('The OpenFX fixture host has no ELF interpreter.');
	const paths = new Set<string>([interpreter]);
	for (const line of dependencies.split('\n')) for (const match of line.matchAll(/\/[^\s()]+/gu)) {
		try { await access(match[0]); paths.add(match[0]); } catch { /* virtual dependency */ }
	}
	for (const path of paths) await copyFile(path, join(runtimeRoot, basename(path)));
	await chmod(join(runtimeRoot, basename(interpreter)), 0o700);
}

async function descriptor(path: string): Promise<FramescaperOpenFxExecutableDescriptor> {
	const [bytes, metadata, canonical] = await Promise.all([readFile(path), stat(path), realpath(path)]);
	return Object.freeze({
		path: canonical, byteLength: bytes.byteLength, sha256: digest(bytes),
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
	});
}

async function pathGrant(path: string) {
	const metadata = await stat(path);
	return Object.freeze({
		path: await realpath(path), kind: 'file' as const,
		identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
	});
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

const HOST_SOURCE = String.raw`#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
	if (argc != 5 || strcmp(argv[1], "--scan") != 0 || strcmp(argv[3], "--sha256") != 0) return 10;
	void *admitted_handle = dlopen(argv[2], RTLD_NOW | RTLD_LOCAL);
	if (admitted_handle == NULL) return 11;
	int (*marker)(void) = (int (*)(void))dlsym(admitted_handle, "openfx_marker");
	if (marker == NULL) return 12;
	int admitted = marker();
	char sibling[4096];
	if (strlen(argv[2]) + 16u >= sizeof(sibling)) return 13;
	strcpy(sibling, argv[2]);
	char *name = strrchr(sibling, '/');
	if (name == NULL) return 14;
	strcpy(name + 1, "sibling.ofx");
	void *sibling_handle = dlopen(sibling, RTLD_NOW | RTLD_LOCAL);
	int denied = sibling_handle == NULL;
	printf("{\"admittedResult\":%d,\"siblingDenied\":%s}\n", admitted, denied ? "true" : "false");
	if (sibling_handle != NULL) dlclose(sibling_handle);
	dlclose(admitted_handle);
	return admitted == 42 && denied ? 0 : 13;
}
`;
