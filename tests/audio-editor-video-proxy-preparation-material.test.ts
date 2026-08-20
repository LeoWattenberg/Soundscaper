/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	consumePreparedVideoProxyRelationship,
	proveVideoProxyRelationship,
	videoProxyRelationshipInfo,
} from '../src/common/editor/video-proxy-relationship.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
} from '../src/common/editor/video-timing-asset.ts';
import {
	ORIGINAL_SOURCE_ID,
	createVideoProxyFixture,
	exactProbeResult,
	videoProxyProject,
} from './helpers/video-proxy-relationship-fixtures.ts';

const CANDIDATE_SOURCE_URL = new URL(
	'../src/common/editor/video-proxy-candidate-observation.ts',
	import.meta.url,
);
const RELATIONSHIP_SOURCE_URL = new URL(
	'../src/common/editor/video-proxy-relationship.ts',
	import.meta.url,
);

test('consumes the exact private timing publication once without changing the public result', async () => {
	const fixture = createVideoProxyFixture();
	const prepared = await proveVideoProxyRelationship(fixture.authority, {
		sourceId: ORIGINAL_SOURCE_ID,
	});
	const publicInfo = videoProxyRelationshipInfo(prepared.relationship);

	assert.deepEqual(Object.keys(prepared), ['relationship', 'candidate']);
	assert.equal(Object.isFrozen(prepared), true);
	assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(prepared)) as object), [
		'relationship', 'candidate',
	]);
	assert.equal(JSON.stringify(prepared).includes('timing'), false);

	const material = consumePreparedVideoProxyRelationship(prepared);
	assert.strictEqual(material.relationship, prepared.relationship);
	assert.strictEqual(material.candidate, prepared.candidate);
	assert.strictEqual(material.info, publicInfo);
	assert.equal(Object.isFrozen(material), true);
	assert.equal(Object.isFrozen(material.timingPublication), true);
	assert.equal(Object.isFrozen(material.timingPublication.reference), true);

	const candidateSha256 = await digestMediaContent(prepared.candidate);
	const expected = createVideoTimingAssetPublication(candidateSha256, exactProbeResult());
	assert.deepEqual(material.timingPublication.reference, expected.reference);
	assert.deepEqual(material.timingPublication.bytes, expected.bytes);
	const index = validateVideoTimingAssetBytes(
		material.timingPublication.reference,
		material.timingPublication.bytes,
	);
	assert.equal(index.frameCount, publicInfo.frameCount);
	assert.equal(material.timingPublication.reference.sourceSha256, candidateSha256);

	assert.throws(
		() => consumePreparedVideoProxyRelationship(prepared),
		/authentic|consum|prepar/iu,
	);
	let forgedReads = 0;
	const proxyForgery = new Proxy(prepared, {
		get(target, key, receiver) {
			forgedReads += 1;
			return Reflect.get(target, key, receiver);
		},
	});
	for (const forged of [
		{ ...prepared },
		structuredClone(prepared),
		JSON.parse(JSON.stringify(prepared)) as object,
		Object.freeze({ kind: 'video-proxy-relationship-preparation', version: 1 }),
		proxyForgery,
		null,
	]) {
		assert.throws(
			() => consumePreparedVideoProxyRelationship(forged as never),
			/authentic|consum|prepar/iu,
		);
	}
	assert.equal(forgedReads, 0, 'preparation authentication must precede public-field reads');
});

test('fresh preparations own distinct timing publications and byte storage', async () => {
	const fixture = createVideoProxyFixture();
	const firstPrepared = await proveVideoProxyRelationship(fixture.authority, {
		sourceId: ORIGINAL_SOURCE_ID,
	});
	const secondPrepared = await proveVideoProxyRelationship(fixture.authority, {
		sourceId: ORIGINAL_SOURCE_ID,
	});
	const first = consumePreparedVideoProxyRelationship(firstPrepared);
	const second = consumePreparedVideoProxyRelationship(secondPrepared);

	assert.notStrictEqual(first.timingPublication, second.timingPublication);
	assert.notStrictEqual(first.timingPublication.reference, second.timingPublication.reference);
	assert.notStrictEqual(first.timingPublication.bytes, second.timingPublication.bytes);
	assert.notStrictEqual(first.timingPublication.bytes.buffer, second.timingPublication.bytes.buffer);
	assert.deepEqual(first.timingPublication.reference, second.timingPublication.reference);
	assert.deepEqual(first.timingPublication.bytes, second.timingPublication.bytes);
	const before = second.timingPublication.bytes[0];
	first.timingPublication.bytes[0] = (first.timingPublication.bytes[0] ?? 0) ^ 0xff;
	assert.equal(second.timingPublication.bytes[0], before);
});

test('admits canonical V17 take state and synchronously refuses other schema or reserved wire', async () => {
	const admitted = createVideoProxyFixture();
	const project = admitted.project();
	assert.equal(project.schemaVersion, 17);
	assert.equal(Array.isArray(project.takeGroups), true);
	assert.equal((project.takeGroups as unknown[]).length, 1);
	const prepared = await proveVideoProxyRelationship(admitted.authority, {
		sourceId: ORIGINAL_SOURCE_ID,
	});
	consumePreparedVideoProxyRelationship(prepared);

	for (const [name, invalidProject] of [
		['V16', v16Project()],
		['V18', { ...structuredClone(videoProxyProject()), schemaVersion: 18 }],
		['reserved V17', projectWithReservedAttachment()],
	] as const) {
		const fixture = createVideoProxyFixture({ project: invalidProject });
		assert.throws(
			() => proveVideoProxyRelationship(fixture.authority, {
				sourceId: ORIGINAL_SOURCE_ID,
			}),
			/schema|version|proxyAttachment|reserved|proxy/iu,
			`${name} admission must fail before returning a Promise`,
		);
		assert.equal(fixture.counters.originalOpens, 0);
		assert.equal(fixture.counters.generatorCalls, 0);
		assert.equal(fixture.counters.probeCalls, 0);
	}
});

test('failed and cancelled preparations never publish consumable timing material', async () => {
	const releaseFault = new Error('release failed before publication');
	const releaseFailure = createVideoProxyFixture({ releaseError: releaseFault });
	await assert.rejects(
		proveVideoProxyRelationship(releaseFailure.authority, { sourceId: ORIGINAL_SOURCE_ID }),
		(error: unknown) => error === releaseFault,
	);

	const controller = new AbortController();
	const cancellation = new Error('cancel preparation exactly');
	const cancelled = createVideoProxyFixture({ generatorError: cancellation });
	controller.abort(cancellation);
	assert.throws(
		() => proveVideoProxyRelationship(cancelled.authority, {
			sourceId: ORIGINAL_SOURCE_ID,
			signal: controller.signal,
		}),
		(error: unknown) => error === cancellation,
	);
	assert.equal(releaseFailure.counters.originalReleases, 1);
	assert.equal(cancelled.counters.originalOpens, 0);
});

test('source owns one publication transfer and keeps the dormant Framescaper seam private', async () => {
	const [candidate, relationship, app] = await Promise.all([
		readFile(CANDIDATE_SOURCE_URL, 'utf8'),
		readFile(RELATIONSHIP_SOURCE_URL, 'utf8'),
		readFile(new URL('../src/common/editor/app.js', import.meta.url), 'utf8'),
	]);

	assert.equal(
		[...candidate.matchAll(/\bcreateVideoTimingAssetPublication\s*\(/gu)].length,
		1,
	);
	assert.match(candidate, /publication[\s\S]*?validateVideoTimingAssetBytes[\s\S]*?OBSERVATIONS\.set/u);
	assert.match(candidate, /timingPublication:\s*publication/u);
	assert.match(relationship, /validateAudioEditorProjectV17/u);
	assert.doesNotMatch(relationship, /validateAudioEditorProjectV16/u);
	assert.match(relationship, /schemaVersion:\s*17/u);
	assert.match(relationship, /proxyAttachment/u);
	assert.match(relationship, /PREPARATIONS\.set/u);
	assert.match(relationship, /PREPARATIONS\.delete[\s\S]*?return material/u);
	assert.match(
		relationship,
		/const cleanupFailure = await releaseVideoProxyOriginalLease[\s\S]*?captureCompletionTarget[\s\S]*?PREPARATIONS\.set/u,
		'private material must publish only after release and final completion capture',
	);
	assert.doesNotMatch(relationship, /createVideoTimingAssetPublication|encodeVideoTimingAsset/u);
	assert.doesNotMatch(app, /video-proxy-(?:candidate-observation|relationship)/u);
	assert.doesNotMatch(relationship, /project-v18|proxyAttachment\s*:/u);
});

function v16Project(): Record<string, unknown> {
	const current = videoProxyProject();
	const { takeGroups: _currentTakeGroups, ...retired } = structuredClone(current);
	return { ...retired, schemaVersion: 16 } as Record<string, unknown>;
}

function projectWithReservedAttachment(): Record<string, unknown> {
	const project = structuredClone(videoProxyProject());
	const sources = project.sources as Record<string, unknown>[];
	sources[0]!.proxyAttachment = null;
	return project;
}
