/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated main-side gate for the exact third-party-loading native child. */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import {
	bindNativeChildProcess,
	type NativeChildFramedControlBinding,
} from './native-child-framed-control.ts';
import type {
	EnforcedNativeChildLaunch,
	NativeChildIsolationArtifactDescriptor,
	NativeChildIsolationCompletion,
	NativeChildIsolationLaunch,
	NativeChildIsolationLauncherOptions,
	NativeChildIsolationLaunchRequest,
	NativeChildIsolationPathGrant,
	NativeChildIsolationSpawn as Spawn,
	NativeChildIsolationTarget,
	NativeChildMachineWorkload,
} from './native-child-isolation-contract.ts';
import { soundscaperProfessionalRuntimeClosureSha256 } from './soundscaper-professional-native-readiness.mjs';
import { createNativeChildWindowsAuthorityProfile } from './native-child-windows-authority.ts';

export type {
	EnforcedNativeChildLaunch,
	NativeChildIsolationArtifactDescriptor,
	NativeChildIsolationCompletion,
	NativeChildIsolationLaunch,
	NativeChildIsolationLauncherOptions,
	NativeChildIsolationLaunchRequest,
	NativeChildIsolationPathGrant,
	NativeChildIsolationTarget,
	NativeChildMachineWorkload,
};

const SHA256 = /^[a-f\d]{64}$/u;
const TARGETS = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'] as const);
const LINUX_LAUNCHER_IDS = Object.freeze([
	'soundscaper-linux-landlock-seccomp-namespaces-v1',
	'framescaper-linux-landlock-seccomp-namespaces-v1',
]);
const TARGET_LAUNCHER_IDS = Object.freeze({
	'mac-arm64': Object.freeze(['soundscaper-macos-seatbelt-broker-v1', 'framescaper-macos-seatbelt-broker-v1']),
	'win-x64': Object.freeze(['soundscaper-windows-appcontainer-job-v1', 'framescaper-windows-appcontainer-job-v1']),
	'win-arm64': Object.freeze(['soundscaper-windows-appcontainer-job-v1', 'framescaper-windows-appcontainer-job-v1']),
});
const ENFORCEMENT_FRAME = Buffer.from('M5_NATIVE_ISOLATION_ENFORCED_V1\n');
const MAXIMUM_ARGUMENTS = 128;
const MAXIMUM_GRANTS = 64;
const MAXIMUM_ARGUMENT_BYTES = 32_768;
const LINUX_O_PATH = 0x20_0000;
const LINUX_O_CLOEXEC = 0x8_0000;

interface NativeChildIsolationContainmentAuthority {
	readonly launcher: Readonly<{
		readonly schemaVersion: 1;
		readonly target: NativeChildIsolationTarget;
		readonly launcherId: string;
		readonly launcherPayloadSha256: string;
		readonly sandboxProfileSha256: string;
		readonly brokerPolicySha256: string;
		readonly peerPayloadSha256?: string;
		readonly runtimeClosureSha256?: string;
		readonly filesystem: 'broker-grant-only' | 'broker-only';
		readonly network: 'denied';
		readonly childProcesses: 'denied';
		readonly dynamicCode: 'admitted-plugin-only' | 'denied';
	}>;
	readonly workload: NativeChildMachineWorkloadBinding;
}

interface RuntimeLibraryBinding {
	readonly name: string;
	readonly byteLength: number;
	readonly sha256: string;
}

type NativeChildMachineWorkloadBinding =
	| Readonly<{ kind: 'soundscaper'; payloads: readonly string[]; runtimeClosureSha256: string }>
	| Readonly<{ kind: 'openfx' | 'media'; payloads: readonly string[];
		readonly runtimeLibraries: readonly RuntimeLibraryBinding[] }>;

const enforcedLaunches = new WeakSet<object>();

export function createNativeChildIsolationLauncher(options: NativeChildIsolationLauncherOptions) {
	const input = closed(options, ['target', 'machineWorkload', 'artifacts', 'spawn', 'enforcementTimeoutMs'], 2);
	const target = targetValue(input.target);
	const artifacts = artifactSet(input.artifacts);
	const containment = machineContainmentAuthority(input.machineWorkload as NativeChildMachineWorkload, target, artifacts);
	const spawn = input.spawn === undefined ? nodeSpawn : input.spawn as Spawn;
	if (typeof spawn !== 'function') throw new TypeError('A native isolation spawn seam must be a function.');
	const enforcementTimeoutMs = boundedInteger(input.enforcementTimeoutMs ?? 5_000, 100, 30_000,
		'enforcement timeout');
	const verify = () => verifyMachineArtifacts(target, containment, artifacts);
	return Object.freeze({
		machineReady: async () => {
			try {
				await verify();
				return Object.freeze({ status: 'ready' as const, target, launcherId: containment.launcher.launcherId });
			} catch (error) {
				return Object.freeze({ status: 'unavailable' as const, target, detail: errorMessage(error) });
			}
		},
		launch: async (request: NativeChildIsolationLaunchRequest): Promise<NativeChildIsolationLaunch> => {
			try { await verify(); }
			catch (error) {
				throw new Error(`The native child machine-containment launcher is unavailable: ${errorMessage(error)}`,
					{ cause: error });
			}
			return launchTargetChild({
				target, containment, artifacts, request, spawn, enforcementTimeoutMs,
			});
		},
	});
}

export function isEnforcedNativeChildLaunch(value: unknown): value is EnforcedNativeChildLaunch {
	return !!value && typeof value === 'object' && enforcedLaunches.has(value);
}

async function verifyMachineArtifacts(
	target: NativeChildIsolationTarget,
	containment: NativeChildIsolationContainmentAuthority,
	artifacts: ReturnType<typeof artifactSet>,
): Promise<void> {
	if (runtimeTarget() !== target) {
		throw new Error(`No actually enforced ${target} native child launcher is implemented on this runtime.`);
	}
	const launcherIds = target.startsWith('linux-') ? LINUX_LAUNCHER_IDS
		: TARGET_LAUNCHER_IDS[target as keyof typeof TARGET_LAUNCHER_IDS] ?? [];
	if (!launcherIds.includes(containment.launcher.launcherId)) {
		throw new Error('The machine containment contract names no admitted target native child launcher.');
	}
	if (containment.launcher.launcherPayloadSha256 !== artifacts.launcher.sha256
		|| containment.launcher.sandboxProfileSha256 !== artifacts.sandboxProfile.sha256
		|| containment.launcher.brokerPolicySha256 !== artifacts.brokerPolicy.sha256) {
		throw new Error('The launcher, sandbox profile, or broker policy differs from machine containment.');
	}
	const handles: FileHandle[] = [];
	try {
		for (const artifact of [artifacts.launcher, artifacts.sandboxProfile, artifacts.brokerPolicy]) {
			handles.push(await openAuthenticatedFile(artifact));
		}
	} finally { await closeAll(handles); }
}

async function launchTargetChild(options: Readonly<{
	target: NativeChildIsolationTarget;
	containment: NativeChildIsolationContainmentAuthority;
	artifacts: ReturnType<typeof artifactSet>;
	request: NativeChildIsolationLaunchRequest;
	spawn: Spawn;
	enforcementTimeoutMs: number;
}>): Promise<NativeChildIsolationLaunch> {
	const request = launchRequest(options.request);
	assertMachineWorkload(options.containment.workload, request);
	const artifactHandles: FileHandle[] = [];
	let child: ChildProcess | null = null;
	let completion: Promise<NativeChildIsolationCompletion> | null = null;
	let drainedCompletion: Promise<void> | null = null;
	try {
		artifactHandles.push(
			await openAuthenticatedFile(options.artifacts.launcher),
			await openAuthenticatedFile(options.artifacts.sandboxProfile),
			await openAuthenticatedFile(options.artifacts.brokerPolicy),
			await openAuthenticatedFile(request.executable),
		);
		const separateWorkloadPayload = request.workloadPayload.path !== request.executable.path;
		if (separateWorkloadPayload) artifactHandles.push(await openAuthenticatedFile(request.workloadPayload));
		for (const artifact of request.runtimeClosure) artifactHandles.push(await openAuthenticatedFile(artifact));
		for (const grant of [...request.readOnly, ...request.readExecute, ...request.writeOnly]) {
			artifactHandles.push(await openPathGrant(grant));
		}
		const launcherFd = 4;
		const profileFd = 5;
		const brokerFd = 6;
		const executableFd = 7;
		const arguments_ = [
			'--attestation-fd=3', `--profile-fd=${String(profileFd)}`,
			`--broker-policy-fd=${String(brokerFd)}`, `--executable-fd=${String(executableFd)}`,
			`--maximum-duration-ms=${String(request.resourcePolicy.maximumJobDurationMs)}`,
			`--maximum-rss-bytes=${String(request.resourcePolicy.maximumRssBytes)}`,
		];
		if (options.target.startsWith('win-')) {
			arguments_.push(`--authority-profile=${windowsAuthorityProfile(
				options.target, options.containment, options.artifacts, request,
			)}`);
		}
		let inheritedFd = 8;
		if (separateWorkloadPayload) arguments_.push(`--read-execute-fd=${String(inheritedFd++)}`);
		for (const _artifact of request.runtimeClosure) arguments_.push(`--read-execute-fd=${String(inheritedFd++)}`);
		for (const [kind, grants] of [
			['read-only', request.readOnly], ['read-execute', request.readExecute], ['write-only', request.writeOnly],
		] as const) for (const _grant of grants) arguments_.push(`--${kind}-fd=${String(inheritedFd++)}`);
		const extraInputSourceFd = request.extraInput === null ? null : 4 + artifactHandles.length;
		if (extraInputSourceFd !== null) arguments_.push(`--extra-input-fd=${String(extraInputSourceFd)}`);
		arguments_.push('--', 'native-isolated-child', ...request.arguments);
		const stdio = [
			request.framedControl === null ? request.stdin : 'pipe', 'pipe', 'pipe', 'pipe',
			...artifactHandles.map(({ fd }) => fd), ...(extraInputSourceFd === null ? [] : ['pipe']),
		] as SpawnOptions['stdio'];
		const command = options.target.startsWith('linux-')
			? `/proc/self/fd/${String(launcherFd)}` : options.artifacts.launcher.path;
		child = options.spawn(command, arguments_, {
			stdio, shell: false, windowsHide: true,
			env: { LANG: 'C', LC_ALL: 'C', PATH: '', HOME: '/nonexistent' },
		});
		const processBinding = bindNativeChildProcess(child, request.framedControl);
		completion = options.target.startsWith('linux-') ? processBinding.completion
			: wallTimeBound(processBinding.completion, child, request.resourcePolicy.maximumJobDurationMs);
		drainedCompletion = completion.then(() => undefined, () => undefined);
		const attestation = child.stdio?.[3];
		if (!attestation || typeof (attestation as Readable).on !== 'function') {
			throw new Error('The native isolation launcher exposed no enforcement pipe.');
		}
		await enforcementFrame(attestation as Readable, options.enforcementTimeoutMs);
		if (!Number.isSafeInteger(child.pid) || Number(child.pid) < 1) {
			throw new Error('The enforced native child has no process identity.');
		}
		const enforcement = Object.freeze({
			schemaVersion: 1 as const, kind: 'native-child-os-isolation-enforced' as const,
			target: options.target, launcherId: options.containment.launcher.launcherId, pid: Number(child.pid),
		});
		enforcedLaunches.add(enforcement);
		const extraInputSink = extraInputSourceFd === null ? null : child.stdio?.[extraInputSourceFd];
		if (extraInputSourceFd !== null && (!extraInputSink || typeof (extraInputSink as Writable).write !== 'function')) {
			throw new Error('The native isolation launcher exposed no extra-input pipe.');
		}
		return Object.freeze({
			enforcement,
			stdin: request.framedControl === null && request.stdin === 'pipe' ? child.stdin : null,
			extraInput: extraInputSink === null ? null : Object.freeze({
				childFd: 3 as const, sink: extraInputSink as Writable,
			}),
			control: processBinding.control,
			completion,
			kill: (signal: NodeJS.Signals = 'SIGTERM') => child?.kill(signal) ?? false,
		});
	} catch (error) {
		child?.kill('SIGKILL');
		if (drainedCompletion) await Promise.race([
			drainedCompletion,
			new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
		]);
		throw error;
	} finally {
		await closeAll(artifactHandles);
	}
}

function enforcementFrame(stream: Readable, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		let bytes = Buffer.alloc(0);
		const timer = setTimeout(() => settle(new Error('The isolation launcher enforcement handshake timed out.')), timeoutMs);
		const settle = (error: Error | null) => {
			clearTimeout(timer);
			stream.off('data', onData); stream.off('error', onError); stream.off('end', onEnd);
			if (error) reject(error); else resolve();
		};
		const onData = (chunk: Buffer) => {
			bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
			if (bytes.byteLength > ENFORCEMENT_FRAME.byteLength) settle(new Error('The enforcement handshake is malformed.'));
		};
		const onError = (error: Error) => { settle(error); };
		const onEnd = () => settle(bytes.equals(ENFORCEMENT_FRAME)
			? null : new Error('The enforcement handshake ended early.'));
		stream.on('data', onData); stream.once('error', onError); stream.once('end', onEnd);
	});
}

async function openAuthenticatedFile(value: NativeChildIsolationArtifactDescriptor): Promise<FileHandle> {
	const descriptor = artifactDescriptor(value);
	const handle = await open(descriptor.path, constants.O_RDONLY
		| (constants.O_NOFOLLOW ?? 0) | (process.platform === 'linux' ? LINUX_O_CLOEXEC : 0));
	try {
		const metadata = await handle.stat();
		const bytes = await handle.readFile();
		if (!metadata.isFile() || Number(metadata.dev) !== descriptor.identity.dev
			|| Number(metadata.ino) !== descriptor.identity.ino || bytes.byteLength !== descriptor.byteLength
			|| createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
			throw new Error(`The authenticated launcher artifact ${descriptor.path} changed identity, bytes, or digest.`);
		}
		return handle;
	} catch (error) { await handle.close(); throw error; }
}

async function openPathGrant(value: NativeChildIsolationPathGrant): Promise<FileHandle> {
	const grant = pathGrant(value);
	const directory = grant.kind === 'directory';
	const handle = await open(grant.path, (process.platform === 'linux' ? LINUX_O_PATH | LINUX_O_CLOEXEC : constants.O_RDONLY)
		| (constants.O_NOFOLLOW ?? 0)
		| (directory ? constants.O_DIRECTORY : 0));
	try {
		const metadata = await handle.stat();
		if ((directory ? !metadata.isDirectory() : !metadata.isFile())
			|| Number(metadata.dev) !== grant.identity.dev || Number(metadata.ino) !== grant.identity.ino) {
			throw new Error('A native isolation path grant changed identity or kind.');
		}
		return handle;
	} catch (error) { await handle.close(); throw error; }
}

function launchRequest(value: NativeChildIsolationLaunchRequest) {
	const record = closed(value, [
		'executable', 'arguments', 'readOnly', 'readExecute', 'writeOnly', 'resourcePolicy', 'framedControl',
		'runtimeClosure', 'workloadPayload', 'stdin', 'extraInput',
	], 4);
	const arguments_ = textArray(record.arguments, MAXIMUM_ARGUMENTS, 'native child arguments');
	if (arguments_.reduce((total, argument) => total + Buffer.byteLength(argument), 0) > MAXIMUM_ARGUMENT_BYTES) {
		throw new RangeError('Native child arguments exceed their aggregate byte bound.');
	}
	const readOnly = grantArray(record.readOnly);
	const readExecute = grantArray(record.readExecute);
	const writeOnly = grantArray(record.writeOnly);
	const runtimeClosure = artifactArray(record.runtimeClosure ?? []);
	if (readOnly.length + readExecute.length + writeOnly.length + runtimeClosure.length > MAXIMUM_GRANTS) {
		throw new RangeError('A native child admits at most 64 filesystem grants.');
	}
	const claims = [...readOnly, ...readExecute, ...writeOnly, ...runtimeClosure]
		.map((entry) => `${entry.identity.dev}:${entry.identity.ino}`);
	if (new Set(claims).size !== claims.length) throw new TypeError('Native child filesystem grants must be disjoint.');
	if (record.stdin !== undefined && record.stdin !== 'ignore' && record.stdin !== 'pipe') {
		throw new TypeError('A native child stdin mode is invalid.');
	}
	const policy = closed(record.resourcePolicy, ['maximumJobDurationMs', 'maximumRssBytes']);
	const resourcePolicy = Object.freeze({
		maximumJobDurationMs: boundedInteger(policy.maximumJobDurationMs, 1, 24 * 60 * 60_000, 'job duration'),
		maximumRssBytes: boundedInteger(policy.maximumRssBytes, 1, 1024 ** 3, 'resident-set ceiling'),
	});
	const executable = artifactDescriptor(record.executable);
	const extraInput = record.extraInput === undefined || record.extraInput === null
		? null : extraInputRequest(record.extraInput);
	return Object.freeze({
		executable, arguments: arguments_, readOnly, readExecute, writeOnly,
		resourcePolicy, runtimeClosure,
		workloadPayload: record.workloadPayload === undefined ? executable : artifactDescriptor(record.workloadPayload),
		framedControl: record.framedControl === null ? null
			: record.framedControl as unknown as NativeChildFramedControlBinding,
		stdin: record.stdin === 'pipe' ? 'pipe' as const : 'ignore' as const,
		extraInput,
	});
}

function extraInputRequest(value: unknown): Readonly<{ readonly childFd: 3 }> {
	const record = closed(value, ['childFd']);
	if (record.childFd !== 3) throw new TypeError('The one extra native child input must be remapped to fd 3.');
	return Object.freeze({ childFd: 3 });
}

function assertMachineWorkload(
	workload: NativeChildMachineWorkloadBinding,
	request: ReturnType<typeof launchRequest>,
): void {
	if (!workload.payloads.includes(request.workloadPayload.sha256)) {
		throw new Error('The native child payload is outside its machine-authenticated workload.');
	}
	if (request.runtimeClosure.some(({ path }) => path === request.workloadPayload.path)) {
		throw new Error('The machine-authenticated workload payload cannot also be a runtime-library row.');
	}
	if (workload.kind === 'soundscaper') {
		if (soundscaperProfessionalRuntimeClosureSha256(request.runtimeClosure)
			!== workload.runtimeClosureSha256) {
			throw new Error('The professional runtime closure differs from its machine-authenticated workload.');
		}
		if (request.executable.sha256 !== request.workloadPayload.sha256
			&& !request.runtimeClosure.some(({ sha256 }) => sha256 === request.executable.sha256)) {
			throw new Error('The professional runtime loader is outside its machine-authenticated closure.');
		}
	} else {
		const libraries = request.executable.sha256 === request.workloadPayload.sha256
			? request.runtimeClosure : [request.executable, ...request.runtimeClosure];
		const observed = libraries.map((entry) => ({
			name: basename(entry.path), byteLength: entry.byteLength, sha256: entry.sha256,
		})).sort((left, right) => left.name.localeCompare(right.name, 'en'));
		if (JSON.stringify(observed) !== JSON.stringify(workload.runtimeLibraries)) {
			throw new Error('The native child runtime libraries differ from its machine-authenticated workload.');
		}
	}
	if (request.executable.sha256 !== request.workloadPayload.sha256
		&& request.arguments.filter((value) => value === request.workloadPayload.path).length !== 1) {
		throw new Error('The authenticated runtime loader does not select the machine-authenticated workload payload.');
	}
}

function machineContainmentAuthority(
	value: NativeChildMachineWorkload,
	target: NativeChildIsolationTarget,
	artifacts: ReturnType<typeof artifactSet>,
): NativeChildIsolationContainmentAuthority {
	const fields = value?.kind === 'soundscaper'
		? ['kind', 'payloads', 'runtimeClosure']
		: ['kind', 'payloads', 'runtimeLibraries'];
	const row = closed(value, fields);
	if (row.kind !== 'soundscaper' && row.kind !== 'media' && row.kind !== 'openfx') {
		throw new TypeError('A native isolation machine workload kind is invalid.');
	}
	const payloads = artifactArray(row.payloads);
	const expectedPayloads = row.kind === 'openfx' ? 2 : 1;
	if (payloads.length !== expectedPayloads) {
		throw new TypeError('A native isolation machine workload has an invalid payload inventory.');
	}
	const framescaper = row.kind !== 'soundscaper';
	const launcherId = target.startsWith('linux-')
		? `${framescaper ? 'framescaper' : 'soundscaper'}-linux-landlock-seccomp-namespaces-v1`
		: target.startsWith('mac-')
			? `${framescaper ? 'framescaper' : 'soundscaper'}-macos-seatbelt-broker-v1`
			: `${framescaper ? 'framescaper' : 'soundscaper'}-windows-appcontainer-job-v1`;
	const commonLauncher = {
		schemaVersion: 1 as const,
		target,
		launcherId,
		launcherPayloadSha256: artifacts.launcher.sha256,
		sandboxProfileSha256: artifacts.sandboxProfile.sha256,
		brokerPolicySha256: artifacts.brokerPolicy.sha256,
		filesystem: row.kind === 'openfx' ? 'broker-only' as const : 'broker-grant-only' as const,
		network: 'denied' as const,
		childProcesses: 'denied' as const,
		dynamicCode: row.kind === 'media' ? 'denied' as const : 'admitted-plugin-only' as const,
	};
	if (row.kind === 'soundscaper') {
		const runtimeClosure = artifactArray(row.runtimeClosure);
		return Object.freeze({
			launcher: Object.freeze({
				...commonLauncher,
				peerPayloadSha256: payloads[0]!.sha256,
				runtimeClosureSha256: soundscaperProfessionalRuntimeClosureSha256(runtimeClosure),
			}),
			workload: Object.freeze({
				kind: 'soundscaper',
				payloads: Object.freeze(payloads.map(({ sha256 }) => sha256)),
				runtimeClosureSha256: soundscaperProfessionalRuntimeClosureSha256(runtimeClosure),
			}),
		});
	}
	const runtimeLibraries = artifactArray(row.runtimeLibraries).map((entry) => Object.freeze({
		name: basename(entry.path), byteLength: entry.byteLength, sha256: entry.sha256,
	})).sort((left, right) => left.name.localeCompare(right.name, 'en'));
	if (new Set(runtimeLibraries.map(({ name }) => name)).size !== runtimeLibraries.length) {
		throw new TypeError('A native isolation machine workload repeats a runtime-library name.');
	}
	return Object.freeze({
		launcher: Object.freeze(commonLauncher),
		workload: Object.freeze({
			kind: row.kind,
			payloads: Object.freeze(payloads.map(({ sha256 }) => sha256)),
			runtimeLibraries: Object.freeze(runtimeLibraries),
		}),
	});
}

function artifactSet(value: unknown) {
	const record = closed(value, ['launcher', 'sandboxProfile', 'brokerPolicy']);
	return Object.freeze({
		launcher: artifactDescriptor(record.launcher),
		sandboxProfile: artifactDescriptor(record.sandboxProfile),
		brokerPolicy: artifactDescriptor(record.brokerPolicy),
	});
}

function artifactDescriptor(value: unknown): NativeChildIsolationArtifactDescriptor {
	const record = closed(value, ['path', 'byteLength', 'sha256', 'identity']);
	const identity = fileIdentity(record.identity);
	if (typeof record.path !== 'string' || !isAbsolute(record.path) || record.path.includes('\0')
		|| !Number.isSafeInteger(record.byteLength) || Number(record.byteLength) < 1 || !digest(record.sha256)) {
		throw new TypeError('A native isolation artifact descriptor is invalid.');
	}
	return Object.freeze({ path: record.path, byteLength: Number(record.byteLength), sha256: record.sha256, identity });
}

function artifactArray(value: unknown): readonly NativeChildIsolationArtifactDescriptor[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_GRANTS) {
		throw new TypeError('A native child runtime closure must be a bounded artifact array.');
	}
	return Object.freeze(value.map(artifactDescriptor));
}

function grantArray(value: unknown): readonly NativeChildIsolationPathGrant[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_GRANTS) throw new TypeError('Native child path grants must be bounded.');
	return Object.freeze(value.map(pathGrant));
}

function pathGrant(value: unknown): NativeChildIsolationPathGrant {
	const record = closed(value, ['path', 'kind', 'identity']);
	if (typeof record.path !== 'string' || !isAbsolute(record.path) || record.path.includes('\0')
		|| (record.kind !== 'file' && record.kind !== 'directory')) {
		throw new TypeError('A native child path grant is invalid.');
	}
	return Object.freeze({ path: record.path, kind: record.kind, identity: fileIdentity(record.identity) });
}

function fileIdentity(value: unknown) {
	const record = closed(value, ['dev', 'ino']);
	return Object.freeze({
		dev: boundedInteger(record.dev, 0, Number.MAX_SAFE_INTEGER, 'file device'),
		ino: boundedInteger(record.ino, 0, Number.MAX_SAFE_INTEGER, 'file inode'),
	});
}

function textArray(value: unknown, maximum: number, label: string): readonly string[] {
	if (!Array.isArray(value) || value.length > maximum
		|| value.some((entry) => typeof entry !== 'string' || entry.includes('\0') || Buffer.byteLength(entry) > 4_096)) {
		throw new TypeError(`${label} must be bounded NUL-free text.`);
	}
	return Object.freeze([...value]);
}

function closed(value: unknown, fields: readonly string[], optionalLast = 0): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Native isolation values must be plain records.');
	const keys = Object.keys(value);
	const required = optionalLast > 0 ? fields.slice(0, -optionalLast) : fields;
	if (keys.some((key) => !fields.includes(key)) || required.some((key) => !keys.includes(key))) {
		throw new TypeError('A native isolation record has missing or unsupported fields.');
	}
	return value as Record<string, unknown>;
}

function targetValue(value: unknown): NativeChildIsolationTarget {
	if (typeof value !== 'string' || !TARGETS.includes(value as NativeChildIsolationTarget)) {
		throw new TypeError('A native isolation target is unsupported.');
	}
	return value as NativeChildIsolationTarget;
}

function runtimeTarget(): NativeChildIsolationTarget | null {
	const value = process.platform === 'darwin' ? `mac-${process.arch}`
		: process.platform === 'win32' ? `win-${process.arch}` : `${process.platform}-${process.arch}`;
	return TARGETS.includes(value as NativeChildIsolationTarget) ? value as NativeChildIsolationTarget : null;
}

function digest(value: unknown): value is string { return typeof value === 'string' && SHA256.test(value); }

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new TypeError(`A native isolation ${label} is invalid.`);
	}
	return Number(value);
}

async function closeAll(handles: readonly FileHandle[]): Promise<void> {
	await Promise.all(handles.map((handle) => handle.close().catch(() => undefined)));
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function windowsAuthorityProfile(
	target: NativeChildIsolationTarget,
	containment: NativeChildIsolationContainmentAuthority,
	artifacts: ReturnType<typeof artifactSet>,
	request: ReturnType<typeof launchRequest>,
): string {
	const brand = containment.workload.kind === 'soundscaper' ? 'soundscaper-professional'
		: containment.workload.kind === 'media' ? 'framescaper-media' : 'framescaper-openfx';
	return createNativeChildWindowsAuthorityProfile({
		brand,
		target,
		launcherId: containment.launcher.launcherId,
		launcherSha256: artifacts.launcher.sha256,
		sandboxProfileSha256: artifacts.sandboxProfile.sha256,
		brokerPolicySha256: artifacts.brokerPolicy.sha256,
		executable: request.executable,
		workloadPayload: request.workloadPayload,
		runtimeClosure: request.runtimeClosure,
		readOnly: request.readOnly,
		readExecute: request.readExecute,
		writeOnly: request.writeOnly,
	});
}

function wallTimeBound(
	completion: Promise<NativeChildIsolationCompletion>, child: ChildProcess, maximumDurationMs: number,
): Promise<NativeChildIsolationCompletion> {
	const timer = setTimeout(() => child.kill('SIGKILL'), maximumDurationMs);
	timer.unref();
	return completion.finally(() => clearTimeout(timer));
}
