/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authenticated process pool for the current-target Framescaper media-host payload. */

import { randomBytes } from 'node:crypto';

import {
	createFramescaperMediaHostVerifier,
	describeFramescaperMediaHostAvailability,
	type FramescaperMediaHostAvailability,
	type FramescaperMediaHostDescriptor,
	type FramescaperMediaHostPayloadLocation,
	type FramescaperMediaHostPayloadPorts,
} from './framescaper-media-host-payload.ts';
import type { HelperChannel, HelperJobRequest } from './helper-supervisor.ts';
import { HelperSupervisor } from './helper-supervisor.ts';
import {
	NativeMediaHelperPool,
	type NativeMediaHelperPoolJobKind,
	type NativeMediaHelperPoolJobRequest,
	type NativeMediaHelperPoolSnapshot,
	type NativeMediaHelperWorkerPort,
} from './native-media-helper-pool.ts';
import {
	createNativeMediaV14HelperAdapter,
	type NativeMediaV14HelperAdapterMessageChannel,
} from './native-media-v14-helper-adapter.ts';
import type { FramescaperNativeMediaV14RuntimeRequest } from './native-media-v14-runtime-contract.ts';
import type { FramescaperNativeMediaProxyV14RuntimeRequest } from './native-media-v14-runtime-contract.ts';
import {
	assertFramescaperMediaHostSelfTest,
	assertFramescaperMediaHostSelectedV20RenderSelfTest,
	assertFramescaperMediaHostSelectedV28V14RenderSelfTest,
	runFramescaperMediaHostSelfTest,
	runFramescaperMediaHostSelectedV20RenderSelfTest,
	runFramescaperMediaHostSelectedV28V14RenderSelfTest,
	type FramescaperMediaHostSelfTestResult,
	type FramescaperMediaHostSelectedV20RenderSelfTestResult,
	type FramescaperMediaHostSelectedV28V14RenderSelfTestResult,
} from './native-media-host-self-test.ts';
export {
	assertFramescaperMediaHostSelfTest,
	assertFramescaperMediaHostSelectedV20RenderSelfTest,
	assertFramescaperMediaHostSelectedV28V14RenderSelfTest,
} from './native-media-host-self-test.ts';

export interface FramescaperNativeMediaRuntimeOptions {
	readonly location: FramescaperMediaHostPayloadLocation;
	readonly payloadPorts?: FramescaperMediaHostPayloadPorts;
	/** User-owned master switch. When present and false, executable work stays dormant. */
	readonly enabled?: () => boolean;
	readonly size?: number;
	readonly spawnHelper: (
		descriptor: FramescaperMediaHostDescriptor,
		index: number,
	) => HelperChannel | Promise<HelperChannel>;
	readonly mintJobId?: () => string;
	readonly sampleRss?: (index: number) => number | null;
	readonly v14?: Readonly<{
		readonly scratchRoot: string;
		readonly createMessageChannel: () => NativeMediaV14HelperAdapterMessageChannel;
	}>;
	readonly runHostSelfTest?: (
		descriptor: FramescaperMediaHostDescriptor,
	) => Promise<FramescaperMediaHostSelfTestResult>;
	readonly runSelectedV20RenderSelfTest?: (
		descriptor: FramescaperMediaHostDescriptor,
	) => Promise<FramescaperMediaHostSelectedV20RenderSelfTestResult>;
	readonly runSelectedV28V14RenderSelfTest?: (
		descriptor: FramescaperMediaHostDescriptor,
	) => Promise<FramescaperMediaHostSelectedV28V14RenderSelfTestResult>;
}

export interface FramescaperNativeMediaRuntime {
	readonly payloadAvailability: FramescaperMediaHostAvailability;
	readonly reason: string | null;
	available(): boolean;
	snapshot(): NativeMediaHelperPoolSnapshot | null;
	selfTestEvidence(): FramescaperMediaHostSelfTestResult | null;
	selectedV20RenderSelfTestEvidence(): FramescaperMediaHostSelectedV20RenderSelfTestResult | null;
	selectedV28V14RenderSelfTestEvidence(): FramescaperMediaHostSelectedV28V14RenderSelfTestResult | null;
	activate(): Promise<boolean>;
	deactivate(): boolean;
	runJob(request: NativeMediaHelperPoolJobRequest): Promise<unknown>;
	executeV14(request: FramescaperNativeMediaV14RuntimeRequest): Promise<unknown>;
	executeProxyV14(request: FramescaperNativeMediaProxyV14RuntimeRequest): Promise<unknown>;
	dispose(): boolean;
}

interface RuntimeWorker extends NativeMediaHelperWorkerPort {
	selfTest(): Promise<void>;
}

export async function startFramescaperNativeMediaRuntime(
	options: FramescaperNativeMediaRuntimeOptions,
): Promise<FramescaperNativeMediaRuntime> {
	if (options.enabled === undefined) return startActiveFramescaperNativeMediaRuntime(options);
	const availability = await describeFramescaperMediaHostAvailability(
		options.location,
		options.payloadPorts,
	);
	if (availability.status === 'unavailable') {
		return unavailableRuntime(availability, `${availability.reason}: ${availability.detail}`);
	}
	const runtime = dormantRuntime(options, availability);
	if (options.enabled()) await runtime.activate();
	return runtime;
}

async function startActiveFramescaperNativeMediaRuntime(
	options: FramescaperNativeMediaRuntimeOptions,
): Promise<FramescaperNativeMediaRuntime> {
	const availability = await describeFramescaperMediaHostAvailability(
		options.location,
		options.payloadPorts,
	);
	if (availability.status === 'unavailable') {
		return unavailableRuntime(availability, `${availability.reason}: ${availability.detail}`);
	}
	const verify = createFramescaperMediaHostVerifier(options.location, options.payloadPorts);
	let selfTestEvidence: FramescaperMediaHostSelfTestResult;
	try {
		assertSameDescriptor(availability.descriptor, await verify());
		const result = await (options.runHostSelfTest ?? runFramescaperMediaHostSelfTest)(
			availability.descriptor,
		);
		assertFramescaperMediaHostSelfTest(result);
		selfTestEvidence = result;
	} catch (error) {
		return unavailableRuntime(
			availability,
			`self-test-failed: ${errorMessage(error)}`,
		);
	}
	let selectedV20RenderSelfTestEvidence: FramescaperMediaHostSelectedV20RenderSelfTestResult | null = null;
	try {
		const result = await (
			options.runSelectedV20RenderSelfTest
			?? runFramescaperMediaHostSelectedV20RenderSelfTest
		)(availability.descriptor);
		assertFramescaperMediaHostSelectedV20RenderSelfTest(result);
		selectedV20RenderSelfTestEvidence = result;
	} catch {
		// Operation-specific readiness gates selected V20 only; probe/proxy remain independently useful.
	}
	let selectedV28V14RenderSelfTestEvidence: FramescaperMediaHostSelectedV28V14RenderSelfTestResult | null = null;
	try {
		const result = await (
			options.runSelectedV28V14RenderSelfTest
			?? runFramescaperMediaHostSelectedV28V14RenderSelfTest
		)(availability.descriptor);
		assertFramescaperMediaHostSelectedV28V14RenderSelfTest(result);
		selectedV28V14RenderSelfTestEvidence = result;
	} catch {
		// Exact selected V28/V14 readiness gates its queue without disabling probe/proxy work.
	}
	const workers: RuntimeWorker[] = [];
	const pool = new NativeMediaHelperPool({
		...(options.size === undefined ? {} : { size: options.size }),
		createWorker(index) {
			let currentDescriptor = availability.descriptor;
			const supervisor = new HelperSupervisor({
				verifyBinary: async () => {
					const descriptor = await verify();
					assertSameDescriptor(availability.descriptor, descriptor);
					currentDescriptor = descriptor;
				},
				spawn: () => options.spawnHelper(currentDescriptor, index),
				mintJobId: options.mintJobId ?? (() => randomBytes(20).toString('hex')),
				...(options.sampleRss ? { sampleRss: () => options.sampleRss!(index) } : {}),
			});
			const worker = Object.freeze({
				runJob: (request: NativeMediaHelperPoolJobRequest) => supervisor.runJob(request),
				snapshot: () => supervisor.snapshot(),
				clearQuarantine: () => supervisor.clearQuarantine(),
				dispose: () => supervisor.dispose(),
				selfTest: async () => {
					const descriptor = await verify();
					assertSameDescriptor(availability.descriptor, descriptor);
					await supervisor.start();
				},
			}) satisfies RuntimeWorker;
			workers.push(worker);
			return worker;
		},
		selfTest: (worker) => (worker as RuntimeWorker).selfTest(),
	});
	try {
		await Promise.all(workers.map(async (worker) => worker.selfTest()));
	} catch (error) {
		pool.dispose();
		return unavailableRuntime(availability, `self-test-failed: ${errorMessage(error)}`);
	}
	let disposed = false;
	const v14 = options.v14 === undefined ? null : createNativeMediaV14HelperAdapter({
		descriptor: availability.descriptor,
		scratchRoot: options.v14.scratchRoot,
		createMessageChannel: options.v14.createMessageChannel,
		runJob: (request) => pool.runJob(request),
	});
	return Object.freeze({
		payloadAvailability: availability,
		reason: null,
		available: () => !disposed && pool.snapshot().quarantinedWorkers < pool.snapshot().configuredWorkers,
		snapshot: () => pool.snapshot(),
		selfTestEvidence: () => selfTestEvidence,
		selectedV20RenderSelfTestEvidence: () => selectedV20RenderSelfTestEvidence,
		selectedV28V14RenderSelfTestEvidence: () => selectedV28V14RenderSelfTestEvidence,
		activate: () => Promise.resolve(!disposed),
		deactivate: () => false,
		runJob: (request: NativeMediaHelperPoolJobRequest) => pool.runJob(request),
		executeV14: (request: FramescaperNativeMediaV14RuntimeRequest) => v14 === null
			? Promise.reject(new Error('The selected V14 helper adapter is not mounted.'))
			: v14.execute(request),
		executeProxyV14: (request: FramescaperNativeMediaProxyV14RuntimeRequest) => v14 === null
			? Promise.reject(new Error('The selected V14 helper adapter is not mounted.'))
			: v14.executeProxy(request),
		dispose: () => {
			if (disposed) return false;
			disposed = true;
			pool.dispose();
			return true;
		},
	});
}

function dormantRuntime(
	options: FramescaperNativeMediaRuntimeOptions,
	availability: Extract<FramescaperMediaHostAvailability, { readonly status: 'available' }>,
): FramescaperNativeMediaRuntime {
	let active: FramescaperNativeMediaRuntime | null = null;
	let activation: Promise<boolean> | null = null;
	let disposed = false;
	let generation = 0;
	let reason: string | null = 'native-media-disabled';
	const deactivate = (): boolean => {
		if (disposed) return false;
		generation += 1;
		const changed = active !== null || activation !== null;
		active?.dispose();
		active = null;
		reason = 'native-media-disabled';
		return changed;
	};
	const activate = async (): Promise<boolean> => {
		if (disposed) return false;
		if (options.enabled?.() !== true) {
			deactivate();
			return false;
		}
		if (active?.available() === true) return true;
		if (activation !== null) return activation;
		const expectedGeneration = generation;
		const currentActivation = (async () => {
			const candidate = await startActiveFramescaperNativeMediaRuntime(options);
			if (disposed || generation !== expectedGeneration || options.enabled?.() !== true) {
				candidate.dispose();
				return false;
			}
			active?.dispose();
			active = candidate;
			reason = candidate.reason ?? (candidate.available() ? null : 'self-test-failed');
			return candidate.available();
		})();
		activation = currentActivation;
		try {
			return await currentActivation;
		} finally {
			if (activation === currentActivation) activation = null;
		}
	};
	return Object.freeze({
		payloadAvailability: availability,
		get reason() { return reason; },
		available: () => !disposed && active?.available() === true,
		snapshot: () => active?.snapshot() ?? null,
		selfTestEvidence: () => active?.selfTestEvidence() ?? null,
		selectedV20RenderSelfTestEvidence: () => active?.selectedV20RenderSelfTestEvidence() ?? null,
		selectedV28V14RenderSelfTestEvidence: () => (
			active?.selectedV28V14RenderSelfTestEvidence() ?? null
		),
		activate,
		deactivate,
		runJob: (request: NativeMediaHelperPoolJobRequest) => active === null
			? Promise.reject(new Error('Native media is off.')) : active.runJob(request),
		executeV14: (request: FramescaperNativeMediaV14RuntimeRequest) => active === null
			? Promise.reject(new Error('Native media is off.')) : active.executeV14(request),
		executeProxyV14: (request: FramescaperNativeMediaProxyV14RuntimeRequest) => active === null
			? Promise.reject(new Error('Native media is off.')) : active.executeProxyV14(request),
		dispose: () => {
			if (disposed) return false;
			disposed = true;
			generation += 1;
			active?.dispose();
			active = null;
			reason = 'native-media-runtime-disposed';
			return true;
		},
	});
}

function unavailableRuntime(
	availability: FramescaperMediaHostAvailability,
	reason: string,
): FramescaperNativeMediaRuntime {
	let disposed = false;
	return Object.freeze({
		payloadAvailability: availability,
		reason,
		available: () => false,
		snapshot: () => null,
		selfTestEvidence: () => null,
		selectedV20RenderSelfTestEvidence: () => null,
		selectedV28V14RenderSelfTestEvidence: () => null,
		activate: () => Promise.resolve(false),
		deactivate: () => false,
		runJob: (_request: HelperJobRequest<NativeMediaHelperPoolJobKind>) => Promise.reject(
			new Error(`The authenticated Framescaper media runtime is unavailable: ${reason}`),
		),
		executeV14: (_request: FramescaperNativeMediaV14RuntimeRequest) => Promise.reject(
			new Error(`The authenticated Framescaper media runtime is unavailable: ${reason}`),
		),
		executeProxyV14: (_request: FramescaperNativeMediaProxyV14RuntimeRequest) => Promise.reject(
			new Error(`The authenticated Framescaper media runtime is unavailable: ${reason}`),
		),
		dispose: () => {
			if (disposed) return false;
			disposed = true;
			return true;
		},
	});
}

function assertSameDescriptor(
	expected: FramescaperMediaHostDescriptor,
	actual: FramescaperMediaHostDescriptor,
): void {
	if (actual.target !== expected.target || actual.runtime !== expected.runtime
		|| actual.path !== expected.path || actual.byteLength !== expected.byteLength
		|| actual.sha256 !== expected.sha256 || actual.hostVersion !== expected.hostVersion
		|| actual.ffmpegVersion !== expected.ffmpegVersion
		|| actual.identity.dev !== expected.identity.dev || actual.identity.ino !== expected.identity.ino) {
		throw new Error('The Framescaper media-host payload identity changed after authentication.');
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
