/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned authenticated composition of OpenFX scanner and per-fingerprint runtime processes. */

import { randomBytes } from 'node:crypto';

import {
	createFramescaperOpenFxHostVerifier,
	describeFramescaperOpenFxHostAvailability,
	type FramescaperOpenFxExecutableDescriptor,
	type FramescaperOpenFxHostAvailability,
	type FramescaperOpenFxHostDescriptor,
	type FramescaperOpenFxHostPayloadLocation,
	type FramescaperOpenFxHostPayloadPorts,
} from './framescaper-openfx-host-payload.ts';
import type { HelperJobRequest } from './helper-supervisor.ts';
import { HelperSupervisor } from './helper-supervisor.ts';
import { createIsolatedOpenFxNativeChildAuthority } from './openfx-isolated-native-child.ts';
import { createOpenFxMainHelperChannel } from './openfx-main-helper-channel.ts';
import {
	OfxIsolatedHostManager,
	type OfxIsolatedWorkerPort,
} from './openfx-isolated-host-manager.ts';

export type FramescaperOpenFxHelperMode = 'scanner' | 'runtime';

export interface FramescaperOpenFxRuntimeOptions {
	readonly location: FramescaperOpenFxHostPayloadLocation;
	readonly payloadPorts?: FramescaperOpenFxHostPayloadPorts;
	readonly maximumRuntimeProcesses?: number;
	readonly mintJobId?: () => string;
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
	const initialAuthority = createIsolatedOpenFxNativeChildAuthority(selected);
	const initialMachineAvailability = await initialAuthority.machineReady();
	if (initialMachineAvailability.status !== 'ready') {
		return unavailableRuntime(Object.freeze({
			status: 'unavailable' as const,
			reason: 'isolation-launcher-unavailable' as const,
			detail: initialMachineAvailability.detail,
		}), `isolation-launcher-unavailable: ${initialMachineAvailability.detail}`);
	}
	const verify = createFramescaperOpenFxHostVerifier(options.location, options.payloadPorts);
	let disposed = false;
	let scannerSelfTestPassed = false;
	let runtimeSelfTestPassed = false;
	const createWorker = (
		mode: FramescaperOpenFxHelperMode,
		pluginFingerprint: string | null,
	): OfxIsolatedWorkerPort => {
		let current = selected;
		let authority = initialAuthority;
		const expectedKind = mode === 'scanner' ? 'ofx-scan' : 'ofx-host';
		const supervisor = new HelperSupervisor({
			verifyBinary: async () => {
				const next = await verify();
				assertSameDescriptor(selected, next);
				const nextAuthority = createIsolatedOpenFxNativeChildAuthority(next);
				const machineAvailability = await nextAuthority.machineReady();
				if (machineAvailability.status !== 'ready') {
					throw new Error(`The OpenFX child-isolation launcher is unavailable: ${machineAvailability.detail}`);
				}
				current = next;
				authority = nextAuthority;
			},
			spawn: () => createOpenFxMainHelperChannel({
				descriptor: current, mode, pluginFingerprint, invokeHost: authority.invoke,
			}),
			mintJobId: options.mintJobId ?? (() => randomBytes(20).toString('hex')),
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
		|| !sameExecutable(expected.runtimeHost, actual.runtimeHost)
		|| !sameIsolation(expected.isolation, actual.isolation)
		|| JSON.stringify(expected.supportedGpuBackends)
			!== JSON.stringify(actual.supportedGpuBackends)) {
		throw new Error('The Framescaper OpenFX-host payload identity changed after authentication.');
	}
}

function sameIsolation(
	left: FramescaperOpenFxHostDescriptor['isolation'],
	right: FramescaperOpenFxHostDescriptor['isolation'],
): boolean {
	return sameExecutable(left.launcher, right.launcher)
		&& sameExecutable(left.sandboxProfile, right.sandboxProfile)
		&& sameExecutable(left.brokerPolicy, right.brokerPolicy)
		&& left.runtimeLibraries.length === right.runtimeLibraries.length
		&& left.runtimeLibraries.every((library, index) => (
			sameExecutable(library, right.runtimeLibraries[index]!)
		));
}

function sameExecutable(
	left: FramescaperOpenFxExecutableDescriptor,
	right: FramescaperOpenFxExecutableDescriptor,
): boolean {
	return left.path === right.path && left.byteLength === right.byteLength
		&& left.sha256 === right.sha256 && left.identity.dev === right.identity.dev
		&& left.identity.ino === right.identity.ino;
}
