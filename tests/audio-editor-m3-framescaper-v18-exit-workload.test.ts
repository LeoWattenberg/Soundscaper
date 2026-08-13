/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
	assert.ok(first.project.sequences.some((sequence) => (
		(sequence.startTimecode as Readonly<{ readonly hours: number }>).hours > 0
	)));
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

	const tampered = structuredClone(workload) as unknown as {
		checkpoints: Array<{ observedSample: number }>;
	};
	tampered.checkpoints[1]!.observedSample += 1;
	assert.throws(
		() => validateM3FramescaperV18ExitWorkload(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, tampered),
		/drift/iu,
	);
	const changedProject = structuredClone(workload) as unknown as {
		project: { title: string };
	};
	changedProject.project.title = 'A different valid project';
	assert.throws(
		() => validateM3FramescaperV18ExitWorkload(
			FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
			changedProject,
		),
		/exact.*cohort|cohort.*changed/iu,
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

test('the provisional quality register names the V18 cohort separately from legacy V17 evidence', () => {
	const quality = JSON.parse(readFileSync(new URL('../config/quality-budgets.json', import.meta.url), 'utf8')) as {
		fixtures: Array<Record<string, unknown>>;
		workloads: Array<Record<string, unknown>>;
	};
	const fixture = quality.fixtures.find(({ id }) => id === 'm3-framescaper-v18-exit-2h-v1');
	const workload = quality.workloads.find(({ id }) => id === 'm3-framescaper-v18-exit');
	assert.deepEqual(fixture, {
		id: 'm3-framescaper-v18-exit-2h-v1',
		milestones: ['3'],
		status: 'provisional',
		kind: 'deterministic-framescaper-v18-exit-project-generator',
		specification: {
			schemaVersion: 18,
			durationSeconds: 7200,
			sampleRate: 48000,
			contains: ['attached-proxy', 'nested-sequence', 'multicamera', 'verified-vfr', 'source-timecode'],
			localDiagnosticCommand: 'npm run quality:collect:m3-framescaper-v18-exit',
			qualificationPublication: 'pending-external-only',
		},
		limitation: 'This exact V18 cohort is deterministic structural and zero-drift oracle input. Its opt-in no-retry browser collector can publish pending-external observations only. It does not qualify the unavailable proxy generator, the reviewed retime hard stop, the unprovisioned reference GPU, packaged Electron, or operating-system durability; acceptance requires a separately reviewed external verifier.',
		evidence: [
			'src/framescaper/quality/m3-framescaper-v18-exit-workload.ts',
			'tests/audio-editor-m3-framescaper-v18-exit-workload.test.ts',
			'scripts/collect-m3-framescaper-v18-exit-quality.mjs',
			'tests/browser/framescaper-v18-exit-observation.spec.js',
			'tests/quality-budget-m3-framescaper-v18-exit-collector.test.ts',
		],
	});
	assert.deepEqual(workload, {
		id: 'm3-framescaper-v18-exit',
		milestone: '3',
		status: 'provisional',
		fixtureIds: ['m3-framescaper-v18-exit-2h-v1'],
		environmentIds: ['reference-linux-gpu-01'],
		thresholds: [
			{ metricId: 'framescaperV18.audioPositionErrorSamples', comparison: 'eq', value: 0, unit: 'samples' },
			{ metricId: 'framescaperV18.videoPositionErrorFrames', comparison: 'eq', value: 0, unit: 'frames' },
			{ metricId: 'framescaperV18.nestedPositionErrorFrames', comparison: 'eq', value: 0, unit: 'frames' },
			{ metricId: 'framescaperV18.multicameraSyncErrorSamples', comparison: 'eq', value: 0, unit: 'samples' },
		],
		evidence: [
			'src/framescaper/quality/m3-framescaper-v18-exit-workload.ts',
			'tests/audio-editor-m3-framescaper-v18-exit-workload.test.ts',
			'scripts/collect-m3-framescaper-v18-exit-quality.mjs',
			'tests/browser/framescaper-v18-exit-observation.spec.js',
			'tests/quality-budget-m3-framescaper-v18-exit-collector.test.ts',
		],
	});
});
