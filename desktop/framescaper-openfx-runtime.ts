/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned authenticated composition of OpenFX scanner and per-fingerprint runtime processes. */

import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';

import {
	createFramescaperOpenFxHostVerifier,
	describeFramescaperOpenFxHostAvailability,
	type FramescaperOpenFxExecutableDescriptor,
	type FramescaperOpenFxHostAvailability,
	type FramescaperOpenFxHostDescriptor,
	type FramescaperOpenFxHostPayloadLocation,
	type FramescaperOpenFxHostPayloadPorts,
} from './framescaper-openfx-host-payload.ts';
import type {
	HelperChannel,
	HelperJobRequest,
} from './helper-supervisor.ts';
import { HelperSupervisor } from './helper-supervisor.ts';
import {
	OfxIsolatedHostManager,
	type OfxIsolatedWorkerPort,
} from './openfx-isolated-host-manager.ts';

export type FramescaperOpenFxHelperMode = 'scanner' | 'runtime';

const FRAMESCAPER_OPENFX_RUNTIME_IDENTITIES = Object.freeze({
	'linux-x64': 'linux-x64',
	'linux-arm64': 'linux-arm64',
	'mac-arm64': 'darwin-arm64',
	'win-x64': 'win32-x64',
	'win-arm64': 'win32-arm64',
} as const);
const SHA256 = /^[a-f\d]{64}$/u;

export interface FramescaperOpenFxRuntimeOptions {
	readonly location: FramescaperOpenFxHostPayloadLocation;
	readonly payloadPorts?: FramescaperOpenFxHostPayloadPorts;
	readonly maximumRuntimeProcesses?: number;
	readonly spawnHelper: (
		descriptor: FramescaperOpenFxHostDescriptor,
		mode: FramescaperOpenFxHelperMode,
		pluginFingerprint: string | null,
		processIdentity: string,
	) => HelperChannel | Promise<HelperChannel>;
	readonly mintJobId?: () => string;
	readonly sampleRss?: (
		mode: FramescaperOpenFxHelperMode,
		pluginFingerprint: string | null,
		processIdentity: string,
	) => number | null;
}

export interface FramescaperOpenFxHelperProcessConfig {
	readonly descriptor: FramescaperOpenFxHostDescriptor;
	readonly mode: FramescaperOpenFxHelperMode;
	readonly pluginFingerprint: string | null;
}

export interface FramescaperOpenFxRuntime {
	readonly payloadAvailability: FramescaperOpenFxHostAvailability;
	readonly reason: string | null;
	readonly manager: OfxIsolatedHostManager | null;
	available(): boolean;
	selfTestPassed(): boolean;
	dispose(): boolean;
}

export async function startFramescaperOpenFxRuntime(
	options: FramescaperOpenFxRuntimeOptions,
): Promise<FramescaperOpenFxRuntime> {
	const availability = await describeFramescaperOpenFxHostAvailability(
		options.location,
		options.payloadPorts,
	);
	if (availability.status === 'unavailable') {
		return unavailableRuntime(availability, `${availability.reason}: ${availability.detail}`);
	}
	const selected = availability.descriptor;
	const verify = createFramescaperOpenFxHostVerifier(options.location, options.payloadPorts);
	let disposed = false;
	let scannerSelfTestPassed = false;
	let runtimeSelfTestPassed = false;
	const createWorker = (
		mode: FramescaperOpenFxHelperMode,
		pluginFingerprint: string | null,
	): OfxIsolatedWorkerPort => {
		let current = selected;
		const processIdentity = randomBytes(20).toString('hex');
		const expectedKind = mode === 'scanner' ? 'ofx-scan' : 'ofx-host';
		const supervisor = new HelperSupervisor({
			verifyBinary: async () => {
				const next = await verify();
				assertSameDescriptor(selected, next);
				current = next;
			},
			spawn: () => options.spawnHelper(current, mode, pluginFingerprint, processIdentity),
			mintJobId: options.mintJobId ?? (() => randomBytes(20).toString('hex')),
			...(options.sampleRss
				? { sampleRss: () => options.sampleRss!(mode, pluginFingerprint, processIdentity) }
				: {}),
		});
		return Object.freeze({
			runJob: async <Kind extends 'ofx-scan' | 'ofx-host'>(
				request: HelperJobRequest<Kind>,
			): Promise<unknown> => {
				if (request.kind !== expectedKind) {
					throw new Error(`An OpenFX ${mode} process cannot execute ${request.kind}.`);
				}
				const expectedExecutable = mode === 'scanner' ? selected.scanner : selected.runtimeHost;
				assertExecutableGrant(
					request.grant.executable,
					expectedExecutable,
					mode === 'scanner' ? 'scanner' : 'runtime-host',
				);
				if (mode === 'runtime' && pluginFingerprint !== null
					&& 'invocation' in request.grant
					&& request.grant.invocation.pluginFingerprint !== pluginFingerprint) {
					throw new Error('An OpenFX runtime process cannot cross its binary fingerprint boundary.');
				}
				await supervisor.start();
				if (mode === 'scanner') scannerSelfTestPassed = true;
				else runtimeSelfTestPassed = true;
				return supervisor.runJob(request);
			},
			snapshot: () => supervisor.snapshot(),
			clearQuarantine: () => supervisor.clearQuarantine(),
			dispose: () => supervisor.dispose(),
		});
	};
	const manager = new OfxIsolatedHostManager({
		createScanner: () => createWorker('scanner', null),
		createRuntime: (pluginFingerprint) => createWorker('runtime', pluginFingerprint),
		...(options.maximumRuntimeProcesses === undefined
			? {} : { maximumRuntimeProcesses: options.maximumRuntimeProcesses }),
	});
	return Object.freeze({
		payloadAvailability: availability,
		reason: null,
		manager,
		available: () => !disposed,
		selfTestPassed: () => !disposed && scannerSelfTestPassed && runtimeSelfTestPassed,
		dispose: () => {
			if (disposed) return false;
			disposed = true;
			manager.dispose();
			return true;
		},
	});
}

export function validateFramescaperOpenFxHelperProcessConfig(
	value: unknown,
): FramescaperOpenFxHelperProcessConfig {
	const record = closedRecord(value, ['descriptor', 'mode', 'pluginFingerprint']);
	const mode = record.mode;
	if (mode !== 'scanner' && mode !== 'runtime') {
		throw new TypeError('An OpenFX helper process mode is unsupported.');
	}
	const pluginFingerprint = record.pluginFingerprint;
	if ((mode === 'scanner' && pluginFingerprint !== null)
		|| (mode === 'runtime' && !validFingerprint(pluginFingerprint))) {
		throw new TypeError('An OpenFX helper process has an invalid fingerprint boundary.');
	}
	const admittedPluginFingerprint = mode === 'scanner' ? null : pluginFingerprint as string;
	const descriptorRecord = closedRecord(record.descriptor, [
		'target', 'runtime', 'hostVersion', 'openfxVersion', 'openfxCommit', 'scanner', 'runtimeHost',
	]);
	const targets = Object.keys(FRAMESCAPER_OPENFX_RUNTIME_IDENTITIES);
	if (typeof descriptorRecord.target !== 'string' || !targets.includes(descriptorRecord.target)
		|| descriptorRecord.runtime !== FRAMESCAPER_OPENFX_RUNTIME_IDENTITIES[
			descriptorRecord.target as keyof typeof FRAMESCAPER_OPENFX_RUNTIME_IDENTITIES
		]
		|| typeof descriptorRecord.hostVersion !== 'string'
		|| !/^\d+\.\d+\.\d+$/u.test(descriptorRecord.hostVersion)
		|| descriptorRecord.openfxVersion !== '1.5.1' || descriptorRecord.openfxCommit !== 'ab77951') {
		throw new TypeError('An OpenFX helper process descriptor identity is invalid.');
	}
	return Object.freeze({
		mode,
		pluginFingerprint: admittedPluginFingerprint,
		descriptor: Object.freeze({
			target: descriptorRecord.target as FramescaperOpenFxHostDescriptor['target'],
			runtime: descriptorRecord.runtime as string,
			hostVersion: descriptorRecord.hostVersion,
			openfxVersion: '1.5.1' as const,
			openfxCommit: 'ab77951' as const,
			scanner: processExecutable(descriptorRecord.scanner),
			runtimeHost: processExecutable(descriptorRecord.runtimeHost),
		}),
	});
}

function unavailableRuntime(
	availability: FramescaperOpenFxHostAvailability,
	reason: string,
): FramescaperOpenFxRuntime {
	let disposed = false;
	return Object.freeze({
		payloadAvailability: availability,
		reason,
		manager: null,
		available: () => false,
		selfTestPassed: () => false,
		dispose: () => {
			if (disposed) return false;
			disposed = true;
			return true;
		},
	});
}

function assertExecutableGrant(
	actual: Readonly<{
		path: string;
		bytes: number;
		sha256: string;
		identity: Readonly<{ dev: number; ino: number }>;
	}>,
	expected: FramescaperOpenFxExecutableDescriptor,
	label: 'scanner' | 'runtime-host',
): void {
	if (actual.path !== expected.path || actual.bytes !== expected.byteLength
		|| actual.sha256 !== expected.sha256 || actual.identity.dev !== expected.identity.dev
		|| actual.identity.ino !== expected.identity.ino) {
		throw new Error(`The OpenFX job does not name the authenticated ${label} payload.`);
	}
}

function assertSameDescriptor(
	expected: FramescaperOpenFxHostDescriptor,
	actual: FramescaperOpenFxHostDescriptor,
): void {
	if (expected.target !== actual.target || expected.runtime !== actual.runtime
		|| expected.hostVersion !== actual.hostVersion || expected.openfxVersion !== actual.openfxVersion
		|| expected.openfxCommit !== actual.openfxCommit
		|| !sameExecutable(expected.scanner, actual.scanner)
		|| !sameExecutable(expected.runtimeHost, actual.runtimeHost)) {
		throw new Error('The Framescaper OpenFX-host payload identity changed after authentication.');
	}
}

function sameExecutable(
	left: FramescaperOpenFxExecutableDescriptor,
	right: FramescaperOpenFxExecutableDescriptor,
): boolean {
	return left.path === right.path && left.byteLength === right.byteLength
		&& left.sha256 === right.sha256 && left.identity.dev === right.identity.dev
		&& left.identity.ino === right.identity.ino;
}

function processExecutable(value: unknown): FramescaperOpenFxExecutableDescriptor {
	const record = closedRecord(value, ['path', 'byteLength', 'sha256', 'identity']);
	if (typeof record.path !== 'string' || !isAbsolute(record.path) || record.path.includes('\0')
		|| !Number.isSafeInteger(record.byteLength) || Number(record.byteLength) <= 0
		|| typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)) {
		throw new TypeError('An OpenFX helper executable identity is invalid.');
	}
	const identity = closedRecord(record.identity, ['dev', 'ino']);
	if (!Number.isSafeInteger(identity.dev) || Number(identity.dev) < 0
		|| !Number.isSafeInteger(identity.ino) || Number(identity.ino) < 0) {
		throw new TypeError('An OpenFX helper executable file identity is invalid.');
	}
	return Object.freeze({
		path: record.path,
		byteLength: Number(record.byteLength),
		sha256: record.sha256,
		identity: Object.freeze({ dev: Number(identity.dev), ino: Number(identity.ino) }),
	});
}

function closedRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('An OpenFX helper process config must use plain records.');
	}
	const record = value as Record<string, unknown>;
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
		throw new TypeError('An OpenFX helper process config has an invalid closed shape.');
	}
	return record;
}

function validFingerprint(value: unknown): value is string {
	return typeof value === 'string'
		&& /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}@[a-f\d]{64}$/u.test(value);
}
