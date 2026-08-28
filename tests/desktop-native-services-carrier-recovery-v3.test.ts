/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	framescaperNativeQueueControlTransitionV3,
	nativeQueueRecordRequiresRendererCarrier,
} from '../desktop/native-services-carrier-recovery-v3.ts';
import { createNativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

test('only selected V28 encoded and image-sequence exports can require renderer carrier regeneration', () => {
	const encoded = record('encoded-export');
	const imageSequence = record('image-sequence-export');
	const proxy = record('proxy-generation');
	assert.equal(nativeQueueRecordRequiresRendererCarrier(encoded), true);
	assert.equal(nativeQueueRecordRequiresRendererCarrier(imageSequence), true);
	assert.equal(nativeQueueRecordRequiresRendererCarrier(proxy), false,
		'a rich project plan does not turn original-source proxy work into a carrier consumer');
});

test('running carrier pause is atomic and generic resume/retry cannot consume an absent stage', () => {
	assert.deepEqual(framescaperNativeQueueControlTransitionV3(record('encoded-export'), 'pause'), {
		kind: 'await-carrier-regeneration',
	}, 'capacity-deferred carrier pause also discards its one-shot renderer custody');
	assert.deepEqual(framescaperNativeQueueControlTransitionV3(record('image-sequence-export'), 'pause'), {
		kind: 'await-carrier-regeneration',
	}, 'checkpointable image delivery also discards its process-local renderer carrier');
	const running = Object.freeze({ ...record('encoded-export'), state: 'running' as const, progress: 0.5 });
	assert.deepEqual(framescaperNativeQueueControlTransitionV3(running, 'pause'), {
		kind: 'await-carrier-regeneration',
	});
	const awaiting = Object.freeze({
		...running, state: 'paused' as const, progress: null,
		lastFailureCode: 'awaiting-carrier-regeneration',
	});
	for (const action of ['resume', 'retry'] as const) {
		assert.throws(() => framescaperNativeQueueControlTransitionV3(awaiting, action), /regenerated/u);
	}
	assert.deepEqual(framescaperNativeQueueControlTransitionV3(awaiting, 'cancel'), { kind: 'cancel' });
});

function record(taskKind: 'encoded-export' | 'image-sequence-export' | 'proxy-generation') {
	const profile = FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE;
	const project = createFramescaperProjectNativeMedia(profile, framescaperV20Options());
	const delivery = taskKind === 'image-sequence-export' ? Object.freeze({
		kind: 'image-sequence' as const, format: 'png' as const,
		frameRate: Object.freeze({ num: 60_000, den: 1_001 }), preserveAlpha: true as const,
	}) : undefined;
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		profile, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project, delivery), delivery,
	);
	return createNativeQueueRecordV3({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: taskKind === 'encoded-export' ? 'ab'.repeat(20)
			: taskKind === 'image-sequence-export' ? 'bc'.repeat(20) : 'cd'.repeat(20),
		taskKind, plan, projectId: String(project.id), projectRevision: Number(project.revision),
		inputFingerprints: [{ sourceId: 'video-source', sha256: '12'.repeat(32) }],
		rootGrantId: 'ef'.repeat(16), relativeDestination: taskKind === 'image-sequence-export'
			? 'renders/output-png' : 'renders/output.mov',
		reservations: { cpuCores: 1, processTreeRssBytes: 1024, scratchBytes: 1024,
			minimumFreeBytes: 0, hardwareBackend: null },
		...(taskKind === 'image-sequence-export'
			? { recoveryClass: 'verified-frame-checkpoint' as const } : {}),
		position: 0, createdAtMs: 1,
	});
}
