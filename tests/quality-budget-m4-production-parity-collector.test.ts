import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createM4ProductionParityAudioFixture, encodeM4ProductionParityAudio } from '../src/common/editor/quality/m4-production-parity-workload.ts';
import {
	collectM4ProductionParityDiagnostic,
	createPendingM4ProductionParityResult,
	parseM4ProductionParityCliOptions,
	parseM4ProductionParityDiagnostic,
	resolveM4ProductionParityCollectionEnvironment,
	writeM4ProductionParityResult,
} from '../scripts/collect-m4-production-parity-quality.mjs';
import {
	makeM4ProductionParityDiagnostic as makeDiagnostic,
	toBase64,
} from './helpers/m4-production-parity-fixture.ts';

const config = JSON.parse(await readFile(
	new URL('../config/quality-budgets.json', import.meta.url),
	'utf8',
)) as unknown;
const packageMetadata = JSON.parse(await readFile(
	new URL('../package.json', import.meta.url),
	'utf8',
)) as { readonly scripts: Readonly<Record<string, string>> };
type QualityConfig = {
	fixtures: Array<{ id: string; kind: string; artifacts?: unknown[] }>;
	measurements: Array<{ id: string; behavior: string }>;
	thresholds: Array<{ measurementId: string; comparison: string; value: number; unit: string }>;
	workloads: Array<{ id: string; behavior: string; measurementIds: string[] }>;
};

test('the M4 collector independently recomputes exactly five parity metrics', () => {
	const result = createPendingM4ProductionParityResult(makeDiagnostic(), config);
	assert.equal(result.status, 'passed');
	assert.equal(result.environmentId, 'local-runtime-diagnostics');
	assert.equal(result.metricGatePassed, true);
	assert.equal(Object.keys(result.metrics).length, 5);
	assert.deepEqual(result.metrics, {
		'parity.audioMaximumAbsoluteSampleError': 0,
		'parity.pdcErrorSamples': 0,
		'parity.videoMinimumSsim': 1,
		'parity.videoMaximumChannelMae': 0,
		'parity.silentlyOmittedEffects': 0,
	});
	assert.deepEqual(result.rawSampleCounts, {
		audioChannels: 2,
		audioFrames: 48_000,
		videoCases: 13,
		videoPixels: 119_808,
		requestedEffectInstances: 3,
		requestedCompositionInstances: 18,
	});
	assert.equal(result.evaluation.passed, true);
	assert.deepEqual(result.evaluation.failures, []);
});
test('the M4 collector reports gross PDC shifts outside the former local search window', () => {
	const diagnostic = makeDiagnostic();
	const audio = createM4ProductionParityAudioFixture();
	const shifted = audio.reference.map((channel) => channel.slice());
	const expected = diagnostic.fixture.outputImpulseFrames[0];
	shifted[0]![expected] = 0.001;
	shifted[0]![expected + 100] = 1;
	diagnostic.audio.previewBase64 = toBase64(encodeM4ProductionParityAudio(shifted));

	const result = createPendingM4ProductionParityResult(diagnostic, config);
	assert.equal(result.metrics['parity.pdcErrorSamples'], 100);
	assert.equal(result.status, 'failed');
	shifted[0]![expected + 110] = -1;
	diagnostic.audio.previewBase64 = toBase64(encodeM4ProductionParityAudio(shifted));
	assert.equal(
		createPendingM4ProductionParityResult(diagnostic, config)
			.metrics['parity.pdcErrorSamples'],
		100,
	);
});

test('one deliberately unreported effect produces one omission and fails the zero budget', () => {
	const result = createPendingM4ProductionParityResult(
		makeDiagnostic('m4-deliberately-omitted-effect'),
		config,
	);
	assert.equal(result.metrics['parity.silentlyOmittedEffects'], 1);
	assert.equal(result.status, 'failed');
	assert.equal(result.metricGatePassed, false);
	const verdict = result.evaluation.verdicts.find(
		({ metricId }: { metricId: string }) => metricId === 'parity.silentlyOmittedEffects',
	);
	assert.equal(verdict?.passed, false);
	assert.match(result.evaluation.failures.join('\n'), /silentlyOmittedEffects/iu);
});

test('visible fallback remains unrendered work and fails the zero parity gate', () => {
	const diagnostic = makeDiagnostic();
	const report = diagnostic.videoCases[0].renderReport;
	report.status = 'fallback';
	report.effects.rendered = [];
	report.effects.fallbackRendered = [...report.effects.requested];
	const result = createPendingM4ProductionParityResult(diagnostic, config);
	assert.equal(result.metrics['parity.silentlyOmittedEffects'], 1);
});

test('fixture drift, truncated evidence, and dishonest ledgers fail closed', () => {
	const diagnostic = makeDiagnostic();
	assert.throws(
		() => createPendingM4ProductionParityResult({
			...diagnostic,
			fixture: { ...diagnostic.fixture, frameCount: 47_999 },
		}, config),
		/fixture/iu,
	);
	assert.throws(
		() => createPendingM4ProductionParityResult({
			...diagnostic,
			audio: { ...diagnostic.audio, previewBase64: diagnostic.audio.previewBase64.slice(4) },
		}, config),
		/audio evidence/iu,
	);
	const dishonest = structuredClone(diagnostic);
	dishonest.videoCases[0].renderReport.effects.omitted = ['not-requested'];
	assert.throws(() => createPendingM4ProductionParityResult(dishonest, config), /partition/iu);
	const sixthMetric = structuredClone(config) as QualityConfig;
	const workload = sixthMetric.workloads.find(({ id }) => id === 'm4-production-render-parity');
	assert.ok(workload);
	workload.measurementIds.push('parity.unregisteredSixthMetric');
	sixthMetric.measurements.push({ id: 'parity.unregisteredSixthMetric', behavior: 'blocking' });
	sixthMetric.thresholds.push({
		measurementId: 'parity.unregisteredSixthMetric', comparison: 'eq', value: 0, unit: 'count',
	});
	assert.throws(
		() => createPendingM4ProductionParityResult(diagnostic, sixthMetric),
		/five measurements/iu,
	);
});

test('video evidence requires the exact ordered effect and composition inventory and registered digests', () => {
	const missing = makeDiagnostic();
	missing.videoCases.pop();
	assert.throws(() => createPendingM4ProductionParityResult(missing, config), /13 through 13/iu);

	const duplicate = makeDiagnostic();
	duplicate.videoCases[1] = structuredClone(duplicate.videoCases[0]!);
	assert.throws(() => createPendingM4ProductionParityResult(duplicate, config), /case inventory/iu);

	const unknown = makeDiagnostic();
	(unknown.videoCases[0]! as { fixtureArtifactId: string }).fixtureArtifactId = 'unknown';
	assert.throws(() => createPendingM4ProductionParityResult(unknown, config), /case inventory/iu);

	const reordered = makeDiagnostic();
	[reordered.videoCases[0], reordered.videoCases[1]] = [
		reordered.videoCases[1]!,
		reordered.videoCases[0]!,
	];
	assert.throws(() => createPendingM4ProductionParityResult(reordered, config), /case inventory/iu);

	const corrupt = makeDiagnostic();
	const corruptBytes = Buffer.from(corrupt.videoCases[0]!.fixtureBase64, 'base64');
	corruptBytes[0] ^= 1;
	corrupt.videoCases[0]!.fixtureBase64 = toBase64(corruptBytes);
	assert.throws(() => createPendingM4ProductionParityResult(corrupt, config), /registered RGBA golden/iu);

	const wrongGeometry = makeDiagnostic();
	wrongGeometry.videoCases[0]!.width = 127;
	assert.throws(() => createPendingM4ProductionParityResult(wrongGeometry, config), /frozen video geometry/iu);
});

test('collector identity, specification, raw evidence, and config snapshots reject hostile data', () => {
	let getterReads = 0;
	const rawAccessor = makeDiagnostic();
	Object.defineProperty(rawAccessor.audio, 'previewBase64', {
		enumerable: true,
		get() {
			getterReads += 1;
			return '';
		},
	});
	assert.throws(() => createPendingM4ProductionParityResult(rawAccessor, config), /own data/iu);
	assert.equal(getterReads, 0);

	const configAccessor = structuredClone(config) as Record<string, unknown>;
	Object.defineProperty(configAccessor, 'workloads', {
		enumerable: true,
		get() {
			getterReads += 1;
			return {};
		},
	});
	assert.throws(
		() => createPendingM4ProductionParityResult(makeDiagnostic(), configAccessor),
		/own data/iu,
	);
	assert.equal(getterReads, 0);

	const unsafeSpecification = makeDiagnostic();
	Object.defineProperty(unsafeSpecification.fixture, '__proto__', {
		enumerable: true,
		value: { hidden: true },
	});
	assert.throws(
		() => createPendingM4ProductionParityResult(unsafeSpecification, config),
		/safe string-keyed/iu,
	);
	const symbolicIdentity = makeDiagnostic() as ReturnType<typeof makeDiagnostic> & {
		[key: symbol]: boolean;
	};
	symbolicIdentity[Symbol('hidden-identity')] = true;
	assert.throws(
		() => createPendingM4ProductionParityResult(symbolicIdentity, config),
		/safe string-keyed/iu,
	);

	const sparseRawCases = makeDiagnostic();
	delete sparseRawCases.videoCases[5];
	assert.throws(
		() => createPendingM4ProductionParityResult(sparseRawCases, config),
		/dense own-data array/iu,
	);
	const extraArrayKey = makeDiagnostic();
	Object.defineProperty(extraArrayKey.videoCases, 'unreviewed', { value: true });
	assert.throws(
		() => createPendingM4ProductionParityResult(extraArrayKey, config),
		/extra or symbol array keys/iu,
	);
});

test('the diagnostic parser admits exactly one matching structured record', () => {
	const diagnostic = makeDiagnostic();
	const line = `SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify(diagnostic)}`;
	assert.deepEqual(parseM4ProductionParityDiagnostic(`noise\n${line}\n`), diagnostic);
	assert.throws(() => parseM4ProductionParityDiagnostic('no diagnostic'), /exactly one/iu);
	assert.throws(() => parseM4ProductionParityDiagnostic(`${line}\n${line}\n`), /exactly one/iu);
	assert.throws(
		() => parseM4ProductionParityDiagnostic(JSON.stringify(diagnostic)),
		/exactly one/iu,
	);
	assert.throws(
		() => parseM4ProductionParityDiagnostic(`arbitrary prefix ${JSON.stringify(diagnostic)}`),
		/exactly one/iu,
	);
	assert.throws(
		() => parseM4ProductionParityDiagnostic(
			`SOUNDSCAPER_M4_PRODUCTION_PARITY {not-json\n${line}`,
		),
		/malformed/iu,
	);
	assert.throws(
		() => parseM4ProductionParityDiagnostic(
			`SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify({ unrelated: true })}\n${line}`,
		),
		/does not match/iu,
	);
});

test('metric diagnostics write only passed or failed results', async () => {
	const result = createPendingM4ProductionParityResult(makeDiagnostic(), config);
	const directory = await mkdtemp(join(tmpdir(), 'soundscaper-m4-parity-'));
	const written = await writeM4ProductionParityResult(directory, result);
	assert.equal(
		written.resultPath,
		join(directory, 'm4-production-render-parity.passed.json'),
	);
	const persisted = JSON.parse(await readFile(written.resultPath, 'utf8'));
	assert.equal(persisted.status, 'passed');
	await assert.rejects(
		writeM4ProductionParityResult(directory, result),
		/exists|EEXIST/iu,
	);
	assert.throws(
		() => writeM4ProductionParityResult(directory, { ...result, status: 'accepted' }),
		/only passed or failed/iu,
	);
	await assert.rejects(
		readFile(join(directory, 'm4-production-render-parity.accepted.json')),
		/ENOENT/iu,
	);
	await assert.rejects(
		readFile(join(directory, 'm4-production-render-parity.raw.json')),
		/ENOENT/iu,
	);
});

test('collection identity admits local, hosted, and packaged diagnostics only', () => {
	assert.deepEqual(
		resolveM4ProductionParityCollectionEnvironment({}, config, {}),
		{ environmentId: 'local-runtime-diagnostics' },
	);
	assert.deepEqual(
		resolveM4ProductionParityCollectionEnvironment({}, config, { GITHUB_ACTIONS: 'true' }),
		{ environmentId: 'github-ubuntu-playwright-1.62.1' },
	);
	assert.deepEqual(resolveM4ProductionParityCollectionEnvironment({}, config, {
		SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID: 'packaged-runtime-win32-x64',
	}), { environmentId: 'packaged-runtime-win32-x64' });
	const hosted = makeDiagnostic();
	hosted.environmentId = 'github-ubuntu-playwright-1.62.1';
	assert.equal(createPendingM4ProductionParityResult(hosted, config).status, 'passed');
	const invented = makeDiagnostic();
	invented.environmentId = 'invented-host';
	assert.throws(
		() => createPendingM4ProductionParityResult(invented, config),
		/frozen M4 workload/iu,
	);
	assert.throws(
		() => resolveM4ProductionParityCollectionEnvironment({}, config, {
			SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID: 'invented-host',
		}),
		/not an admitted diagnostic environment/iu,
	);
	assert.throws(
		() => resolveM4ProductionParityCollectionEnvironment({ qualificationMode: 'reference' }, config),
		/exact fields/iu,
	);
});

test('packaged collection writes the observed diagnostic result', async () => {
	const diagnostic = makeDiagnostic();
	diagnostic.environmentId = 'packaged-runtime-win32-x64';
	let writes = 0;
	const collected = await collectM4ProductionParityDiagnostic(
		{ outputDirectory: '/unused' },
		{
			config,
			processEnvironment: {
				SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID: diagnostic.environmentId,
			},
			runBrowser: async () => ({
				stdout: `SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify(diagnostic)}`,
				stderr: '',
			}),
			writeResult: async (_directory: string, result: unknown) => {
				writes += 1;
				return { result };
			},
		},
	);
	assert.equal(writes, 1);
	assert.equal(collected.result.status, 'passed');

	const relabeled = makeDiagnostic();
	await assert.rejects(
		collectM4ProductionParityDiagnostic(
			{ outputDirectory: '/unused' },
			{
				config,
				processEnvironment: {
					SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID: 'packaged-runtime-win32-x64',
				},
				runBrowser: async () => ({
					stdout: `SOUNDSCAPER_M4_PRODUCTION_PARITY ${JSON.stringify(relabeled)}`,
					stderr: '',
				}),
				writeResult: async () => { writes += 1; },
			},
		),
		/relabeled its collection environment/iu,
	);
	assert.equal(writes, 1);
});

test('CLI parsing accepts one output directory and rejects the removed reference option', () => {
	assert.deepEqual(parseM4ProductionParityCliOptions(['/tmp/result']), {
		outputDirectory: '/tmp/result',
	});
	assert.deepEqual(parseM4ProductionParityCliOptions([]), { outputDirectory: null });
	assert.throws(() => parseM4ProductionParityCliOptions(['--reference']), /unknown/iu);
	assert.throws(() => parseM4ProductionParityCliOptions(['--unknown']), /unknown/iu);
	assert.throws(() => parseM4ProductionParityCliOptions(['/one', '/two']), /one output/iu);
});

test('quality config retains the M4 diagnostic fixture and thresholds', () => {
	const quality = config as QualityConfig;
	const fixture = quality.fixtures.find(({ id }) => id === 'm4-production-parity-v1');
	const workload = quality.workloads.find(({ id }) => id === 'm4-production-render-parity');
	assert.equal(fixture?.kind, 'deterministic-audio-vectors-and-video-golden-frames');
	assert.equal(fixture?.artifacts?.length, 5);
	assert.equal(workload?.behavior, 'blocking');
	assert.equal(workload?.measurementIds.length, 5);
	assert.equal(Object.hasOwn(quality, 'environments'), false);
	assert.equal(packageMetadata.scripts['quality:collect:m4-production-parity'],
		'node scripts/collect-m4-production-parity-quality.mjs');
});
