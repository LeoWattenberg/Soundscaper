/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createM3FramescaperV18ExitWorkload,
	validateM3FramescaperV18ExitWorkload,
} from '../src/framescaper/quality/m3-framescaper-v18-exit-workload.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { validateFramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';

test('the milestone 3 exit cohort is exact V18 rather than renamed V17 proxy media', () => {
	const first = createM3FramescaperV18ExitWorkload(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE);
	const second = createM3FramescaperV18ExitWorkload(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE);
	validateFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, first.project);
	assert.deepEqual(second, first);
	assert.equal(first.project.schemaVersion, 18);
	assert.equal(first.specification.durationSeconds, 7_200);
	assert.equal(first.specification.sampleRate, 48_000);
	assert.deepEqual(first.specification.frameRates, [
		{ num: 30, den: 1 },
		{ num: 30_000, den: 1_001 },
		{ mode: 'verified-vfr-boundaries' },
	]);
	assert.ok(first.project.sources.some((source) => (
		source.kind === 'video' && source.proxyAttachment !== null
	)));
	assert.ok(first.project.subsequences.length > 0);
	assert.ok(first.project.multicameraGroups.length > 0);
	assert.ok(first.project.sequences.some((sequence) => sequence.startTimecode.hours > 0));
	assert.equal(Object.isFrozen(first), true);
});

test('the V18 exit cohort validates every exact drift checkpoint and refuses tampering', () => {
	const workload = createM3FramescaperV18ExitWorkload(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE);
	const result = validateM3FramescaperV18ExitWorkload(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		workload,
	);
	assert.equal(result.status, 'qualified-input');
	assert.equal(result.maximumAudioErrorSamples, 0);
	assert.equal(result.maximumVideoErrorFrames, 0);
	assert.equal(result.maximumNestedErrorFrames, 0);
	assert.equal(result.maximumMulticameraErrorSamples, 0);
	assert.equal(result.checkpointCount, workload.checkpoints.length);

	const tampered = structuredClone(workload);
	tampered.checkpoints[1]!.observedSample += 1;
	assert.throws(
		() => validateM3FramescaperV18ExitWorkload(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, tampered),
		/drift/iu,
	);
});

test('the cohort authenticates the exact profile before observing workload input', () => {
	let touched = false;
	const input = new Proxy({}, { get() { touched = true; throw new Error('observed'); } });
	assert.throws(
		() => validateM3FramescaperV18ExitWorkload({}, input),
		/profile/iu,
	);
	assert.equal(touched, false);
});
