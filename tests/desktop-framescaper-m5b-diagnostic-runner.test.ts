/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	runFramescaperM5bDiagnostic,
	type FramescaperM5bDiagnosticRequest,
	type FramescaperM5bDiagnosticSink,
	type FramescaperM5bObservedRuntimeProfile,
} from '../desktop/framescaper-m5b-diagnostic-runner.ts';

const PERSISTENT_METRICS = Object.freeze([
	'nativeServices.unrecoveredJobs',
	'nativeServices.partialPublications',
	'nativeServices.unauthorizedGrants',
	'nativeServices.traversalEscapes',
	'nativeServices.duplicateWatchImports',
	'nativeServices.externalFileDeletions',
	'nativeServices.duplicateDispatches',
]);

const OPENFX_METRICS = Object.freeze([
	'ofx.uncontainedFailures',
	'ofx.editorTakedowns',
	'ofx.silentEffectOmissions',
	'ofx.authoredStateLosses',
	'ofx.unsupportedTargets',
	'ofx.hostProcessTreeRssBytes',
]);

const PROFILE: FramescaperM5bObservedRuntimeProfile = Object.freeze({
	architecture: 'x64',
	displayIdentity: 'DisplayPort-1 (primary)',
	displayServer: 'X11 / XWayland',
	driverVersion: 'Mesa 26.1.0',
	exercisedCapabilityIds: Object.freeze(['persistent-queue', 'watch-folder', 'scratch-volume']),
	gpuModel: 'AMD Radeon fixture GPU',
	helperBinarySha256: '1'.repeat(64),
	mediaDecodeBackend: 'native-cpu',
	mediaEncodeBackend: 'native-cpu',
	mediaHostSha256: '2'.repeat(64),
	nativeAddonSha256: null,
	ofxGpuBackend: 'cpu',
	ofxRuntimeHostSha256: null,
	ofxScannerSha256: null,
	osImage: 'Ubuntu 26.04 LTS',
	osVersion: '26.04.1 (fixture)',
	packageSha256: '3'.repeat(64),
	platformId: 'linuxX64',
	rendererClass: 'software',
	workloadRunnerSha256: '4'.repeat(64),
});

const REQUEST = Object.freeze({
	profileId: 'persistent-services' as const,
	workloadId: 'm5b-persistent-services-recovery',
	fixtureId: 'm5b-persistent-services-fault-v1',
	timeoutMs: 1_000,
});

test('M5B diagnostic runner emits only exact raw profile observations', async () => {
	const result = await runFramescaperM5bDiagnostic(REQUEST, {
		run(request: Readonly<FramescaperM5bDiagnosticRequest>, sink: FramescaperM5bDiagnosticSink,
			signal: AbortSignal) {
			assert.deepEqual(request, REQUEST);
			assert.equal(signal.aborted, false);
			for (const [index, metricId] of PERSISTENT_METRICS.entries()) sink.observe(metricId, index);
			return PROFILE;
		},
	});
	assert.deepEqual(Object.keys(result), ['observedRuntimeProfile', 'observations']);
	assert.deepEqual(Object.keys(result.observations), PERSISTENT_METRICS);
	assert.deepEqual(result.observations[PERSISTENT_METRICS[3]!], [3]);
	assert.equal(Object.hasOwn(result, 'metrics'), false);
	assert.equal(Object.hasOwn(result, 'sampleCounts'), false);
	assert.equal(Object.isFrozen(result.observedRuntimeProfile), true);
});

test('M5B OpenFX diagnostics report unsupported target counts directly', async () => {
	const request = Object.freeze({
		profileId: 'openfx' as const,
		workloadId: 'm5b-openfx-isolation-and-packaging',
		fixtureId: 'm5b-openfx-conformance-and-hostile-v1',
		timeoutMs: 1_000,
	});
	const profile = Object.freeze({
		...PROFILE,
		exercisedCapabilityIds: Object.freeze(['openfx-scan', 'openfx-render', 'openfx-hostile-suite']),
	});
	const result = await runFramescaperM5bDiagnostic(request, {
		run(_request: Readonly<FramescaperM5bDiagnosticRequest>, sink: FramescaperM5bDiagnosticSink) {
			for (const metricId of OPENFX_METRICS) sink.observe(metricId, 0);
			return profile;
		},
	});
	assert.deepEqual(Object.keys(result.observations), OPENFX_METRICS);
});

test('M5B diagnostic runner rejects aggregate substitution and incomplete samples', async () => {
	await assert.rejects(runFramescaperM5bDiagnostic(REQUEST, {
		run(_request: Readonly<FramescaperM5bDiagnosticRequest>, sink: FramescaperM5bDiagnosticSink) {
			for (const metricId of PERSISTENT_METRICS.slice(0, -1)) sink.observe(metricId, 0);
			return PROFILE;
		},
	}), /has no observations/u);
	await assert.rejects(runFramescaperM5bDiagnostic(REQUEST, {
		run(_request: Readonly<FramescaperM5bDiagnosticRequest>, sink: FramescaperM5bDiagnosticSink) {
			assert.throws(() => sink.observe('nativeServices.aggregatePasses', 1), /not registered/u);
			for (const metricId of PERSISTENT_METRICS) sink.observe(metricId, 0);
			return { ...PROFILE, sampleCounts: Object.create(null) };
		},
	}), /unsupported fields/u);
});
