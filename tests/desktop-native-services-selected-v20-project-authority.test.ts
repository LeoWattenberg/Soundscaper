/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { HelperJobRequest } from '../desktop/helper-supervisor.ts';
import type { PreparedNativeMediaQueueJob } from '../desktop/native-media-queue-dispatcher.ts';
import { FramescaperNativeSelectedV20ProjectAuthority } from '../desktop/native-services-selected-v20-project-authority.ts';
import type { FramescaperNativeProjectAuthority } from '../desktop/native-services-project-authority.ts';
import type {
	FramescaperNativeDerivedRenderInputs,
	FramescaperNativeRenderInputSettlementPort,
} from '../desktop/native-services-render-input-staging.ts';
import type { FramescaperNativeRootGrant } from '../desktop/native-services-root-repository.ts';
import { createNativeQueueRecordV2, type NativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import {
	nativeQueueKeyedPlanV7,
	nativeQueueSmallStaticAudioPlanV8,
	nativeQueueSmallStaticPlanV8,
} from './helpers/native-queue-plan-fixture.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

const ROOT: FramescaperNativeRootGrant = Object.freeze({
	grantId: 'ab'.repeat(16), rootPath: '/private/exports',
	volumeIdentity: 'volume-a', directoryIdentity: 'directory-a',
	authorizedAtMs: 1, revokedAtMs: null,
});

test('selected V20 delegates unified V9-V12 without inspecting or settling V7/V8 inputs', async (context) => {
	for (const version of [9, 10, 11, 12] as const) {
		await context.test(`V${String(version)}`, async () => {
			const record = queueRecord(version);
			const prepared = preparedJob();
			const calls: string[] = [];
			const authority = selectedAuthority({
				prepare: async (received, root) => {
					calls.push('project.prepare');
					assert.strictEqual(received, record);
					assert.strictEqual(root, ROOT);
					return prepared;
				},
				renderInputs: {
					revalidate: async () => true,
					inspect: async () => {
						calls.push('renderInputs.inspect');
						throw new Error('Unified plans have no selected-V20 derived-input stage.');
					},
					settle: async () => { calls.push('renderInputs.settle'); },
				},
			});

			assert.strictEqual(await authority.prepare(record, ROOT), prepared);
			assert.deepEqual(calls, ['project.prepare']);
		});
	}
});

test('selected V20 preserves V7 carrier materialization, byte accounting, and one-shot cleanup', async () => {
	const record = queueRecord(7, 60);
	const calls: string[] = [];
	const prepared = preparedJob(async (outcome) => { calls.push(`project.cleanup:${outcome}`); });
	const derived = derivedInputs(calls, 'evaluated-rgba-frame-pack');
	const authority = selectedAuthority({
		prepare: async () => prepared,
		renderInputs: {
			revalidate: async () => true,
			inspect: async () => { calls.push('renderInputs.inspect'); return derived; },
			settle: async (_record, outcome) => { calls.push(`renderInputs.settle:${outcome}`); },
		},
	});

	const selected = await authority.prepare(record, ROOT);
	const request = selected.request as HelperJobRequest<'media-render'>;
	assert.equal(request.resourcePolicy?.maximumInputBytes, 60);
	assert.deepEqual(request.grant.sources.map(({ type, role }) => ({ type, role })), [
		{ type: 'file', role: 'original' },
		{ type: 'stream', role: 'staged-audio-mix' },
		{ type: 'file', role: 'evaluated-rgba-frame-pack' },
	]);
	assert.deepEqual(calls, ['renderInputs.inspect', 'renderInputs.materialize:/private/scratch']);

	await selected.cleanup?.('paused');
	await selected.cleanup?.('failed');
	assert.deepEqual(calls, [
		'renderInputs.inspect',
		'renderInputs.materialize:/private/scratch',
		'project.cleanup:paused',
		'renderInputs.settle:paused',
	]);
});

test('selected V20 V8 materializes audio only while silent V8 delegates without a stage', async () => {
	const calls: string[] = [];
	const prepared = preparedJob(async (outcome) => { calls.push(`project.cleanup:${outcome}`); });
	const authority = selectedAuthority({
		prepare: async () => { calls.push('project.prepare'); return prepared; },
		renderInputs: {
			revalidate: async () => true,
			inspect: async () => {
				calls.push('renderInputs.inspect');
				return derivedInputs(calls, 'staged-audio-mix');
			},
			settle: async (_record, outcome) => { calls.push(`renderInputs.settle:${outcome}`); },
		},
	});
	const audio = await authority.prepare(queueRecord(8, 60, true), ROOT);
	assert.deepEqual((audio.request as HelperJobRequest<'media-render'>).grant.sources
		.map(({ type, role }) => ({ type, role })).at(-1),
	{ type: 'file', role: 'staged-audio-mix' });
	assert.deepEqual(calls.slice(0, 3), [
		'renderInputs.inspect', 'project.prepare', 'renderInputs.materialize:/private/scratch',
	]);
	await audio.cleanup?.('cancelled');
	assert.equal(calls.includes('renderInputs.settle:cancelled'), true);

	calls.length = 0;
	const silent = await authority.prepare(queueRecord(8), ROOT);
	assert.strictEqual(silent, prepared);
	assert.deepEqual(calls, ['project.prepare']);
});

test('selected V20 V7/V8 preparation failures clean the delegated scratch job without settling its resumable stage', async () => {
	const calls: string[] = [];
	const prepared = preparedJob(async (outcome) => { calls.push(`project.cleanup:${outcome}`); });
	const authority = selectedAuthority({
		prepare: async () => prepared,
		renderInputs: {
			revalidate: async () => true,
			inspect: async () => ({
				byteLength: 20,
				materialize: async () => {
					calls.push('renderInputs.materialize');
					throw new Error('materialization refused');
				},
			}),
			settle: async () => { calls.push('renderInputs.settle'); },
		},
	});

	await assert.rejects(() => authority.prepare(queueRecord(7, 61), ROOT), /materialization refused/u);
	assert.deepEqual(calls, ['renderInputs.materialize', 'project.cleanup:failed']);

	calls.length = 0;
	await assert.rejects(
		() => authority.prepare(queueRecord(8, 59, true), ROOT),
		/cannot hold its exact derived inputs/iu,
	);
	assert.deepEqual(calls, ['project.cleanup:failed']);
});

function selectedAuthority(options: Readonly<{
	prepare: (record: NativeQueueRecordV2, root: FramescaperNativeRootGrant) => Promise<PreparedNativeMediaQueueJob>;
	renderInputs: Pick<FramescaperNativeRenderInputSettlementPort, 'revalidate' | 'inspect' | 'settle'>;
}>): FramescaperNativeSelectedV20ProjectAuthority {
	return new FramescaperNativeSelectedV20ProjectAuthority({
		project: {
			projectState: () => Object.freeze({ open: true, writable: true }),
			watchProject: () => null,
			watchImportAlreadyPresent: async () => false,
			revalidate: async () => { throw new Error('unused'); },
			prepare: options.prepare,
		} as unknown as FramescaperNativeProjectAuthority,
		renderInputs: options.renderInputs,
	});
}

function preparedJob(
	cleanup: (outcome: 'succeeded' | 'paused' | 'cancelled' | 'failed') => Promise<void> = async () => undefined,
): PreparedNativeMediaQueueJob {
	return Object.freeze({
		request: Object.freeze({
			kind: 'media-render' as const,
			grant: Object.freeze({
				plan: Object.freeze({ byteLength: 17 }),
				sources: Object.freeze([
					Object.freeze({ type: 'file', role: 'original', bytes: 11 }),
					Object.freeze({
						type: 'stream', role: 'staged-audio-mix',
						binding: Object.freeze({ byteLength: 13 }),
					}),
				]),
				scratch: Object.freeze({ rootPath: '/private/scratch' }),
			}) as never,
			resourcePolicy: Object.freeze({ maximumInputBytes: 41 }),
		}),
		publish: async () => undefined,
		cleanup,
	});
}

function derivedInputs(
	calls: string[],
	role: 'evaluated-rgba-frame-pack' | 'staged-audio-mix',
): FramescaperNativeDerivedRenderInputs {
	return Object.freeze({
		byteLength: 19,
		materialize: async (directory: string) => {
			calls.push(`renderInputs.materialize:${directory}`);
			return Object.freeze([Object.freeze({
				type: 'file' as const,
				role,
				path: `${directory}/${role === 'staged-audio-mix' ? 'audio.wav' : 'evaluated.frames'}`,
				bytes: 19, sha256: '12'.repeat(32),
				identity: Object.freeze({ dev: 1, ino: 2 }),
			})]);
		},
	});
}

function queueRecord(
	version: 7 | 8 | 9 | 10 | 11 | 12,
	scratchBytes = 1_024,
	includeAudio = false,
): NativeQueueRecordV2 {
	const plan = version === 7
		? nativeQueueKeyedPlanV7()
		: version === 8
			? includeAudio ? nativeQueueSmallStaticAudioPlanV8() : nativeQueueSmallStaticPlanV8()
			: createUnifiedExactRenderPlan(unifiedExactPlanFixture(version));
	return createNativeQueueRecordV2({
		jobId: String(version).padStart(2, '0').repeat(20),
		taskKind: 'encoded-export', plan,
		projectId: 'project-1', projectRevision: 7, inputFingerprints: [],
		rootGrantId: ROOT.grantId, relativeDestination: `renders/v${String(version)}.mp4`,
		reservations: {
			cpuCores: 1, processTreeRssBytes: 1_024,
			scratchBytes, minimumFreeBytes: 0, hardwareBackend: null,
		},
		position: 0, createdAtMs: 1,
	});
}
