/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	createDesktopNightlyTestsMetricsEvidence,
	createDesktopNightlyTestsMetricsPlan,
	createPendingM1VideoPreviewResult,
	parseM1VideoPreviewDiagnostic,
	writeDesktopNightlyTestsMetricsEvidence,
} from '../scripts/lib/desktop-nightly-tests-metrics.mjs';

test('the packaged metrics plan is Chromium-only, single-worker, and no-retry', () => {
	const environment = { PATH: '/usr/bin', GITHUB_ACTIONS: 'true' };
	const plan = createDesktopNightlyTestsMetricsPlan({
		executablePath: '/opt/Soundscaper Tests/soundscaper-tests',
		payloadRoot: '/opt/Soundscaper Tests/resources/nightly-tests',
		runRoot: '/tmp/Soundscaper-playwright-run',
		baseURL: 'http://127.0.0.1:45678',
		environment,
	});

	assert.deepEqual(plan.args, [
		'/opt/Soundscaper Tests/resources/nightly-tests/node_modules/@playwright/test/cli.js',
		'test',
		'--config',
		'/opt/Soundscaper Tests/resources/nightly-tests/playwright.nightly-metrics.config.mjs',
	]);
	assert.equal(plan.logFile, '/tmp/Soundscaper-playwright-run/metrics/console.log');
	assert.equal(plan.env.GITHUB_ACTIONS, 'false');
	assert.equal(plan.env.SOUNDSCAPER_M4_PRODUCTION_PARITY, '1');
	assert.equal(plan.env.SOUNDSCAPER_M4B2_KEYFRAME_PARITY, '1');
	assert.equal(plan.env.SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK, '1');
	assert.equal(plan.env.AUDIO_EDITOR_FFMPEG_BROWSER, '1');
	assert.equal(plan.env.SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID, 'local-browser-correctness');
	assert.deepEqual(environment, { PATH: '/usr/bin', GITHUB_ACTIONS: 'true' });
});

test('the M1 preview collector evaluates 720p frame timing and retained heap', () => {
	const diagnostic = {
		resolution: [1_280, 720],
		effects: Array.from({ length: 12 }, (_, index) => `effect-${String(index)}`),
		warmupFrames: 10,
		measuredFrames: 121,
		measuredIntervals: 120,
		p95Ms: 30,
		retainedJsHeapDeltaBytes: 512_000,
		renderer: { vendor: 'Example', renderer: 'Example GPU' },
		browserVersion: '149.0.0.0',
		browserEnvironment: { hardwareConcurrency: 8 },
	};
	const output = `noise\nSOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK ${JSON.stringify(diagnostic)}\n`;
	assert.deepEqual(parseM1VideoPreviewDiagnostic(output), diagnostic);
	const result = createPendingM1VideoPreviewResult(diagnostic, {
		fixtures: [{ id: 'video-preview-12fx-720p-v1', specification: {
			width: 1_280, height: 720, effectCount: 12, measuredIntervals: 120,
		} }],
		workloads: [{ id: 'm1-video-preview-12fx-720p', thresholds: [
			{ metricId: 'preview.frameIntervalP95Ms', comparison: 'lte', value: 33.34 },
			{ metricId: 'preview.retainedJsHeapDeltaBytes', comparison: 'lte', value: 1_048_576 },
		] }],
	});
	assert.equal(result.metricGatePassed, true);
	assert.deepEqual(result.metrics, {
		'preview.frameIntervalP95Ms': 30,
		'preview.retainedJsHeapDeltaBytes': 512_000,
	});
});

test('downloadable-host metric evidence can pass gates but never self-qualifies', () => {
	const collectors = [
		{
			workloadId: 'metric-pass',
			parse: () => ({ samples: [1, 2, 3] }),
			evaluate: () => ({
				status: 'accepted',
				qualificationEvidencePublished: true,
				metricGatePassed: true,
				metrics: { 'metric.value': 3 },
				evaluation: { passed: true, failures: [], verdicts: [{ passed: true }] },
			}),
			metricGatePassed: (result: Readonly<Record<string, unknown>>) => result.metricGatePassed === true,
		},
	];
	const evidence = createDesktopNightlyTestsMetricsEvidence({
		consoleOutput: 'raw diagnostic',
		config: { measurementPolicy: { timingWorkers: 1, benchmarkRetries: 0 } },
		sourceRevision: 'a'.repeat(40),
		budgetSha256: 'b'.repeat(64),
		playwrightExit: { code: 0, signal: null },
	}, { collectors });

	assert.equal(evidence.summary.collectionPassed, true);
	assert.equal(evidence.summary.qualificationEvidencePublished, false);
	assert.deepEqual(evidence.raw.diagnostics, { 'metric-pass': { samples: [1, 2, 3] } });
	assert.equal(evidence.summary.workloads[0].status, 'pending-external');
	assert.equal(evidence.summary.workloads[0].qualificationEvidencePublished, false);
	assert.equal(evidence.summary.workloads[0].evaluation.passed, false);
	assert.match(
		evidence.summary.workloads[0].evaluation.failures.at(-1) ?? '',
		/downloadable nightly host.*not a qualified environment/iu,
	);
});

test('packaged evidence publishes formal M4 qualification only for the owner-designated host', () => {
	const fingerprint = {
		browserVersion: '150.0.7871.114', platform: 'win32', architecture: 'x64',
		webglVendor: 'Google Inc. (NVIDIA)',
		webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 (0x00002204) Direct3D11 vs_5_0 ps_5_0, D3D11)',
	};
	const metrics = { 'parity.silentlyOmittedEffects': 0 };
	const diagnostic = {
		schemaVersion: 1, profile: 'deterministic-production-parity-v1',
		observationClass: 'complete-pcm-rgba-render-ledger-v1',
		workloadId: 'm4-production-render-parity', fixtureId: 'm4-production-parity-v1',
		environmentId: 'packaged-runtime-win32-x64', rendererClass: 'hardware',
		environmentFingerprint: fingerprint,
	};
	const config = {
		measurementPolicy: { timingWorkers: 1, benchmarkRetries: 0 },
		packagedRuntimeQualification: {
			status: 'active', environmentId: 'owner-qualified-windows-x64-rtx3090-01',
			observedEnvironmentId: 'packaged-runtime-win32-x64',
			workloadId: diagnostic.workloadId, fixtureId: diagnostic.fixtureId,
			profile: diagnostic.profile, observationClass: diagnostic.observationClass,
			rendererClass: 'hardware', fingerprint,
		},
		workloads: [{ id: diagnostic.workloadId, thresholds: [{ metricId: 'parity.silentlyOmittedEffects' }] }],
	};
	const evidence = createDesktopNightlyTestsMetricsEvidence({
		consoleOutput: 'raw diagnostic', config,
		sourceRevision: 'a'.repeat(40), budgetSha256: 'b'.repeat(64),
		playwrightExit: { code: 1, signal: null },
	}, { evidenceKind: 'packaged-runtime', collectors: [{
		workloadId: 'm4-production-parity', parse: () => diagnostic,
		evaluate: () => ({ ...diagnostic, attemptCount: 1, retryCount: 0,
			metricGatePassed: true, metrics,
			evaluation: { passed: false, failures: [], verdicts: [{ metricId: 'parity.silentlyOmittedEffects', passed: true }] },
		}),
		metricGatePassed: () => true,
	}] });

	assert.equal(evidence.passed, false, 'the unrelated Playwright failure remains visible');
	assert.equal(evidence.qualification?.status, 'accepted');
	assert.equal(evidence.summary.qualificationEvidencePublished, true);
	assert.equal(evidence.summary.workloads[0].status, 'accepted');
	assert.equal(evidence.summary.workloads[0].qualificationEvidencePublished, true);
});

test('metric evidence records partial diagnostics and fails closed', () => {
	const evidence = createDesktopNightlyTestsMetricsEvidence({
		consoleOutput: 'partial output',
		config: {},
		sourceRevision: null,
		budgetSha256: 'c'.repeat(64),
		playwrightExit: { code: 1, signal: null },
	}, { collectors: [
		{
			workloadId: 'metric-fail',
			parse: () => ({ sample: 8 }),
			evaluate: () => ({ status: 'failed', metrics: { value: 8 } }),
			metricGatePassed: () => false,
		},
		{
			workloadId: 'missing-marker',
			parse: () => { throw new Error('marker missing'); },
			evaluate: () => assert.fail('unreachable'),
			metricGatePassed: () => true,
		},
	] });

	assert.equal(evidence.summary.collectionPassed, false);
	assert.deepEqual(evidence.raw.diagnostics, { 'metric-fail': { sample: 8 } });
	assert.equal(evidence.summary.workloads[0].status, 'failed');
	assert.deepEqual(evidence.summary.failures, [
		'Playwright metrics exited with code 1.',
		'metric-fail did not pass its metric thresholds.',
		'missing-marker: marker missing',
	]);
});

test('metric evidence writer retains raw diagnostics and a digest-bound summary', async (context) => {
	const runRoot = await mkdtemp(join(tmpdir(), 'soundscaper-nightly-metrics-'));
	context.after(() => rm(runRoot, { recursive: true, force: true }));
	const payloadRoot = join(runRoot, 'payload');
	await mkdir(join(payloadRoot, 'config'), { recursive: true });
	await writeFile(join(runRoot, 'console.log'), 'diagnostic marker', 'utf8');
	await writeFile(join(payloadRoot, 'config/quality-budgets.json'), '{"measurementPolicy":{"timingWorkers":1}}\n', 'utf8');

	const written = await writeDesktopNightlyTestsMetricsEvidence({
		payloadRoot,
		runRoot,
		sourceRevision: 'd'.repeat(40),
		playwrightExit: { code: 0, signal: null },
		consoleLogPath: join(runRoot, 'console.log'),
	}, { collectors: [{
		workloadId: 'metric-pass',
		parse: () => ({ sample: 1 }),
		evaluate: () => ({ status: 'pending-external', metrics: { value: 1 } }),
		metricGatePassed: () => true,
	}] });

	assert.equal(written.passed, true);
	const summary = JSON.parse(await readFile(join(runRoot, 'metrics/summary.json'), 'utf8'));
	const raw = JSON.parse(await readFile(join(runRoot, 'metrics/raw.json'), 'utf8'));
	assert.match(summary.budgetSha256, /^[a-f\d]{64}$/u);
	assert.equal(summary.sourceRevision, 'd'.repeat(40));
	assert.deepEqual(raw.diagnostics, { 'metric-pass': { sample: 1 } });
});
