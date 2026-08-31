/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { workloadThresholds } from '../scripts/lib/quality-budget-config.mjs';
import { createVideoEffectParityFixture } from './browser/video-effect-parity-helpers.js';

interface BudgetArtifact {
	readonly byteLength: number;
	readonly id: string;
	readonly sha256: string;
}

interface BudgetFixture {
	readonly artifacts?: readonly BudgetArtifact[];
	readonly id: string;
	readonly kind: string;
	readonly limitation?: string;
	readonly specification: Readonly<Record<string, unknown>>;
}

interface QualityBudgetConfig {
	readonly schemaVersion: number;
	readonly fixtures: readonly BudgetFixture[];
	readonly measurements: readonly Readonly<{ id: string; behavior: string }>[];
	readonly thresholds: readonly Readonly<{
		comparison: string; measurementId: string; unit: string; value: number;
	}>[];
	readonly workloads: readonly Readonly<{
		behavior: string; fixtureIds: readonly string[]; id: string; measurementIds: readonly string[];
	}>[];
}

const configUrl = new URL('../config/quality-budgets.json', import.meta.url);
const config = JSON.parse(await readFile(configUrl, 'utf8')) as QualityBudgetConfig;
const metricSuffixUnits: Readonly<Record<string, string>> = Object.freeze({
	Seconds: 'seconds', Ms: 'ms', Samples: 'samples', Frames: 'frames',
	Bytes: 'bytes', Ratio: 'ratio', Db: 'dB', Lu: 'LU', Rtf: 'RTF',
});

test('quality budget contract names explicit numeric diagnostics', () => {
	assert.equal(config.schemaVersion, 2);
	const fixtures = new Map(config.fixtures.map((fixture) => [fixture.id, fixture]));
	assert.equal(fixtures.size, config.fixtures.length);
	assert.equal(new Set(config.measurements.map(({ id }) => id)).size, config.measurements.length);
	assert.equal(new Set(config.thresholds.map(({ measurementId }) => measurementId)).size, config.thresholds.length);
	assert.equal(new Set(config.workloads.map(({ id }) => id)).size, config.workloads.length);

	for (const workload of config.workloads) {
		assert.ok(workload.fixtureIds.length > 0, workload.id);
		assert.ok(workload.measurementIds.length > 0, workload.id);
		for (const fixtureId of workload.fixtureIds) assert.ok(fixtures.has(fixtureId), fixtureId);
		const thresholds = workloadThresholds(config, workload.id);
		assert.equal(thresholds.length, workload.measurementIds.length);
		for (const threshold of thresholds) {
			assert.match(threshold.metricId, /^[a-z][a-zA-Z\d.]+$/u);
			assert.ok(Number.isFinite(threshold.value));
			const named = Object.keys(metricSuffixUnits).find(
				(suffix) => threshold.metricId.endsWith(suffix),
			);
			if (named) assert.equal(threshold.unit, metricSuffixUnits[named]);
		}
	}
});

test('reference-scale structural fixtures retain exact executable facts', () => {
	const streaming = config.fixtures.find(({ id }) => id === 'm2-streaming-project-8gib-v1');
	assert.equal(streaming?.kind, 'sparse-zip64-desktop-range-and-counting-import-witness');
	assert.equal(streaming?.specification.logicalBytes, 8_589_934_592);
	assert.equal(streaming?.specification.maxRangeBytes, 16_777_216);
	assert.equal(streaming?.specification.retainedSinkPayloadBytes, 0);
	assert.match(streaming?.limitation ?? '', /sparse filesystem/iu);

	const directWav = config.fixtures.find(({ id }) => id === 'm2-direct-wav-385mib-v1');
	assert.equal(directWav?.kind, 'deterministic-direct-wav-counting-sha256-node-witness');
	assert.equal(directWav?.specification.outputFileBytes, 403_701_804);
	assert.equal(
		directWav?.specification.outputSha256,
		'f1978598e11527049bcafae0f1d4847238e5322e11fddf714cc9f298bf12f9fe',
	);
	assert.equal(directWav?.specification.partialPublishedOutputs, 0);
});

test('keyframe parity remains a deterministic correctness gate', () => {
	const fixture = config.fixtures.find(({ id }) => id === 'm4b2-keyframe-parity-rgba-v1');
	const workload = config.workloads.find(({ id }) => id === 'm4b2-keyframe-render-parity');
	assert.equal(fixture?.kind, 'deterministic-keyed-preview-offline-rgba-parity');
	assert.equal(workload?.behavior, 'blocking');
	assert.deepEqual(
		workloadThresholds(config, 'm4b2-keyframe-render-parity').map(
			({ metricId, comparison, value, unit }: {
				metricId: string; comparison: string; value: number; unit: string;
			}) => ({ metricId, comparison, value, unit }),
		),
		[
			{ metricId: 'keyframes.videoMinimumSsim', comparison: 'gte', value: 0.98, unit: 'ratio' },
			{ metricId: 'keyframes.videoMaximumChannelMae', comparison: 'lte', value: 6 / 255, unit: 'ratio' },
			{ metricId: 'keyframes.omittedOperations', comparison: 'eq', value: 0, unit: 'count' },
			{ metricId: 'keyframes.substitutedOperations', comparison: 'eq', value: 0, unit: 'count' },
			{ metricId: 'keyframes.fallbackOperations', comparison: 'eq', value: 0, unit: 'count' },
		],
	);
});

test('registered video parity artifacts retain their deterministic hashes', () => {
	const fixture = config.fixtures.find(({ id }) => id === 'video-effect-parity-rgba-v1');
	assert.ok(fixture?.artifacts);
	for (const artifact of fixture.artifacts) {
		const generated = createVideoEffectParityFixture(artifact.id);
		assert.equal(generated.bytes.byteLength, artifact.byteLength);
		assert.equal(createHash('sha256').update(generated.bytes).digest('hex'), artifact.sha256);
	}
});
