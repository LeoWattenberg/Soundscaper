/* SPDX-License-Identifier: AGPL-3.0-only */

/** Launches the actual OpenFX scanner/runtime child through reviewed OS enforcement. */

import type { Writable } from 'node:stream';
import { basename, dirname } from 'node:path';

import type {
	FramescaperOpenFxExecutableDescriptor,
	FramescaperOpenFxHostDescriptor,
} from './framescaper-openfx-host-payload.ts';
import {
	createNativeChildIsolationLauncher,
	isEnforcedNativeChildLaunch,
	type NativeChildIsolationLaunch,
} from './native-child-isolation-launcher.ts';
import {
	openFxHostProcessArguments,
	type OpenFxHostProcessAuthority,
	type OpenFxHostProcessHandle,
	type OpenFxHostProcessInvocation,
	type OpenFxHostProcessInvoker,
} from './openfx-host-process-contract.ts';

const CANCEL_GRACE_MS = 250;
const SCANNER_DURATION_MS = 60_000;
const RUNTIME_DURATION_MS = 5 * 60_000;
const SCANNER_RSS_BYTES = 256 * 1024 * 1024;
const RUNTIME_RSS_BYTES = 768 * 1024 * 1024;
const LINUX_RUNTIME_LOADERS = Object.freeze({
	'linux-x64': 'ld-linux-x86-64.so.2',
	'linux-arm64': 'ld-linux-aarch64.so.1',
} as const);

export function createIsolatedOpenFxHostProcessInvoker(
	descriptor: FramescaperOpenFxHostDescriptor,
): OpenFxHostProcessInvoker {
	return createIsolatedOpenFxNativeChildAuthority(descriptor).invoke;
}

export function createIsolatedOpenFxNativeChildAuthority(
	descriptor: FramescaperOpenFxHostDescriptor,
) {
	assertDescriptorReadiness(descriptor);
	const launcher = createNativeChildIsolationLauncher({
		target: descriptor.target,
		reviewedContract: descriptor.productionReadiness,
		artifacts: {
			launcher: descriptor.isolation.launcher,
			sandboxProfile: descriptor.isolation.sandboxProfile,
			brokerPolicy: descriptor.isolation.brokerPolicy,
		},
	});
	return Object.freeze({
		productionReady: () => launcher.productionReady(),
		invoke: ((invocation, authority) => isolatedInvocation(
			descriptor, launcher, invocation, authority,
		)) as OpenFxHostProcessInvoker,
	});
}

function isolatedInvocation(
	descriptor: FramescaperOpenFxHostDescriptor,
	launcher: ReturnType<typeof createNativeChildIsolationLauncher>,
	invocation: OpenFxHostProcessInvocation,
	authority: OpenFxHostProcessAuthority,
): OpenFxHostProcessHandle {
	const arguments_ = openFxHostProcessArguments(invocation);
	const executable = selectedExecutable(descriptor, invocation.executablePath);
	const role = executable === descriptor.scanner ? 'scanner' : 'runtime';
	assertAuthority(role, arguments_, authority);
	const dispatch = isolatedDispatch(descriptor, executable, arguments_);
	let active: NativeChildIsolationLaunch | null = null;
	let cancelled = false;
	let cancellation: Promise<void> | null = null;
	const applyCancellation = (launch: NativeChildIsolationLaunch) => {
		cancellation ??= cancelLaunch(launch, invocation.cancellationFrame);
		return cancellation;
	};
	const launched = launcher.launch({
		executable: dispatch.executable,
		reviewedPayload: dispatch.reviewedPayload,
		arguments: dispatch.arguments,
		readOnly: Object.freeze([...authority.pluginResources, ...authority.readOnly]),
		readExecute: authority.plugin === null ? []
			: Object.freeze([authority.plugin, ...authority.pluginRuntime]),
		writeOnly: authority.writeOnly,
		runtimeClosure: dispatch.runtimeClosure,
		stdin: invocation.cancellationFrame === undefined ? 'ignore' : 'pipe',
		framedControl: null,
		resourcePolicy: {
			maximumJobDurationMs: role === 'scanner' ? SCANNER_DURATION_MS : RUNTIME_DURATION_MS,
			maximumRssBytes: role === 'scanner' ? SCANNER_RSS_BYTES : RUNTIME_RSS_BYTES,
		},
	}).then(async (launch) => {
		if (!isEnforcedNativeChildLaunch(launch.enforcement)) {
			launch.kill('SIGKILL');
			throw new Error('The OpenFX native child returned no genuine OS-isolation enforcement result.');
		}
		active = launch;
		if (cancelled) await applyCancellation(launch);
		return launch;
	});
	const completion = launched.then(({ completion }) => completion).then((result) => {
		if (result.signal !== null) {
			throw new Error(`The isolated OpenFX ${role} child terminated by ${result.signal}.`);
		}
		return Object.freeze({
			exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
		});
	});
	return Object.freeze({
		completion,
		cancel: async () => {
			if (cancelled) return;
			cancelled = true;
			try {
				const launch = active ?? await launched;
				await applyCancellation(launch);
				await completion.catch(() => undefined);
			} catch { /* The completion retains the authenticated launch failure. */ }
		},
	});
}

function isolatedDispatch(
	descriptor: FramescaperOpenFxHostDescriptor,
	host: FramescaperOpenFxExecutableDescriptor,
	arguments_: readonly string[],
) {
	if (!descriptor.target.startsWith('linux-')) return Object.freeze({
		executable: host, reviewedPayload: host, arguments: arguments_,
		runtimeClosure: descriptor.isolation.runtimeLibraries,
	});
	const loaderName = LINUX_RUNTIME_LOADERS[descriptor.target as keyof typeof LINUX_RUNTIME_LOADERS];
	const loaders = descriptor.isolation.runtimeLibraries.filter(({ path }) => basename(path) === loaderName);
	if (loaders.length !== 1) throw new Error('The OpenFX Linux child has no one exact authenticated runtime loader.');
	const loader = loaders[0]!;
	const runtimeRoot = dirname(loader.path);
	if (descriptor.isolation.runtimeLibraries.some(({ path }) => dirname(path) !== runtimeRoot)) {
		throw new Error('The OpenFX Linux runtime closure is not staged in one authenticated library root.');
	}
	return Object.freeze({
		executable: loader, reviewedPayload: host,
		arguments: Object.freeze(['--library-path', runtimeRoot, host.path, ...arguments_]),
		runtimeClosure: Object.freeze(descriptor.isolation.runtimeLibraries.filter((entry) => entry !== loader)),
	});
}

function assertDescriptorReadiness(descriptor: FramescaperOpenFxHostDescriptor): void {
	const readiness = descriptor.productionReadiness;
	if (descriptor.scanner.sha256 !== readiness.scannerSha256
		|| descriptor.runtimeHost.sha256 !== readiness.runtimeHostSha256
		|| descriptor.isolation.launcher.sha256 !== readiness.launcher.launcherPayloadSha256
		|| descriptor.isolation.sandboxProfile.sha256 !== readiness.launcher.sandboxProfileSha256
		|| descriptor.isolation.brokerPolicy.sha256 !== readiness.launcher.brokerPolicySha256) {
		throw new Error('The OpenFX child payload or isolation artifacts differ from signed readiness.');
	}
	const runtimeLibraries = descriptor.isolation.runtimeLibraries.map((library) => Object.freeze({
		name: basename(library.path), byteLength: library.byteLength, sha256: library.sha256,
	}));
	if (JSON.stringify(runtimeLibraries) !== JSON.stringify(readiness.runtimeLibraries)) {
		throw new Error('The OpenFX child runtime closure differs from signed readiness.');
	}
	if (descriptor.target.startsWith('linux-')) {
		const loaderName = LINUX_RUNTIME_LOADERS[descriptor.target as keyof typeof LINUX_RUNTIME_LOADERS];
		if (runtimeLibraries.filter(({ name }) => name === loaderName).length !== 1) {
			throw new Error('The OpenFX Linux child requires its target-specific signed runtime loader.');
		}
	}
}

function selectedExecutable(
	descriptor: FramescaperOpenFxHostDescriptor,
	path: string,
): FramescaperOpenFxExecutableDescriptor {
	if (path === descriptor.scanner.path) return descriptor.scanner;
	if (path === descriptor.runtimeHost.path) return descriptor.runtimeHost;
	throw new Error('An isolated OpenFX invocation selected no authenticated scanner or runtime payload.');
}

function assertAuthority(
	role: 'scanner' | 'runtime',
	arguments_: readonly string[],
	authority: OpenFxHostProcessAuthority,
): void {
	if (!authority || !Array.isArray(authority.pluginResources)
		|| !Array.isArray(authority.pluginRuntime)
		|| !Array.isArray(authority.readOnly) || !Array.isArray(authority.writeOnly)) {
		throw new TypeError('An isolated OpenFX invocation requires exact filesystem authority.');
	}
	const selfTest = arguments_[0] === '--self-test';
	if (selfTest) {
		if (authority.plugin !== null || authority.pluginResources.length !== 0
			|| authority.pluginRuntime.length !== 0
			|| authority.readOnly.length !== 0 || authority.writeOnly.length !== 0) {
			throw new Error('An OpenFX self-test cannot receive plug-in or scratch authority.');
		}
		return;
	}
	if (authority.plugin === null || authority.plugin.kind !== 'file') {
		throw new Error('An OpenFX plug-in invocation requires one admitted regular-file binary.');
	}
	assertPluginBundleAuthority(authority);
	if (role === 'scanner') {
		if (arguments_[0] !== '--scan' || arguments_[1] !== authority.plugin.path
			|| authority.readOnly.length !== 0 || authority.writeOnly.length !== 0) {
			throw new Error('An isolated OpenFX scanner may read-execute only its one admitted plug-in.');
		}
		return;
	}
	if (arguments_[0] !== '--invoke-v12-grant'
		|| !authority.readOnly.some(({ path }) => path === arguments_[1])
		|| authority.readOnly.some(({ kind }) => kind !== 'file')
		|| authority.writeOnly.length !== 1 || authority.writeOnly[0]!.kind !== 'directory') {
		throw new Error('An isolated OpenFX runtime requires one exact grant and one output directory.');
	}
}

function assertPluginBundleAuthority(authority: OpenFxHostProcessAuthority): void {
	if (authority.pluginResources.some(({ kind }) => kind !== 'file')
		|| authority.pluginRuntime.some(({ kind }) => kind !== 'file')) {
		throw new Error('OpenFX bundle authority requires individually admitted regular files.');
	}
	const paths = [authority.plugin!.path, ...authority.pluginResources.map(({ path }) => path),
		...authority.pluginRuntime.map(({ path }) => path)];
	if (new Set(paths).size !== paths.length) {
		throw new Error('OpenFX bundle authority repeats an admitted path.');
	}
}

async function cancelLaunch(
	launch: NativeChildIsolationLaunch,
	frame: string | undefined,
): Promise<void> {
	if (frame === undefined || launch.stdin === null) {
		launch.kill('SIGKILL');
		return;
	}
	await endWritable(launch.stdin, frame).catch(() => undefined);
	const completed = await Promise.race([
		launch.completion.then(() => true, () => true),
		new Promise<false>((resolve) => setTimeout(() => resolve(false), CANCEL_GRACE_MS)),
	]);
	if (!completed) launch.kill('SIGKILL');
}

function endWritable(stream: Writable, frame: string): Promise<void> {
	return new Promise((resolve, reject) => {
		stream.end(frame, (error?: Error | null) => { if (error) reject(error); else resolve(); });
	});
}
