/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryUrl = new URL('../', import.meta.url);
const quality = JSON.parse(await readFile(new URL('config/quality-budgets.json', repositoryUrl), 'utf8'));
const packageMetadata = JSON.parse(await readFile(new URL('package.json', repositoryUrl), 'utf8'));

test('retires the obsolete Framescaper V18 exit workload and collector', async () => {
	assert.equal(quality.fixtures.some(({ id }) => id === 'm3-framescaper-v18-exit-2h-v1'), false);
	assert.equal(quality.workloads.some(({ id }) => id === 'm3-framescaper-v18-exit'), false);
	assert.equal(Object.hasOwn(packageMetadata.scripts, 'quality:collect:m3-framescaper-v18-exit'), false);

	for (const path of [
		'scripts/collect-m3-framescaper-v18-exit-quality.mjs',
		'src/framescaper/quality/m3-framescaper-v18-exit-workload.ts',
		'tests/audio-editor-m3-framescaper-v18-exit-workload.test.ts',
		'tests/browser/framescaper-v18-exit-observation.spec.js',
		'tests/quality-budget-m3-framescaper-v18-exit-collector.test.ts',
	]) {
		await assert.rejects(access(new URL(path, repositoryUrl)), { code: 'ENOENT' });
	}
});

test('moves exact editorial continuity into the current milestone 5 native-media gate', () => {
	const fixture = quality.fixtures.find(({ id }) => id === 'm5b-native-media-parity-and-longform-v1');
	const workload = quality.workloads.find(({ id }) => id === 'm5b-native-media-plan-parity-and-decode');

	assert.ok(fixture);
	assert.ok(workload);
	assert.equal(fixture.specification.editorialContinuityDurationSeconds, 7200);
	assert.deepEqual(fixture.specification.requiredEditorialCharacteristics, [
		'attached-proxy',
		'nested-sequence',
		'multicamera',
		'verified-vfr',
		'source-timecode',
	]);
	assert.deepEqual(
		quality.thresholds.filter(({ measurementId }) => (
			workload.measurementIds.includes(measurementId)
			&& measurementId.startsWith('nativeMedia.editorial')
		)).map(
			({ measurementId: metricId, comparison, value, unit }) => ({ metricId, comparison, value, unit }),
		),
		[
			{ metricId: 'nativeMedia.editorialAudioPositionErrorSamples', comparison: 'eq', value: 0, unit: 'samples' },
			{ metricId: 'nativeMedia.editorialVideoPositionErrorFrames', comparison: 'eq', value: 0, unit: 'frames' },
			{ metricId: 'nativeMedia.editorialNestedPositionErrorFrames', comparison: 'eq', value: 0, unit: 'frames' },
			{ metricId: 'nativeMedia.editorialMulticameraSyncErrorSamples', comparison: 'eq', value: 0, unit: 'samples' },
		],
	);
});
