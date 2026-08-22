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
	assertFramescaperMediaHostSelfTest,
	runFramescaperMediaHostSelfTest,
	type FramescaperMediaHostSelfTestResult,
} from './native-media-host-self-test.ts';
export { assertFramescaperMediaHostSelfTest } from './native-media-host-self-test.ts';

export interface FramescaperNativeMediaRuntimeOptions {
	readonly location: FramescaperMediaHostPayloadLocation;
	readonly payloadPorts?: FramescaperMediaHostPayloadPorts;
	readonly size?: number;
	readonly spawnHelper: (
		descriptor: FramescaperMediaHostDescriptor,
		index: number,
	) => HelperChannel | Promise<HelperChannel>;
	readonly mintJobId?: () => string;
	readonly sampleRss?: (index: number) => number | null;
	readonly runHostSelfTest?: (
		descriptor: FramescaperMediaHostDescriptor,
	) => Promise<FramescaperMediaHostSelfTestResult>;
}

export interface FramescaperNativeMediaRuntime {
	readonly payloadAvailability: FramescaperMediaHostAvailability;
	readonly reason: string | null;
	available(): boolean;
	snapshot(): NativeMediaHelperPoolSnapshot | null;
	selfTestEvidence(): FramescaperMediaHostSelfTestResult | null;
	runJob(request: NativeMediaHelperPoolJobRequest): Promise<unknown>;
	dispose(): boolean;
}

interface RuntimeWorker extends NativeMediaHelperWorkerPort {
	selfTest(): Promise<void>;
}

export async function startFramescaperNativeMediaRuntime(
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
	return Object.freeze({
		payloadAvailability: availability,
		reason: null,
		available: () => !disposed && pool.snapshot().quarantinedWorkers < pool.snapshot().configuredWorkers,
		snapshot: () => pool.snapshot(),
		selfTestEvidence: () => selfTestEvidence,
		runJob: (request: NativeMediaHelperPoolJobRequest) => pool.runJob(request),
		dispose: () => {
			if (disposed) return false;
			disposed = true;
			pool.dispose();
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
		runJob: (_request: HelperJobRequest<NativeMediaHelperPoolJobKind>) => Promise.reject(
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
