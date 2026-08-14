/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectM4B2KeyframeParityDiagnostic,
	createPendingM4B2KeyframeParityResult,
	parseM4B2KeyframeParityCliOptions,
	parseM4B2KeyframeParityDiagnostic,
} from '../scripts/collect-m4b2-keyframe-parity-quality.mjs';
import { makeM4B2KeyframeParityDiagnostic } from './helpers/m4b2-keyframe-parity-fixture.ts';

const MARKER = 'SOUNDSCAPER_M4B2_KEYFRAME_PARITY ';
const OPERATION = 'opacity-linear/interior/composition.opacity';

test('complete keyed frames and dual-consumer ledgers pass only local dormant admission', () => {
	const result = createPendingM4B2KeyframeParityResult(makeM4B2KeyframeParityDiagnostic());
	assert.equal(result.status, 'pending-external');
	assert.equal(result.metricGatePassed, true);
	assert.equal(result.qualificationEvidencePublished, false);
	assert.equal(result.qualificationEnvironmentId, 'reference-linux-gpu-01');
	assert.deepEqual(result.metrics, {
		'keyframes.videoMinimumSsim': 1,
		'keyframes.videoMaximumChannelMae': 0,
		'keyframes.omittedOperations': 0,
		'keyframes.substitutedOperations': 0,
		'keyframes.fallbackOperations': 0,
	});
	assert.deepEqual(result.rawSampleCounts, {
		cases: 4,
		queries: 12,
		videoPixels: 4 * 3 * 128 * 72,
		requestedOperations: 12,
		requestedConsumerOperations: 24,
		renderedConsumerOperations: 24,
	});
	assert.match(result.evaluation.failures.at(-1) ?? '', /registered provisionally.*unprovisioned/iu);
});

test('omission, substitution, and fallback remain distinct zero-count gates', () => {
	for (const [outcome, metric] of [
		['omitted', 'keyframes.omittedOperations'],
		['substituted', 'keyframes.substitutedOperations'],
		['fallback', 'keyframes.fallbackOperations'],
	] as const) {
		const result = createPendingM4B2KeyframeParityResult(
			makeM4B2KeyframeParityDiagnostic({ operationId: OPERATION, outcome }),
		);
		assert.equal(result.status, 'failed');
		assert.equal(result.metricGatePassed, false);
		assert.equal(result.metrics[metric], 2, `${outcome} is counted once per consumer`);
		assert.equal(result.qualificationEvidencePublished, false);
	}
});

test('pixel divergence recomputes SSIM and normalized channel MAE from complete RGBA', () => {
	const diagnostic = makeM4B2KeyframeParityDiagnostic() as {
		cases: Array<{ queries: Array<{ offlineBase64: string }> }>;
	};
	const bytes = Buffer.from(diagnostic.cases[0]!.queries[0]!.offlineBase64, 'base64');
	bytes.fill(0);
	diagnostic.cases[0]!.queries[0]!.offlineBase64 = bytes.toString('base64');
	const result = createPendingM4B2KeyframeParityResult(diagnostic);
	assert.equal(result.status, 'failed');
	assert.ok(result.metrics['keyframes.videoMinimumSsim'] < 0.98);
	assert.ok(result.metrics['keyframes.videoMaximumChannelMae'] > 6 / 255);
});

test('all-source, black, and identical-corruption frames fail the semantic oracle', () => {
	const diagnostic = makeM4B2KeyframeParityDiagnostic() as {
		cases: Array<{ queries: Array<{ offlineBase64: string; previewBase64: string }> }>;
		sourceBase64: string;
	};
	const frameBytes = 128 * 72 * 4;
	const sourceFrame = Buffer.from(diagnostic.sourceBase64, 'base64').subarray(0, frameBytes);
	const blackFrame = Buffer.alloc(frameBytes);
	for (let offset = 3; offset < blackFrame.length; offset += 4) blackFrame[offset] = 255;
	const corruptedFrame = Buffer.from(sourceFrame);
	for (let offset = 0; offset < corruptedFrame.length; offset += 4) {
		corruptedFrame[offset] ^= 0xff;
	}
	for (const replacement of [sourceFrame, blackFrame, corruptedFrame]) {
		const candidate = structuredClone(diagnostic);
		const encoded = replacement.toString('base64');
		for (const parityCase of candidate.cases) {
			for (const query of parityCase.queries) {
				query.previewBase64 = encoded;
				query.offlineBase64 = encoded;
			}
		}
		const result = createPendingM4B2KeyframeParityResult(candidate);
		assert.equal(result.status, 'failed');
		assert.equal(result.metricGatePassed, false);
		assert.ok(result.metrics['keyframes.videoMinimumSsim'] < 0.98);
		assert.ok(result.metrics['keyframes.videoMaximumChannelMae'] > 6 / 255);
	}
});

test('a rendered keyed consumer requires one entry and canonical normal composition', () => {
	const diagnostic = makeM4B2KeyframeParityDiagnostic() as {
		cases: Array<{
			queries: Array<{
				offline: { renderReport: { renderedEntryCount: number } };
				preview: {
					renderReport: {
						composition: { requested: Array<{ blendMode: string }> };
						renderedEntryCount: number;
					};
				};
			}>;
		}>;
	};
	for (const count of [0, 2]) {
		const candidate = structuredClone(diagnostic);
		candidate.cases[0]!.queries[0]!.preview.renderReport.renderedEntryCount = count;
		assert.throws(
			() => createPendingM4B2KeyframeParityResult(candidate),
			/renderedEntryCount.*exactly 1/iu,
		);
	}
	diagnostic.cases[0]!.queries[0]!.preview.renderReport.composition.requested[0]!.blendMode =
		'multiply';
	assert.throws(
		() => createPendingM4B2KeyframeParityResult(diagnostic),
		/canonical normal composition/iu,
	);
});

test('VFR descriptor evidence is exact and independently pinned per query', () => {
	const diagnostic = makeM4B2KeyframeParityDiagnostic() as {
		cases: Array<{
			queries: Array<{
				offlinePresentation: { drawableSourceFrame: number };
				previewPresentation: { drawableSourceFrame: number };
			}>;
		}>;
	};
	diagnostic.cases[3]!.queries[1]!.offlinePresentation.drawableSourceFrame = 7;
	assert.throws(
		() => createPendingM4B2KeyframeParityResult(diagnostic),
		/exact presentation descriptor/iu,
	);
});

test('collector refuses hidden, duplicated, reordered, or forged operation evidence', () => {
	const missing = makeM4B2KeyframeParityDiagnostic() as {
		cases: Array<{ queries: unknown[] }>;
	};
	missing.cases[0]!.queries.pop();
	assert.throws(() => createPendingM4B2KeyframeParityResult(missing), /exactly 3 entries/iu);

	const reordered = makeM4B2KeyframeParityDiagnostic() as {
		cases: Array<{ queries: unknown[] }>;
	};
	reordered.cases[0]!.queries.reverse();
	assert.throws(() => createPendingM4B2KeyframeParityResult(reordered), /exact query inventory/iu);

	const forged = makeM4B2KeyframeParityDiagnostic() as {
		cases: Array<{ queries: Array<{ preview: { operationId: string } }> }>;
	};
	forged.cases[1]!.queries[1]!.preview.operationId = 'forged/operation';
	assert.throws(() => createPendingM4B2KeyframeParityResult(forged), /operationId.*canonical/iu);

	const contradictory = makeM4B2KeyframeParityDiagnostic({
		operationId: OPERATION, outcome: 'omitted',
	}) as { cases: Array<{ queries: Array<{ preview: Record<string, unknown> }> }> };
	const preview = contradictory.cases[1]!.queries[1]!.preview;
	(preview.renderReport as { composition: { omitted: string[]; rendered: string[] } })
		.composition.omitted = [];
	assert.throws(() => createPendingM4B2KeyframeParityResult(contradictory), /partition|omission/iu);
});

test('fixture identity and rendered state values are independently pinned', () => {
	const digest = makeM4B2KeyframeParityDiagnostic() as {
		fixture: { sourceSha256: string };
	};
	digest.fixture.sourceSha256 = '00'.repeat(32);
	assert.throws(() => createPendingM4B2KeyframeParityResult(digest), /frozen.*fixture/iu);

	const source = makeM4B2KeyframeParityDiagnostic() as { sourceBase64: string };
	const sourceBytes = Buffer.from(source.sourceBase64, 'base64');
	sourceBytes[0] ^= 0xff;
	source.sourceBase64 = sourceBytes.toString('base64');
	assert.throws(() => createPendingM4B2KeyframeParityResult(source), /digest is invalid/iu);

	const presentation = makeM4B2KeyframeParityDiagnostic() as {
		cases: Array<{ presentationClass: string; presentationIdentity: string }>;
	};
	presentation.cases[3]!.presentationClass = 'authenticated-cfr-occurrence';
	assert.throws(() => createPendingM4B2KeyframeParityResult(presentation), /frozen keyed case/iu);
	presentation.cases[3]!.presentationClass = 'authenticated-vfr-materialized-occurrence';
	presentation.cases[3]!.presentationIdentity = 'sha256:00';
	assert.throws(() => createPendingM4B2KeyframeParityResult(presentation), /frozen keyed case/iu);

	const state = makeM4B2KeyframeParityDiagnostic() as {
		cases: Array<{ queries: Array<{ preview: { stateValue: number } }> }>;
	};
	state.cases[3]!.queries[1]!.preview.stateValue = 0.5;
	assert.throws(() => createPendingM4B2KeyframeParityResult(state), /exact keyed value/iu);
});

test('marked diagnostic parsing requires exactly one canonical dormant identity', () => {
	const diagnostic = makeM4B2KeyframeParityDiagnostic();
	const line = `${MARKER}${JSON.stringify(diagnostic)}`;
	assert.deepEqual(parseM4B2KeyframeParityDiagnostic(`noise\n${line}\n`), diagnostic);
	assert.throws(() => parseM4B2KeyframeParityDiagnostic('noise'), /exactly one/iu);
	assert.throws(() => parseM4B2KeyframeParityDiagnostic(`${line}\n${line}`), /received 2/iu);
	assert.throws(() => parseM4B2KeyframeParityDiagnostic(`${line} `), /malformed payload/iu);
});

test('CLI and collection refuse reference claims and publish only injected dormant results', async () => {
	assert.deepEqual(parseM4B2KeyframeParityCliOptions([]), { outputDirectory: null });
	assert.deepEqual(parseM4B2KeyframeParityCliOptions(['out']), { outputDirectory: 'out' });
	assert.throws(
		() => parseM4B2KeyframeParityCliOptions(['--reference']),
		/unavailable.*unprovisioned/iu,
	);
	let written: unknown = null;
	const diagnostic = makeM4B2KeyframeParityDiagnostic();
	const collected = await collectM4B2KeyframeParityDiagnostic({ outputDirectory: '/unused' }, {
		runBrowser: async () => ({ stdout: `${MARKER}${JSON.stringify(diagnostic)}\n`, stderr: '' }),
		writeResult: (directory: string, result: unknown) => {
			written = { directory, result };
			return Promise.resolve(written);
		},
	});
	assert.equal(collected, written);
	assert.equal((written as { directory: string }).directory, '/unused');
	assert.equal((written as { result: { status: string } }).result.status, 'pending-external');
});

test('accessor and nonfinite diagnostics fail before invoking or publishing them', () => {
	let calls = 0;
	const diagnostic = makeM4B2KeyframeParityDiagnostic();
	Object.defineProperty(diagnostic, 'cases', {
		enumerable: true,
		get() { calls += 1; return []; },
	});
	assert.throws(() => createPendingM4B2KeyframeParityResult(diagnostic), /own data property/iu);
	assert.equal(calls, 0);

	const nonfinite = makeM4B2KeyframeParityDiagnostic() as {
		cases: Array<{ queries: Array<{ preview: { stateValue: number } }> }>;
	};
	nonfinite.cases[0]!.queries[0]!.preview.stateValue = Number.NaN;
	assert.throws(() => createPendingM4B2KeyframeParityResult(nonfinite), /finite JSON/iu);
});
