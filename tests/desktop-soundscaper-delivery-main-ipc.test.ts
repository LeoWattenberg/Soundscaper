/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import test from 'node:test';

import {
	SOUNDSCAPER_DELIVERY_MAIN_CHANNELS as CHANNELS,
	SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL,
} from '../desktop/soundscaper-delivery-main-channels.ts';
import { registerSoundscaperDeliveryMainIpc } from '../desktop/soundscaper-delivery-main-ipc.ts';
import {
	createSoundscaperDeliveryDescriptionV1,
	parseSoundscaperDeliveryPlanV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import { createSoundscaperPersistentAudioDeliveryPlanV1 } from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';

const PROJECT = Object.freeze({
	projectId: 'album-project', projectRevision: 17, projectSha256: 'a'.repeat(64),
});
const OWNER = Object.freeze({ owner: 1 });
const OTHER_OWNER = Object.freeze({ owner: 2 });
const OTHER_PROJECT = Object.freeze({
	projectId: 'other-project', projectRevision: 1, projectSha256: 'b'.repeat(64),
});

test('persistent delivery ordinary IPC is closed, pathless and contains only scalar UI controls', async () => {
	const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
	const listeners = new Map<string, (event: unknown, value?: unknown) => unknown>();
	const removed: string[] = [];
	const calls: { name: string; value: unknown }[] = [];
	let summary: Record<string, unknown> | null = null;
	let claim: Record<string, unknown> | null = null;
	const service = {
		authorizeRoot: async (value: unknown) => { assert.equal(value, '/private/output'); return { grantId: '1'.repeat(48) }; },
		destinationGrantIdForJob: () => '1'.repeat(48),
		reauthorizeRoot: async (grantId: string, value: unknown) => {
			assert.equal(grantId, '1'.repeat(48)); assert.equal(value, '/private/output'); return { grantId };
		},
		enqueueBatch: async (value: Record<string, unknown>) => {
			calls.push({ name: 'enqueueBatch', value });
			const item = (value.items as Record<string, unknown>[])[0]!;
			const description = item.description as Record<string, unknown>;
			summary = {
				jobId: '2'.repeat(48), label: 'WAV master', state: 'waiting-for-project', attempt: 0,
				progress: null, lastFailureCode: null, projectIdentity: PROJECT,
				planFingerprint: description.planFingerprint, batchId: 'batch-1',
				batchMember: {
					memberId: 'member-1', label: 'WAV master', presetId: 'preset-1',
					target: { kind: 'project' }, mode: 'mix', settings: { format: 'wav' },
				},
				report: null, result: null,
			};
			return [summary];
		},
		list: (value: Record<string, unknown> = {}) => ({
			entries: summary ? [{ ...summary, state: value.currentProjectIdentity ? 'queued' : 'waiting-for-project' }] : [],
			paused: false, nextCursor: null,
		}),
		events: () => ({ events: [], nextSequence: 0, hasMore: false }),
		claimNext: async (authority: unknown, jobId: string) => {
			calls.push({ name: 'claimNext', value: { authority, jobId } });
			const enqueued = calls.find(({ name }) => name === 'enqueueBatch')!.value as Record<string, unknown>;
			const description = ((enqueued.items as Record<string, unknown>[])[0]!.description) as Record<string, unknown>;
			if ((authority as { planFingerprint: string }).planFingerprint !== description.planFingerprint) return null;
			claim = { jobId, claimId: '3'.repeat(48), description, plan: parseSoundscaperDeliveryPlanV1(description) };
			return claim;
		},
		updateProgress: (claimId: string, progress: number) => calls.push({ name: 'progress', value: { claimId, progress } }),
		beginWrite: async (value: unknown) => { calls.push({ name: 'beginWrite', value }); return { writeId: '4'.repeat(48), chunkSize: 4_194_304 }; },
		writeChunk: async (value: unknown) => { calls.push({ name: 'writeChunk', value }); return { nextOffset: 4 }; },
		patchFinalPrefix: async () => ({ byteLength: 4 }),
		finishWrite: async () => ({ byteLength: 4 }),
		abortWrite: async () => undefined,
		complete: async (value: Record<string, unknown>) => {
			calls.push({ name: 'complete', value });
			return { ...summary, state: 'completed' };
		},
		fail: async () => undefined,
		releaseClaim: async (claimId: string) => calls.push({ name: 'releaseClaim', value: claimId }),
		pause: () => undefined, resume: () => undefined, reorder: () => undefined,
		cancel: async () => undefined, retry: () => undefined,
	};
	const registration = registerSoundscaperDeliveryMainIpc({
		handle: (channel, listener) => handlers.set(channel, listener),
		removeHandler: (channel) => { handlers.delete(channel); removed.push(channel); },
		on: (channel, listener) => listeners.set(channel, listener),
		removeListener: (channel) => { listeners.delete(channel); },
		ownerFor: (event) => event === 'other' ? OTHER_OWNER
			: (event as { owner?: object })?.owner ?? OWNER,
		service: service as never,
		readProjectAuthority: async () => ({ projectIdentity: PROJECT, projectName: 'Album' }),
		dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/output'] }) },
		windowFor: () => ({}),
	});
	assert.deepEqual([...handlers.keys()].sort(), Object.values(CHANNELS).sort());
	assert.deepEqual([...listeners.keys()], [SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL]);

	const invoke = async (channel: string, value?: unknown, event: unknown = 'owner') => handlers.get(channel)!(event, value);
	assert.deepEqual(await invoke(CHANNELS.selectRoot), { grantId: '1'.repeat(48) });
	assert.deepEqual(await invoke(CHANNELS.projectIdentity, { projectId: PROJECT.projectId }), PROJECT);
	const plan = createSoundscaperPersistentAudioDeliveryPlanV1({
		settings: { format: 'wav' },
		exportPlan: { format: 'wav', range: 'project', sampleRate: 48_000 },
		batch: {
			batchId: 'batch-1', memberId: 'member-1', presetId: 'preset-1',
			target: { kind: 'project' }, mode: 'mix',
		},
	});
	const queuedDescription = createSoundscaperDeliveryDescriptionV1({
		label: 'WAV master', projectIdentity: PROJECT, plan, destinationGrantId: '1'.repeat(48),
	});
	const enqueueRequest = {
		items: [{
			description: queuedDescription,
			batch: { batchId: 'batch-1', member: {
				memberId: 'member-1', label: 'WAV master', presetId: 'preset-1',
				target: { kind: 'project' }, mode: 'mix', settings: { format: 'wav' },
			} },
		}],
		admission: {
			projectIdentity: PROJECT, planFingerprints: [queuedDescription.planFingerprint],
			saved: true, clean: true, named: true,
		},
	};
	const enqueued = await invoke(CHANNELS.enqueueBatch, enqueueRequest);
	assertPathless(enqueued);
	const traversalPlan = createSoundscaperPersistentAudioDeliveryPlanV1({
		settings: { format: 'wav', operatorMemo: '../../secret' },
		exportPlan: { format: 'wav', range: 'project', sampleRate: 48_000 }, batch: null,
	});
	const traversalDescription = createSoundscaperDeliveryDescriptionV1({
		label: 'Traversal refusal', projectIdentity: PROJECT, plan: traversalPlan,
		destinationGrantId: '1'.repeat(48),
	});
	await assert.rejects(invoke(CHANNELS.enqueueBatch, {
		items: [{ description: traversalDescription, batch: null }],
		admission: {
			projectIdentity: PROJECT, planFingerprints: [traversalDescription.planFingerprint],
			saved: true, clean: true, named: true,
		},
	}), /pathless|path/iu, 'relative traversal must not hide inside the canonical plan payload');
	for (const hiddenPath of [
		{ sourcePath: 'relative/source.wav' },
		{ outputPath: 'relative/master.wav' },
		{ clipPaths: ['relative/clip.wav'] },
	]) {
		const pathKeyPlan = createSoundscaperPersistentAudioDeliveryPlanV1({
			settings: { format: 'wav', ...hiddenPath },
			exportPlan: { format: 'wav', range: 'project', sampleRate: 48_000 }, batch: null,
		});
		const pathKeyDescription = createSoundscaperDeliveryDescriptionV1({
			label: 'Path-key refusal', projectIdentity: PROJECT, plan: pathKeyPlan,
			destinationGrantId: '1'.repeat(48),
		});
		await assert.rejects(invoke(CHANNELS.enqueueBatch, {
			items: [{ description: pathKeyDescription, batch: null }],
			admission: {
				projectIdentity: PROJECT, planFingerprints: [pathKeyDescription.planFingerprint],
				saved: true, clean: true, named: true,
			},
		}), /path/iu, `${Object.keys(hiddenPath)[0]} must be refused even when it is relative`);
	}
	const slashTextPlan = createSoundscaperPersistentAudioDeliveryPlanV1({
		settings: { format: 'wav', mediaType: 'audio/wav', displayRatio: '1/2' },
		exportPlan: { format: 'wav', range: 'project', sampleRate: 48_000 }, batch: null,
	});
	const slashTextDescription = createSoundscaperDeliveryDescriptionV1({
		label: 'Legitimate slash text', projectIdentity: PROJECT, plan: slashTextPlan,
		destinationGrantId: '1'.repeat(48),
	});
	await assert.doesNotReject(invoke(CHANNELS.enqueueBatch, {
		items: [{ description: slashTextDescription, batch: null }],
		admission: {
			projectIdentity: PROJECT, planFingerprints: [slashTextDescription.planFingerprint],
			saved: true, clean: true, named: true,
		},
	}));
	await assert.rejects(invoke(CHANNELS.enqueueBatch, enqueueRequest, 'other'), /open project|renderer owner/iu);
	const queued = await invoke(CHANNELS.list, { currentProjectIdentity: PROJECT });
	assert.equal((queued as { entries: { state: string }[] }).entries[0]!.state, 'queued');
	assertPathless(calls);
	await assert.rejects(invoke(CHANNELS.enqueueBatch, {
		...enqueueRequest,
		items: [{ ...enqueueRequest.items[0], batch: {
			...enqueueRequest.items[0]!.batch,
			member: { ...enqueueRequest.items[0]!.batch.member, unsupported: true },
		} }],
	}), /unsupported|fields|batch member/iu);

	await assert.rejects(invoke(CHANNELS.list, {
		currentProjectIdentity: PROJECT, path: '/private/output',
	}), /unsupported|path/iu);

	const foreign = new MessageChannel();
	listeners.get(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL)!({
		owner: OTHER_OWNER, ports: [foreign.port1],
	}, { jobId: '2'.repeat(48), currentAuthority: {
		projectIdentity: PROJECT, planFingerprint: queuedDescription.planFingerprint,
	} });
	assert.equal((await receive(foreign.port2)).type, 'closed',
		'a renderer owner cannot claim a persisted project it never bound as open');

	const active = new MessageChannel();
	listeners.get(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL)!({
		owner: OWNER, ports: [active.port1],
	}, { jobId: '2'.repeat(48), currentAuthority: {
		projectIdentity: PROJECT, planFingerprint: queuedDescription.planFingerprint,
	} });
	assert.equal((await receive(active.port2)).type, 'claimed');
	assert.equal(await invoke(CHANNELS.projectIdentity, { projectId: null }), null);
	assert.equal((await receive(active.port2)).type, 'closed',
		'clearing the renderer open generation revokes its active claim');
	await until(() => calls.some(({ name }) => name === 'releaseClaim'));
	await registration.revokeOwner(OWNER);
	await registration.dispose();
	assert.deepEqual(removed.sort(), Object.values(CHANNELS).sort());
	assert.equal(listeners.size, 0);
});

test('changing the owner open project during completion revokes final publication authority', async () => {
	const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
	const listeners = new Map<string, (event: unknown, value?: unknown) => unknown>();
	let enterComplete!: () => void;
	let unblockComplete!: () => void;
	const completeEntered = new Promise<void>((resolve) => { enterComplete = resolve; });
	const completeUnblocked = new Promise<void>((resolve) => { unblockComplete = resolve; });
	let finalAuthorityChecks = 0;
	let published = false;
	const service = {
		claimNext: async () => ({
			jobId: '2'.repeat(48), claimId: '3'.repeat(48),
			description: createSoundscaperDeliveryDescriptionV1({
				label: 'WAV', projectIdentity: PROJECT,
				plan: createSoundscaperPersistentAudioDeliveryPlanV1({
					settings: { format: 'wav' }, exportPlan: { format: 'wav', outputFrames: 4 },
					batch: null,
				}),
				destinationGrantId: '1'.repeat(48),
			}),
			plan: createSoundscaperPersistentAudioDeliveryPlanV1({
				settings: { format: 'wav' }, exportPlan: { format: 'wav', outputFrames: 4 }, batch: null,
			}),
		}),
		complete: async (value: Record<string, unknown>) => {
			enterComplete();
			await completeUnblocked;
			assert.equal(typeof value.revalidateAuthority, 'function');
			finalAuthorityChecks += 1;
			await (value.revalidateAuthority as () => Promise<unknown>)();
			published = true;
			return { state: 'completed' };
		},
		releaseClaim: async () => undefined,
	};
	const registration = registerSoundscaperDeliveryMainIpc({
		handle: (channel, listener) => handlers.set(channel, listener),
		removeHandler: (channel) => handlers.delete(channel),
		on: (channel, listener) => listeners.set(channel, listener),
		removeListener: (channel) => listeners.delete(channel),
		ownerFor: () => OWNER,
		service: service as never,
		readProjectAuthority: (projectId) => {
			const projectIdentity = projectId === PROJECT.projectId ? PROJECT : OTHER_PROJECT;
			return { projectIdentity, projectName: 'Open project' };
		},
		dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
		windowFor: () => ({}),
	});
	await handlers.get(CHANNELS.projectIdentity)!(
		{ owner: OWNER }, { projectId: PROJECT.projectId },
	);
	const channel = new MessageChannel();
	listeners.get(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL)!({
		owner: OWNER, ports: [channel.port1],
	}, { jobId: '2'.repeat(48), currentAuthority: {
		projectIdentity: PROJECT,
		planFingerprint: (await service.claimNext()).description.planFingerprint,
	} });
	assert.equal((await receive(channel.port2)).type, 'claimed');
	channel.port2.postMessage({
		protocolVersion: 1, type: 'request', sequence: 0, operation: 'complete',
		payload: { report: deliveryReport() },
	});
	await completeEntered;
	const switched = handlers.get(CHANNELS.projectIdentity)!(
		{ owner: OWNER }, { projectId: OTHER_PROJECT.projectId },
	) as Promise<unknown>;
	assert.equal((await receive(channel.port2)).type, 'closed');
	unblockComplete();
	await switched;
	assert.equal(finalAuthorityChecks, 1);
	assert.equal(published, false);
	await registration.dispose();
});

function receive(port: MessagePort): Promise<Record<string, unknown>> {
	return new Promise((resolve) => port.once('message', (value) => resolve(value as Record<string, unknown>)));
}

async function until(predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 100; index += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for delivery claim revocation.');
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

function assertPathless(value: unknown): void {
	const encoded = JSON.stringify(value);
	assert.doesNotMatch(encoded, /(?:root|staging|absolute|file)Path/iu);
	assert.doesNotMatch(encoded, /\/private\/output/iu);
}
