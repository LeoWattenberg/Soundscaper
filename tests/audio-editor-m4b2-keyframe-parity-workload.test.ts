/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createVideoKeyframeRenderStateProvider } from '../src/common/editor/video-keyframe-render-state-provider.ts';
import {
	M4B2_KEYFRAME_PARITY_SPECIFICATION,
	createM4B2KeyframeParityProject,
	createM4B2KeyframeParitySourceRgba,
	m4b2KeyframeParityCases,
	m4b2KeyframeParityOperationIds,
} from '../src/common/editor/quality/m4b2-keyframe-parity-workload.ts';

test('the dormant M4B2 keyed RGBA fixture is deterministic and digest-pinned', () => {
	const first = createM4B2KeyframeParitySourceRgba();
	const second = createM4B2KeyframeParitySourceRgba();
	const frameBytes = 128 * 72 * 4;
	assert.equal(first.byteLength, 12 * frameBytes);
	assert.deepEqual(second, first);
	assert.equal(createHash('sha256').update(first).digest('hex'),
		M4B2_KEYFRAME_PARITY_SPECIFICATION.sourceSha256);
	assert.equal(new Set(Array.from({ length: 12 }, (_value, frame) => (
		createHash('sha256')
			.update(first.subarray(frame * frameBytes, (frame + 1) * frameBytes))
			.digest('hex')
	))).size, 12, 'every exact source frame has distinct pixels');
	assert.equal(Object.isFrozen(M4B2_KEYFRAME_PARITY_SPECIFICATION), true);
});

test('the workload fixes every curve shape at exact segment start, interior, and end', () => {
	const cases = m4b2KeyframeParityCases();
	assert.deepEqual(cases.map(({ curveKind }) => curveKind), ['hold', 'linear', 'eased', 'bezier']);
	assert.deepEqual(cases.map(({ queries }) => queries.map(({ id, position }) => ({ id, position }))),
		new Array(4).fill([
			{ id: 'start', position: { num: 2, den: 1 } },
			{ id: 'interior', position: { num: 6, den: 1 } },
			{ id: 'end', position: { num: 10, den: 1 } },
		]));
	assert.equal(m4b2KeyframeParityOperationIds().length, 12);
	assert.equal(new Set(m4b2KeyframeParityOperationIds()).size, 12);
	assert.deepEqual(cases.map(({ presentationClass }) => presentationClass), [
		'authenticated-cfr-occurrence',
		'authenticated-cfr-occurrence',
		'authenticated-cfr-occurrence',
		'authenticated-vfr-materialized-occurrence',
	]);
	assert.deepEqual(cases.map(({ queries }) => queries.map(({ expectedPresentation }) => (
		expectedPresentation
	))), [
		...new Array(3).fill([
			{ drawableSourceFrame: 2, sourceFrame: '2/1', sourceTime: '1/6' },
			{ drawableSourceFrame: 6, sourceFrame: '6/1', sourceTime: '1/2' },
			{ drawableSourceFrame: 10, sourceFrame: '10/1', sourceTime: '5/6' },
		]),
		[
			{ drawableSourceFrame: 3, sourceFrame: '3/1', sourceTime: '1/6' },
			{ drawableSourceFrame: 6, sourceFrame: '47/7', sourceTime: '1/2' },
			{ drawableSourceFrame: 9, sourceFrame: '29/3', sourceTime: '5/6' },
		],
	]);

	for (const definition of cases) {
		const project = createM4B2KeyframeParityProject(definition.id);
		const clip = (project.clips as Record<string, unknown>[])[0]!;
		const provider = createVideoKeyframeRenderStateProvider();
		for (const query of definition.queries) {
			const state = provider.resolve({
				clip,
				localSequencePosition: query.position,
				sourceDisplaySize: { width: 128, height: 72 },
				canvas: { width: 128, height: 72 },
			});
			assert.ok(Math.abs(state.composition.opacity - query.expectedValue) < 1e-12,
				`${definition.id}/${query.id} resolved ${String(state.composition.opacity)}`);
		}
	}
});

test('each project build is detached and uses the pinned presentation identity', () => {
	const first = createM4B2KeyframeParityProject('opacity-linear');
	const second = createM4B2KeyframeParityProject('opacity-linear');
	assert.deepEqual(second, first);
	assert.notStrictEqual(second, first);
	assert.notStrictEqual(second.clips, first.clips);
	const source = (first.sources as Record<string, unknown>[])[0]!;
	assert.equal(source.contentSha256, M4B2_KEYFRAME_PARITY_SPECIFICATION.sourceSha256);
	assert.deepEqual(source.timingDecision, {
		mode: 'conform-cfr-at-ingest', rate: { num: 12, den: 1 },
	});
});
