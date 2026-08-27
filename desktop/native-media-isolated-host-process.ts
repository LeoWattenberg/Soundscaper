/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed media-host invocation through the independently reviewed OS launcher. */

import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { Writable } from 'node:stream';

import type { FramescaperMediaHostDescriptor } from './framescaper-media-host-payload.ts';
import type { HelperDataPlaneByteSink } from './helper-data-plane-io.ts';
import {
	createNativeChildIsolationLauncher,
	isEnforcedNativeChildLaunch,
	type NativeChildIsolationLaunch,
	type NativeChildIsolationPathGrant,
} from './native-child-isolation-launcher.ts';
import type {
	NativeMediaHostInvocation,
	NativeMediaHostProcessHandle,
	NativeMediaHostProcessResult,
} from './native-media-helper-job.ts';
import { nativeMediaHostArguments } from './native-media-host-process.ts';

const MAXIMUM_DURATION_MS = 3 * 60 * 60_000;
const MAXIMUM_RSS_BYTES = 1024 ** 3;

export interface IsolatedNativeMediaHostControlResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export function createIsolatedNativeMediaHostProcessInvoker(
	descriptor: FramescaperMediaHostDescriptor,
): (invocation: NativeMediaHostInvocation) => NativeMediaHostProcessHandle {
	const launcher = mediaLauncher(descriptor);
	return (invocation) => isolatedInvocation(descriptor, launcher, invocation);
}

export async function runIsolatedNativeMediaHostControl(
	descriptor: FramescaperMediaHostDescriptor,
	arguments_: readonly string[],
	maximumDurationMs: number,
): Promise<IsolatedNativeMediaHostControlResult> {
	const launcher = mediaLauncher(descriptor);
	const entry = mediaEntryExecutable(descriptor);
	const runtimeClosure = mediaRuntimeClosure(descriptor, entry);
	const hostArguments = entry === descriptor
		? arguments_ : ['--library-path', dirname(entry.path), descriptor.path, ...arguments_];
	const launch = await launcher.launch({
		executable: entry === descriptor ? descriptorArtifact(descriptor) : entry,
		reviewedPayload: descriptorArtifact(descriptor),
		arguments: hostArguments,
		readOnly: [], readExecute: [], writeOnly: [],
		runtimeClosure,
		stdin: 'ignore', extraInput: null, framedControl: null,
		resourcePolicy: {
			maximumJobDurationMs: maximumDurationMs,
			maximumRssBytes: MAXIMUM_RSS_BYTES,
		},
	});
	if (!isEnforcedNativeChildLaunch(launch.enforcement)
		|| launch.stdin !== null || launch.extraInput !== null) {
		launch.kill('SIGKILL');
		throw new Error('The media self-test returned no exact enforced control launch.');
	}
	const result = await launch.completion;
	if (result.signal !== null) {
		throw new Error(`The isolated media self-test terminated by ${result.signal}.`);
	}
	return Object.freeze({
		exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
	});
}

function mediaLauncher(descriptor: FramescaperMediaHostDescriptor) {
	return createNativeChildIsolationLauncher({
		target: descriptor.target,
		machineWorkload: Object.freeze({
			kind: 'media' as const,
			payloads: Object.freeze([descriptorArtifact(descriptor)]),
			runtimeLibraries: descriptor.isolation.runtimeLibraries,
		}),
		artifacts: {
			launcher: descriptor.isolation.launcher,
			sandboxProfile: descriptor.isolation.sandboxProfile,
			brokerPolicy: descriptor.isolation.brokerPolicy,
		},
	});
}

function isolatedInvocation(
	descriptor: FramescaperMediaHostDescriptor,
	launcher: ReturnType<typeof createNativeChildIsolationLauncher>,
	invocation: NativeMediaHostInvocation,
): NativeMediaHostProcessHandle {
	if (invocation.executablePath !== descriptor.path) {
		throw new Error('The isolated media invocation selected no authenticated media-host payload.');
	}
	const live = invocation.sources.filter(({ liveInput }) => liveInput !== undefined);
	if (live.length > 2) throw new TypeError('The isolated media host admits at most two live inputs.');
	let active: NativeChildIsolationLaunch | null = null;
	let cancelled = false;
	const launched = prepareLaunchAuthority(invocation).then(async ({ readOnly, writeOnly }) => {
		const entry = mediaEntryExecutable(descriptor);
		const runtimeClosure = mediaRuntimeClosure(descriptor, entry);
		const hostArguments = nativeMediaHostArguments(invocation);
		const arguments_ = entry === descriptor
			? hostArguments
			: ['--library-path', dirname(entry.path), descriptor.path, ...hostArguments];
		const launch = await launcher.launch({
			executable: entry === descriptor ? descriptorArtifact(descriptor) : entry,
			reviewedPayload: descriptorArtifact(descriptor),
			arguments: arguments_,
			readOnly,
			readExecute: [],
			writeOnly,
			runtimeClosure,
			stdin: live.length === 0 ? 'ignore' : 'pipe',
			extraInput: live.length < 2 ? null : { childFd: 3 },
			framedControl: null,
			resourcePolicy: {
				maximumJobDurationMs: MAXIMUM_DURATION_MS,
				maximumRssBytes: MAXIMUM_RSS_BYTES,
			},
		});
		if (!isEnforcedNativeChildLaunch(launch.enforcement)
			|| (live.length > 0 && launch.stdin === null)
			|| (live.length > 1 && launch.extraInput?.childFd !== 3)) {
			launch.kill('SIGKILL');
			throw new Error('The media host returned no exact enforced live-input launch.');
		}
		active = launch;
		if (cancelled) launch.kill('SIGKILL');
		return launch;
	});
	const completion = launched.then(({ completion }) => completion).then((result) => {
		if (result.signal !== null) {
			throw new Error(`The isolated media host terminated by ${result.signal}.`);
		}
		return Object.freeze({
			exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
		}) satisfies NativeMediaHostProcessResult;
	});
	const streams = [
		launched.then((launch) => requiredInput(launch.stdin, 'stdin')),
		launched.then((launch) => requiredInput(launch.extraInput?.sink ?? null, 'fd3')),
	];
	for (const stream of streams) void stream.catch(() => undefined);
	return Object.freeze({
		completion,
		inputs: Object.freeze(live.map((source, index) => Object.freeze({
			role: source.role, sink: deferredSink(streams[index]!, () => active?.kill('SIGKILL')),
		}))),
		cancel: async () => {
			if (cancelled) return;
			cancelled = true;
			try { (active ?? await launched).kill('SIGKILL'); }
			catch { /* The completion retains the authenticated launch refusal. */ }
			await completion.catch(() => undefined);
		},
	});
}

async function prepareLaunchAuthority(invocation: NativeMediaHostInvocation): Promise<Readonly<{
	readonly readOnly: readonly NativeChildIsolationPathGrant[];
	readonly writeOnly: readonly NativeChildIsolationPathGrant[];
}>> {
	const readPaths = [
		invocation.plan?.path,
		...invocation.sources.flatMap(({ path, liveInput }) => liveInput === undefined ? [path] : []),
		...invocation.videoTimingAssets.map(({ path }) => path),
	].filter((path): path is string => path !== null && path !== undefined);
	const writePaths = [invocation.scratchPath, invocation.destinationRoot]
		.filter((path): path is string => path !== null);
	return Object.freeze({
		readOnly: await uniqueGrants(readPaths, 'file'),
		writeOnly: await uniqueGrants(writePaths, 'directory'),
	});
}

async function uniqueGrants(
	paths: readonly string[],
	kind: NativeChildIsolationPathGrant['kind'],
): Promise<readonly NativeChildIsolationPathGrant[]> {
	const grants = await Promise.all([...new Set(paths)].map(async (path) => {
		const metadata = await lstat(path);
		if (metadata.isSymbolicLink() || (kind === 'file' ? !metadata.isFile() : !metadata.isDirectory())
			|| await realpath(path) !== path) {
			throw new Error('A media-host isolation grant is not one canonical path.');
		}
		return Object.freeze({
			path, kind, identity: Object.freeze({ dev: Number(metadata.dev), ino: Number(metadata.ino) }),
		});
	}));
	const identities = grants.map(({ identity }) => `${String(identity.dev)}:${String(identity.ino)}`);
	if (new Set(identities).size !== identities.length) {
		throw new Error('Media-host isolation grants alias the same filesystem object.');
	}
	return Object.freeze(grants);
}

function mediaEntryExecutable(descriptor: FramescaperMediaHostDescriptor) {
	if (!descriptor.target.startsWith('linux-') || descriptor.isolation.runtimeLibraries.length === 0) {
		return descriptor;
	}
	const expected = descriptor.target === 'linux-x64'
		? /^ld-linux-x86-64\.so\.2$/u : /^ld-linux-aarch64\.so\.1$/u;
	const matches = descriptor.isolation.runtimeLibraries.filter(({ path }) => expected.test(basename(path)));
	if (matches.length !== 1) {
		throw new Error('A dynamic Linux media host requires one authenticated staged ELF interpreter.');
	}
	return matches[0]!;
}

function mediaRuntimeClosure(
	descriptor: FramescaperMediaHostDescriptor,
	entry: FramescaperMediaHostDescriptor | FramescaperMediaHostDescriptor['isolation']['launcher'],
) {
	return entry === descriptor ? descriptor.isolation.runtimeLibraries
		: Object.freeze(descriptor.isolation.runtimeLibraries.filter(({ path }) => path !== entry.path));
}

function descriptorArtifact(descriptor: FramescaperMediaHostDescriptor) {
	return Object.freeze({
		path: descriptor.path, byteLength: descriptor.byteLength,
		sha256: descriptor.sha256, identity: descriptor.identity,
	});
}

function requiredInput(value: Writable | null, label: string): Writable {
	if (value === null) throw new Error(`The isolated media host exposed no ${label} input pipe.`);
	return value;
}

function deferredSink(
	stream: Promise<Writable>,
	kill: () => unknown,
): HelperDataPlaneByteSink {
	let closed = false;
	return Object.freeze({
		write: async (bytes: Uint8Array) => {
			if (closed) throw new Error('The isolated media input pipe is closed.');
			await writeWritable(await stream, bytes);
		},
		complete: async () => {
			if (closed) throw new Error('The isolated media input pipe is already closed.');
			closed = true; await endWritable(await stream);
		},
		abort: async (reason: unknown) => {
			if (closed) return;
			closed = true; kill();
			const input = await stream.catch(() => null);
			input?.destroy(reason instanceof Error ? reason : undefined);
		},
	});
}

function writeWritable(stream: Writable, bytes: Uint8Array): Promise<void> {
	return new Promise((resolve, reject) => {
		stream.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), (error) => {
			if (error) reject(error); else resolve();
		});
	});
}

function endWritable(stream: Writable): Promise<void> {
	return new Promise((resolve, reject) => {
		stream.end((error?: Error | null) => { if (error) reject(error); else resolve(); });
	});
}
