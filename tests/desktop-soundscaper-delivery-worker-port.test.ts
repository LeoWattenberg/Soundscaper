/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import test from 'node:test';

import {
	SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL,
} from '../desktop/soundscaper-delivery-main-channels.ts';
import {
	registerSoundscaperDeliveryWorkerPort,
} from '../desktop/soundscaper-delivery-worker-port.ts';
import {
	createSoundscaperDeliveryDescriptionV1,
	SoundscaperDeliveryContractError,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	createSoundscaperPersistentAudioDeliveryPlanV1,
} from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';

const OWNER = Object.freeze({ id: 'owner' });
const OTHER_OWNER = Object.freeze({ id: 'other-owner' });
const PROJECT = Object.freeze({
	projectId: 'album-project', projectRevision: 7, projectSha256: 'a'.repeat(64),
});
const PLAN = createSoundscaperPersistentAudioDeliveryPlanV1({
	settings: { format: 'wav' },
	exportPlan: { format: 'wav', outputFrames: 4 },
	batch: {
		batchId: 'batch-1', memberId: 'member-1', presetId: 'preset-1',
		target: { kind: 'project' }, mode: 'mix',
	},
});
const DESCRIPTION = createSoundscaperDeliveryDescriptionV1({
	label: 'WAV', projectIdentity: PROJECT, plan: PLAN, destinationGrantId: 'd'.repeat(48),
});
const JOB = '1'.repeat(48);
const CLAIM = '2'.repeat(48);
const WRITE = '3'.repeat(48);

test('one authenticated owner-scoped worker port carries bounded backpressured media', async () => {
	const listeners = new Map<string, (event: unknown, value?: unknown) => void>();
	const calls: Array<Readonly<{ name: string; value?: unknown }>> = [];
	const service = fixtureService(calls);
	const registration = registerSoundscaperDeliveryWorkerPort({
		on: (channel, listener) => listeners.set(channel, listener),
		removeListener: (channel) => listeners.delete(channel),
		ownerFor: (event) => (event as { owner: object }).owner,
		service: service as never,
		admitCurrentAuthority: async (owner, value) => {
			assert.equal(owner, OWNER);
			return value as never;
		},
		completionAuthority: async (owner) => {
			assert.equal(owner, OWNER);
			return { projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint };
		},
	});
	assert.deepEqual([...listeners.keys()], [SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL]);

	const channel = new MessageChannel();
	listeners.get(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL)!({
		owner: OWNER, ports: [channel.port1],
	}, { jobId: JOB, currentAuthority: {
		projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint,
	} });
	const offered = await receive(channel.port2);
	assert.equal(offered.type, 'claimed');
	assert.equal((offered.claim as { claimId: string }).claimId, CLAIM);
	assert.equal(offered.maximumChunkBytes, 4 * 1024 * 1024);

	assert.deepEqual(await request(channel.port2, 0, 'progress', { progress: 0.25 }), true);
	assert.deepEqual(await request(channel.port2, 1, 'write-begin', {
		fileName: 'master.wav', size: 4,
	}), { writeId: WRITE, chunkSize: 4 * 1024 * 1024 });
	const input = new Uint8Array([1, 2, 3, 4]);
	assert.deepEqual(await request(channel.port2, 2, 'write-chunk', {
		writeId: WRITE, offset: 0, bytes: input,
	}, [input.buffer]), { nextOffset: 4 });
	assert.deepEqual(await request(channel.port2, 3, 'write-finish', { writeId: WRITE }), {
		byteLength: 4,
	});
	assert.match(String(await request(channel.port2, 4, 'complete', { report: deliveryReport() })), /completed/u);
	assert.ok(calls.some(({ name, value }) => name === 'writeChunk'
		&& (value as { bytes: Uint8Array }).bytes.byteLength === 4));
	assert.ok(calls.some(({ name, value }) => name === 'complete'
		&& (value as { currentAuthority: unknown }).currentAuthority));
	await registration.dispose();
	assert.equal(listeners.size, 0);
});

test('an owner project switch at completion cannot cross the final publication fence', async () => {
	const listeners = new Map<string, (event: unknown, value?: unknown) => void>();
	const calls: Array<Readonly<{ name: string; value?: unknown }>> = [];
	const service = fixtureService(calls);
	let enterComplete!: () => void;
	let unblockComplete!: () => void;
	const completeEntered = new Promise<void>((resolve) => { enterComplete = resolve; });
	const completeUnblocked = new Promise<void>((resolve) => { unblockComplete = resolve; });
	let currentProject: typeof DESCRIPTION.projectIdentity = PROJECT;
	let authorityReads = 0;
	let published = false;
	service.complete = async (value: unknown) => {
		enterComplete();
		await completeUnblocked;
		const finalAuthority = (value as { revalidateAuthority?: unknown }).revalidateAuthority;
		assert.equal(typeof finalAuthority, 'function');
		await (finalAuthority as () => Promise<unknown>)();
		published = true;
		return 'completed';
	};
	const registration = registerSoundscaperDeliveryWorkerPort({
		on: (channel, listener) => listeners.set(channel, listener),
		removeListener: (channel) => listeners.delete(channel),
		ownerFor: () => OWNER,
		service: service as never,
		admitCurrentAuthority: async (_owner, value) => value as never,
		completionAuthority: async () => {
			authorityReads += 1;
			if (currentProject !== PROJECT) {
				throw new SoundscaperDeliveryContractError(
					'stale-project', 'The renderer owner changed its open project.',
				);
			}
			return { projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint };
		},
	});
	const channel = new MessageChannel();
	listeners.get(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL)!({ ports: [channel.port1] }, {
		jobId: JOB, currentAuthority: {
			projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint,
		},
	});
	await receive(channel.port2);
	channel.port2.postMessage(message(0, 'complete', { report: deliveryReport() }));
	await completeEntered;
	const changed = Object.freeze({
		...PROJECT, projectRevision: PROJECT.projectRevision + 1, projectSha256: 'b'.repeat(64),
	});
	currentProject = changed;
	const rebound = registration.bindOwnerProject(OWNER, changed);
	unblockComplete();
	await rebound;
	assert.equal((await receive(channel.port2)).type, 'closed');
	assert.equal(authorityReads, 2, 'main must re-read owner authority inside final publication');
	assert.equal(published, false);
	await registration.dispose();
});

test('the private worker validates and forwards a bounded failure report', async () => {
	const listeners = new Map<string, (event: unknown, value?: unknown) => void>();
	const calls: Array<Readonly<{ name: string; value?: unknown }>> = [];
	const registration = registerSoundscaperDeliveryWorkerPort({
		on: (channel, listener) => listeners.set(channel, listener),
		removeListener: (channel) => listeners.delete(channel),
		ownerFor: () => OWNER,
		service: fixtureService(calls) as never,
		admitCurrentAuthority: async (_owner, value) => value as never,
		completionAuthority: async () => ({
			projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint,
		}),
	});
	const channel = new MessageChannel();
	listeners.get(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL)!({
		owner: OWNER, ports: [channel.port1],
	}, { jobId: JOB, currentAuthority: {
		projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint,
	} });
	await receive(channel.port2);
	const report = deliveryReport();
	assert.equal(await request(channel.port2, 0, 'fail', {
		failureCode: 'ordinary-export-error', report,
	}), true);
	assert.deepEqual(calls.find(({ name }) => name === 'fail')?.value, {
		claimId: CLAIM, failureCode: 'ordinary-export-error', report,
	});
	await registration.dispose();
});

test('malformed, concurrent, oversized and foreign-owner traffic is closed and released', async () => {
	const listeners = new Map<string, (event: unknown, value?: unknown) => void>();
	const calls: Array<Readonly<{ name: string; value?: unknown }>> = [];
	const service = fixtureService(calls);
	let unblockProgress!: () => void;
	(service.updateProgress as unknown as () => Promise<void>) = () => new Promise((resolve) => {
		unblockProgress = resolve;
	});
	const registration = registerSoundscaperDeliveryWorkerPort({
		on: (channel, listener) => listeners.set(channel, listener),
		removeListener: (channel) => listeners.delete(channel),
		ownerFor: (event) => (event as { owner: object }).owner,
		service: service as never,
		admitCurrentAuthority: async (_owner, value) => value as never,
		completionAuthority: async () => ({
			projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint,
		}),
	});
	const channel = new MessageChannel();
	listeners.get(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL)!({
		owner: OWNER, ports: [channel.port1],
	}, { jobId: JOB, currentAuthority: {
		projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint,
	} });
	await receive(channel.port2);
	channel.port2.postMessage(message(0, 'progress', { progress: 0.25 }));
	channel.port2.postMessage(message(1, 'write-chunk', {
		writeId: WRITE, offset: 0, bytes: new Uint8Array(4 * 1024 * 1024 + 1),
	}));
	const closed = await receive(channel.port2);
	assert.equal(closed.type, 'closed');
	unblockProgress();
	await until(() => calls.some(({ name }) => name === 'releaseClaim'));

	const second = new MessageChannel();
	listeners.get(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL)!({
		owner: OTHER_OWNER, ports: [second.port1],
	}, { jobId: JOB, currentAuthority: {
		projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint,
	} });
	await receive(second.port2);
	await registration.revokeOwner(OTHER_OWNER);
	assert.equal((await receive(second.port2)).type, 'closed');
	await registration.dispose();
});

test('a malformed service-produced claim is released before the unregistered port closes', async () => {
	const listeners = new Map<string, (event: unknown, value?: unknown) => void>();
	const calls: Array<Readonly<{ name: string; value?: unknown }>> = [];
	const service = fixtureService(calls);
	(service as unknown as { claimNext: () => Promise<unknown> }).claimNext = async () => ({
		jobId: JOB, claimId: CLAIM, description: DESCRIPTION, plan: { malformed: true },
	});
	const registration = registerSoundscaperDeliveryWorkerPort({
		on: (channel, listener) => listeners.set(channel, listener),
		removeListener: (channel) => listeners.delete(channel),
		ownerFor: () => OWNER,
		service: service as never,
		admitCurrentAuthority: async (_owner, value) => value as never,
		completionAuthority: async () => ({
			projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint,
		}),
	});
	const channel = new MessageChannel();
	listeners.get(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL)!({ ports: [channel.port1] }, {
		jobId: JOB, currentAuthority: {
			projectIdentity: PROJECT, planFingerprint: DESCRIPTION.planFingerprint,
		},
	});
	assert.equal((await receive(channel.port2)).type, 'closed');
	await until(() => calls.some(({ name }) => name === 'releaseClaim'));
	await registration.dispose();
});

function fixtureService(calls: Array<Readonly<{ name: string; value?: unknown }>>) {
	return {
		list: () => ({ entries: [{ jobId: JOB }], paused: false, nextCursor: null }),
		claimNext: async (value: unknown, jobId: string) => {
			calls.push({ name: 'claimNext', value: { value, jobId } });
			return { jobId: JOB, claimId: CLAIM, description: DESCRIPTION, plan: PLAN };
		},
		updateProgress: (claimId: string, progress: number) => {
			calls.push({ name: 'progress', value: { claimId, progress } });
		},
		beginWrite: async (value: unknown) => {
			calls.push({ name: 'beginWrite', value });
			return { writeId: WRITE, chunkSize: 4 * 1024 * 1024 };
		},
		writeChunk: async (value: unknown) => {
			calls.push({ name: 'writeChunk', value });
			return { nextOffset: 4 };
		},
		patchFinalPrefix: async () => ({ byteLength: 4 }),
		finishWrite: async () => ({ byteLength: 4 }),
		abortWrite: async () => undefined,
		complete: async (value: unknown) => {
			calls.push({ name: 'complete', value });
			return 'completed';
		},
		fail: async (claimId: string, failureCode: string, report: unknown) => {
			calls.push({ name: 'fail', value: { claimId, failureCode, report } });
		},
		releaseClaim: async (claimId: string) => {
			calls.push({ name: 'releaseClaim', value: claimId });
		},
	};
}

function message(sequence: number, operation: string, payload: unknown) {
	return { protocolVersion: 1, type: 'request', sequence, operation, payload };
}

async function request(
	port: MessagePort,
	sequence: number,
	operation: string,
	payload: unknown,
	transfer: ArrayBuffer[] = [],
): Promise<unknown> {
	port.postMessage(message(sequence, operation, payload), transfer);
	const response = await receive(port);
	assert.equal(response.type, 'response');
	assert.equal(response.sequence, sequence);
	assert.equal(response.ok, true, String(response.errorCode));
	return response.value;
}

function receive(port: MessagePort): Promise<Record<string, unknown>> {
	return new Promise((resolve) => port.once('message', (value) => resolve(value as Record<string, unknown>)));
}

async function until(predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 100; index += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for worker-port cleanup.');
}

function deliveryReport() {
	return {
		schemaVersion: 1, format: 'delivery', direction: 'export',
		subject: {
			format: 'wav', container: 'riff', codec: 'pcm-s24le', sampleRate: 48_000,
			channelCount: 2, lossless: true,
		},
		items: [], counts: { preserved: 0, converted: 0, missing: 0, omitted: 0 },
	};
}
