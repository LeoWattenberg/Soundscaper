/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativeMediaPlanEnvelopeV1,
} from '../src/common/editor/native-media-plan-envelope.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { nativeMediaPlanVideoTimingAssetInputs } from '../src/common/editor/native-media-plan-video-timing.ts';
import {
	assertNativeQueueRecordV2,
	createNativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
import { unifiedExactVfrPlanFixture } from './helpers/unified-exact-vfr-plan-fixture.ts';

test('the native envelope projects exact VFR sidecar authority without serializing SCTI bytes', () => {
	const fixture = unifiedExactVfrPlanFixture(9);
	assert.throws(
		() => createNativeMediaPlanEnvelopeV1(fixture.plan),
		/VFR|timing.*(?:bytes|sidecar|asset)/iu,
	);
	const envelope = createNativeMediaPlanEnvelopeV1(fixture.plan, fixture.timingSidecars);
	assert.deepEqual(envelope.summary.videoTimingAssetInputs, [{
		inputIndex: 0,
		sourceId: 'vfr-source',
		...fixture.publication.reference,
	}]);
	assert.equal(JSON.stringify(envelope).includes('presentationTicks'), false);
	assert.throws(
		() => createNativeMediaPlanEnvelopeV1(fixture.plan, new Map()),
		/missing|VFR|sidecar/iu,
	);
});

test('declarative timing inventory rejects duplicate and future-generation references', () => {
	const fixture = unifiedExactVfrPlanFixture(9);
	const duplicate = structuredClone(fixture.plan);
	duplicate.sources.push({
		...duplicate.sources[0]!, inputIndex: 1, nodeId: 'duplicate-node', sourceId: 'duplicate-source',
	});
	assert.throws(
		() => nativeMediaPlanVideoTimingAssetInputs(duplicate),
		/duplicate.*timing.*reference/iu,
	);
	assert.throws(
		() => nativeMediaPlanVideoTimingAssetInputs({ ...fixture.plan, version: 15 }),
		/only.*V9.*V14|generation/iu,
	);
});

test('VFR queue records retain declarative timing identity and require authenticated tokens when created', () => {
	const fixture = unifiedExactVfrPlanFixture(12);
	const record = createNativeQueueRecordV2({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: '1'.repeat(40), taskKind: 'encoded-export', plan: fixture.plan,
		timingSidecars: fixture.timingSidecars,
		projectId: 'vfr-project', projectRevision: 1,
		inputFingerprints: [{ sourceId: 'vfr-source', sha256: fixture.publication.reference.sourceSha256 }],
		rootGrantId: '2'.repeat(32), relativeDestination: 'vfr.mp4',
		reservations: {
			cpuCores: 1, processTreeRssBytes: 128 * 1_024 * 1_024,
			scratchBytes: 32 * 1_024 * 1_024, minimumFreeBytes: 0, hardwareBackend: null,
		},
		position: 0, createdAtMs: 1,
	});
	assert.doesNotThrow(() => assertNativeQueueRecordV2(structuredClone(record)));
	assert.equal(record.planPayload.includes(fixture.publication.reference.sha256), true);
	assert.equal(record.planPayload.includes('presentationTicks'), false);
	assert.throws(() => createNativeQueueRecordV2({
		schemaFamily: 'framescaper', schemaVersion: 1,
		jobId: '3'.repeat(40), taskKind: 'encoded-export', plan: fixture.plan,
		projectId: 'vfr-project', projectRevision: 1,
		inputFingerprints: [{ sourceId: 'vfr-source', sha256: fixture.publication.reference.sourceSha256 }],
		rootGrantId: '2'.repeat(32), relativeDestination: 'missing.mp4',
		reservations: record.reservations, position: 0, createdAtMs: 1,
	}), /VFR|timing.*(?:bytes|sidecar|asset)/iu);

	const tamperedPlan = JSON.parse(record.planPayload) as {
		tracks: Array<{ sequenceOrder: number }>;
	};
	tamperedPlan.tracks[0]!.sequenceOrder = -1;
	const tamperedFingerprint = fingerprintNativeMediaPlan(tamperedPlan);
	assert.throws(
		() => assertNativeQueueRecordV2({
			...record,
			planPayload: tamperedFingerprint.canonical,
			planFingerprint: tamperedFingerprint.sha256,
		}),
		/sequenceOrder|safe integer|exact executable canonical plan/iu,
		'a recomputed digest cannot make non-timing VFR plan corruption durable',
	);
});
