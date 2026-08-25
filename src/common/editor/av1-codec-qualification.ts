/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Data-only AV1 implementation qualification.
 *
 * Callers supply measurements and reviewed thresholds. This module performs no
 * benchmark, discovers no executable, and contains no claimed measurements.
 * Every comparison is over one shared corpus identity, so encoder throughput
 * cannot be admitted using an unmatched bitrate or quality point.
 */

import { createNativeValidators } from './native-validation.ts';

export const AV1_QUALIFICATION_SCHEMA_VERSION = 1;
export const AV1_QUALIFICATION_TARGETS = Object.freeze([
	'linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64',
] as const);
export type Av1QualificationTarget = typeof AV1_QUALIFICATION_TARGETS[number];

export type Av1QualificationResolution = '1080p' | '4k';
export type Av1QualificationBitDepth = 8 | 10;
export type Av1QualificationContent = 'film' | 'animation' | 'screen';
export interface Av1QualificationCorpusCase {
	readonly resolution: Av1QualificationResolution;
	readonly bitDepth: Av1QualificationBitDepth;
	readonly content: Av1QualificationContent;
}

const CORPUS_CASES: Av1QualificationCorpusCase[] = [];
for (const resolution of ['1080p', '4k'] as const) {
	for (const bitDepth of [8, 10] as const) {
		for (const content of ['film', 'animation', 'screen'] as const) {
			CORPUS_CASES.push(Object.freeze({ resolution, bitDepth, content }));
		}
	}
}
export const AV1_QUALIFICATION_CORPUS_CASES = Object.freeze(CORPUS_CASES);

export interface Av1QualificationThresholdsV1 {
	readonly maximumDav1dCpuTimeRatio: number;
	readonly maximumDav1dPeakRssRatio: number;
	readonly minimumEncoderThroughputFps: number;
	readonly maximumBitrateDeltaRatio: number;
	readonly minimumVmaf: number;
	readonly minimumSsim: number;
	readonly maximumVmafDelta: number;
	readonly maximumSsimDelta: number;
}

export type Av1BenchmarkOperatingSystem = 'linux' | 'macos' | 'windows';
export type Av1BenchmarkCpuArchitecture = 'x64' | 'arm64';
export interface Av1BenchmarkEnvironmentV1 {
	readonly operatingSystem: Av1BenchmarkOperatingSystem;
	readonly operatingSystemVersion: string;
	readonly cpuModel: string;
	readonly cpuArchitecture: Av1BenchmarkCpuArchitecture;
	readonly logicalCoreCount: number;
}

export interface Av1CodecBuildIdentityV1 {
	readonly version: string;
	readonly buildSha256: string;
}
export interface Av1BenchmarkToolchainV1 {
	readonly dav1d: Av1CodecBuildIdentityV1;
	readonly libaom: Av1CodecBuildIdentityV1;
	readonly 'svt-av1': Av1CodecBuildIdentityV1;
	readonly benchmarkHarnessSha256: string;
}

/** One reviewed settings manifest owns both presets and every paired invocation. */
export interface Av1EncoderSettingsIdentityV1 {
	readonly settingsSha256: string;
	readonly threadCount: number;
	readonly svtAv1Preset: string;
	readonly libaomPreset: string;
}

export interface Av1BenchmarkIdentityV1 {
	readonly environment: Av1BenchmarkEnvironmentV1;
	readonly toolchain: Av1BenchmarkToolchainV1;
	readonly encoderSettings: Av1EncoderSettingsIdentityV1;
}
export interface Av1DecodeMeasurementV1 {
	readonly correct: boolean;
	readonly cpuTimeMs: number;
	readonly peakRssBytes: number;
}

export interface Av1EncodeMeasurementV1 {
	readonly correct: boolean;
	readonly throughputFps: number;
	readonly bitrateKbps: number;
	readonly vmaf: number;
	readonly ssim: number;
}

export interface Av1QualificationEvidenceRowV1 {
	readonly target: Av1QualificationTarget;
	readonly benchmark: Av1BenchmarkIdentityV1;
	readonly corpus: Av1QualificationCorpusCase & Readonly<{ readonly sourceSha256: string }>;
	readonly decode: Readonly<{
		readonly dav1d: Av1DecodeMeasurementV1;
		readonly libaom: Av1DecodeMeasurementV1;
	}>;
	readonly encode: Readonly<{
		readonly 'svt-av1': Av1EncodeMeasurementV1;
		readonly libaom: Av1EncodeMeasurementV1;
	}>;
}

export interface Av1QualificationInputV1 {
	readonly schemaVersion: typeof AV1_QUALIFICATION_SCHEMA_VERSION;
	readonly thresholds: Av1QualificationThresholdsV1;
	readonly evidence: readonly Av1QualificationEvidenceRowV1[];
}

export const AV1_DECODE_QUALIFICATION_FAILURES = Object.freeze([
	'incomplete-corpus-evidence',
	'dav1d-correctness-failed',
	'libaom-comparison-correctness-failed',
	'dav1d-cpu-time-threshold-failed',
	'dav1d-peak-rss-threshold-failed',
] as const);
export type Av1DecodeQualificationFailure = typeof AV1_DECODE_QUALIFICATION_FAILURES[number];

export const AV1_ENCODE_QUALIFICATION_FAILURES = Object.freeze([
	'incomplete-corpus-evidence',
	'bitrate-not-matched',
	'vmaf-not-matched',
	'ssim-not-matched',
	'correctness-failed',
	'throughput-threshold-failed',
	'vmaf-threshold-failed',
	'ssim-threshold-failed',
] as const);
export type Av1EncodeQualificationFailure = typeof AV1_ENCODE_QUALIFICATION_FAILURES[number];

export interface Av1DecodeQualificationDecisionV1 {
	readonly defaultCandidate: 'dav1d';
	readonly comparedAgainst: 'libaom';
	readonly admitted: boolean;
	readonly selected: 'dav1d' | null;
	readonly failures: readonly Av1DecodeQualificationFailure[];
}

export interface Av1EncodeQualificationDecisionV1 {
	readonly defaultCandidate: 'svt-av1';
	readonly fallbackCandidate: 'libaom' | null;
	readonly admitted: boolean;
	readonly selected: 'svt-av1' | 'libaom' | null;
	readonly defaultFailures: readonly Av1EncodeQualificationFailure[];
	readonly fallbackFailures: readonly Av1EncodeQualificationFailure[] | null;
}

export interface Av1TargetQualificationDecisionV1<T extends Av1QualificationTarget = Av1QualificationTarget> {
	readonly target: T;
	readonly benchmark: Av1BenchmarkIdentityV1 | null;
	readonly evidenceComplete: boolean;
	readonly evidenceCaseCount: number;
	readonly decode: Av1DecodeQualificationDecisionV1;
	readonly encode: Av1EncodeQualificationDecisionV1;
}

export type Av1FiveTargetQualificationDecisionsV1 = readonly [
	Av1TargetQualificationDecisionV1<'linux-x64'>,
	Av1TargetQualificationDecisionV1<'linux-arm64'>,
	Av1TargetQualificationDecisionV1<'mac-arm64'>,
	Av1TargetQualificationDecisionV1<'win-x64'>,
	Av1TargetQualificationDecisionV1<'win-arm64'>,
];

export interface Av1QualificationDecisionV1 {
	readonly schemaVersion: typeof AV1_QUALIFICATION_SCHEMA_VERSION;
	readonly requiredCorpusCaseCount: 12;
	readonly thresholds: Av1QualificationThresholdsV1;
	readonly targets: Av1FiveTargetQualificationDecisionsV1;
}

export class Av1QualificationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'Av1QualificationError';
	}
}

const INPUT_KEYS = Object.freeze(['schemaVersion', 'thresholds', 'evidence']);
const THRESHOLD_KEYS = Object.freeze([
	'maximumDav1dCpuTimeRatio', 'maximumDav1dPeakRssRatio',
	'minimumEncoderThroughputFps', 'maximumBitrateDeltaRatio',
	'minimumVmaf', 'minimumSsim', 'maximumVmafDelta', 'maximumSsimDelta',
]);
const EVIDENCE_KEYS = Object.freeze(['target', 'benchmark', 'corpus', 'decode', 'encode']);
const BENCHMARK_KEYS = Object.freeze(['environment', 'toolchain', 'encoderSettings']);
const ENVIRONMENT_KEYS = Object.freeze([
	'operatingSystem', 'operatingSystemVersion', 'cpuModel', 'cpuArchitecture', 'logicalCoreCount',
]);
const TOOLCHAIN_KEYS = Object.freeze(['dav1d', 'libaom', 'svt-av1', 'benchmarkHarnessSha256']);
const BUILD_IDENTITY_KEYS = Object.freeze(['version', 'buildSha256']);
const ENCODER_SETTINGS_KEYS = Object.freeze([
	'settingsSha256', 'threadCount', 'svtAv1Preset', 'libaomPreset',
]);
const CORPUS_KEYS = Object.freeze(['resolution', 'bitDepth', 'content', 'sourceSha256']);
const DECODE_KEYS = Object.freeze(['dav1d', 'libaom']);
const DECODE_MEASUREMENT_KEYS = Object.freeze(['correct', 'cpuTimeMs', 'peakRssBytes']);
const ENCODE_KEYS = Object.freeze(['svt-av1', 'libaom']);
const ENCODE_MEASUREMENT_KEYS = Object.freeze([
	'correct', 'throughputFps', 'bitrateKbps', 'vmaf', 'ssim',
]);
const TARGETS = new Set<string>(AV1_QUALIFICATION_TARGETS);
const VERSION = /^[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9.-]+)?$/u;
const IDENTITY_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const CPU_MODEL = /^[A-Za-z0-9][A-Za-z0-9 ._()+/@-]{0,159}$/u;
const REQUIRED_CASE_KEYS = new Set(AV1_QUALIFICATION_CORPUS_CASES.map(corpusCaseKey));
const MAXIMUM_EVIDENCE_ROWS = AV1_QUALIFICATION_TARGETS.length * AV1_QUALIFICATION_CORPUS_CASES.length;

const { digest, exactKeys, plainRecord } = createNativeValidators({
	subject: 'AV1 qualification evidence',
	article: 'AV1 qualification',
	requirePlainPrototype: true,
	raise: (message: string): never => { throw new Av1QualificationError(message); },
});

/** Validate evidence and produce exactly one fail-closed decision for every supported target. */
export function decideAv1CodecQualification(input: unknown): Av1QualificationDecisionV1 {
	const admittedInput = plainRecord(input, 'input');
	exactKeys(admittedInput, INPUT_KEYS, 'input');
	if (admittedInput.schemaVersion !== AV1_QUALIFICATION_SCHEMA_VERSION) {
		throw new Av1QualificationError('AV1 qualification evidence has an unsupported schema version.');
	}
	const thresholds = admitThresholds(admittedInput.thresholds);
	const evidence = admitEvidence(admittedInput.evidence);
	const byTarget = new Map<Av1QualificationTarget, Av1QualificationEvidenceRowV1[]>();
	for (const target of AV1_QUALIFICATION_TARGETS) byTarget.set(target, []);
	for (const row of evidence) byTarget.get(row.target)?.push(row);

	const decisions = AV1_QUALIFICATION_TARGETS.map((target) =>
		decideTarget(target, byTarget.get(target) ?? [], thresholds));
	return Object.freeze({
		schemaVersion: AV1_QUALIFICATION_SCHEMA_VERSION,
		requiredCorpusCaseCount: 12,
		thresholds,
		targets: Object.freeze(decisions) as Av1FiveTargetQualificationDecisionsV1,
	});
}

function decideTarget(
	target: Av1QualificationTarget,
	rows: readonly Av1QualificationEvidenceRowV1[],
	thresholds: Av1QualificationThresholdsV1,
): Av1TargetQualificationDecisionV1 {
	const complete = rows.length === AV1_QUALIFICATION_CORPUS_CASES.length;
	const decodeFailures = decideDecodeFailures(rows, thresholds, complete);
	const defaultFailures = decideEncodeFailures(rows, thresholds, complete, 'svt-av1');
	const fallbackFailures = target === 'win-arm64'
		? decideEncodeFailures(rows, thresholds, complete, 'libaom')
		: null;
	const selected = defaultFailures.length === 0
		? 'svt-av1'
		: fallbackFailures?.length === 0 ? 'libaom' : null;
	return Object.freeze({
		target,
		benchmark: rows[0]?.benchmark ?? null,
		evidenceComplete: complete,
		evidenceCaseCount: rows.length,
		decode: Object.freeze({
			defaultCandidate: 'dav1d', comparedAgainst: 'libaom',
			admitted: decodeFailures.length === 0,
			selected: decodeFailures.length === 0 ? 'dav1d' : null,
			failures: Object.freeze(decodeFailures),
		}),
		encode: Object.freeze({
			defaultCandidate: 'svt-av1',
			fallbackCandidate: target === 'win-arm64' ? 'libaom' : null,
			admitted: selected !== null,
			selected,
			defaultFailures: Object.freeze(defaultFailures),
			fallbackFailures: fallbackFailures === null ? null : Object.freeze(fallbackFailures),
		}),
	});
}

function decideDecodeFailures(
	rows: readonly Av1QualificationEvidenceRowV1[],
	thresholds: Av1QualificationThresholdsV1,
	complete: boolean,
): Av1DecodeQualificationFailure[] {
	const failures: Av1DecodeQualificationFailure[] = [];
	if (!complete) failures.push('incomplete-corpus-evidence');
	if (rows.some(({ decode }) => !decode.dav1d.correct)) failures.push('dav1d-correctness-failed');
	if (rows.some(({ decode }) => !decode.libaom.correct)) {
		failures.push('libaom-comparison-correctness-failed');
	}
	if (rows.some(({ decode }) => decode.dav1d.cpuTimeMs / decode.libaom.cpuTimeMs
		> thresholds.maximumDav1dCpuTimeRatio)) {
		failures.push('dav1d-cpu-time-threshold-failed');
	}
	if (rows.some(({ decode }) => decode.dav1d.peakRssBytes / decode.libaom.peakRssBytes
		> thresholds.maximumDav1dPeakRssRatio)) {
		failures.push('dav1d-peak-rss-threshold-failed');
	}
	return failures;
}

function decideEncodeFailures(
	rows: readonly Av1QualificationEvidenceRowV1[],
	thresholds: Av1QualificationThresholdsV1,
	complete: boolean,
	candidate: keyof Av1QualificationEvidenceRowV1['encode'],
): Av1EncodeQualificationFailure[] {
	const failures: Av1EncodeQualificationFailure[] = [];
	if (!complete) failures.push('incomplete-corpus-evidence');
	const bitrateMatched = rows.every(({ encode }) => relativeDelta(
		encode['svt-av1'].bitrateKbps, encode.libaom.bitrateKbps,
	) <= thresholds.maximumBitrateDeltaRatio);
	const vmafMatched = rows.every(({ encode }) => Math.abs(
		encode['svt-av1'].vmaf - encode.libaom.vmaf,
	) <= thresholds.maximumVmafDelta);
	const ssimMatched = rows.every(({ encode }) => Math.abs(
		encode['svt-av1'].ssim - encode.libaom.ssim,
	) <= thresholds.maximumSsimDelta);
	if (!bitrateMatched) failures.push('bitrate-not-matched');
	if (!vmafMatched) failures.push('vmaf-not-matched');
	if (!ssimMatched) failures.push('ssim-not-matched');
	if (rows.some(({ encode }) => !encode[candidate].correct)) failures.push('correctness-failed');
	if (bitrateMatched && vmafMatched && ssimMatched
		&& rows.some(({ encode }) => encode[candidate].throughputFps
			< thresholds.minimumEncoderThroughputFps)) {
		failures.push('throughput-threshold-failed');
	}
	if (rows.some(({ encode }) => encode[candidate].vmaf < thresholds.minimumVmaf)) {
		failures.push('vmaf-threshold-failed');
	}
	if (rows.some(({ encode }) => encode[candidate].ssim < thresholds.minimumSsim)) {
		failures.push('ssim-threshold-failed');
	}
	return failures;
}

function admitThresholds(value: unknown): Av1QualificationThresholdsV1 {
	const record = plainRecord(value, 'threshold set');
	exactKeys(record, THRESHOLD_KEYS, 'threshold set');
	return Object.freeze({
		maximumDav1dCpuTimeRatio: positive(record.maximumDav1dCpuTimeRatio, 'maximum dav1d CPU-time ratio'),
		maximumDav1dPeakRssRatio: positive(record.maximumDav1dPeakRssRatio, 'maximum dav1d peak-RSS ratio'),
		minimumEncoderThroughputFps: positive(record.minimumEncoderThroughputFps, 'minimum encoder throughput'),
		maximumBitrateDeltaRatio: ratio(record.maximumBitrateDeltaRatio, 'maximum bitrate delta ratio'),
		minimumVmaf: finiteRange(record.minimumVmaf, 0, 100, 'minimum VMAF'),
		minimumSsim: ratio(record.minimumSsim, 'minimum SSIM'),
		maximumVmafDelta: finiteRange(record.maximumVmafDelta, 0, 100, 'maximum VMAF delta'),
		maximumSsimDelta: ratio(record.maximumSsimDelta, 'maximum SSIM delta'),
	});
}

function admitEvidence(value: unknown): readonly Av1QualificationEvidenceRowV1[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_EVIDENCE_ROWS) {
		throw new Av1QualificationError('AV1 qualification evidence exceeds its closed corpus matrix.');
	}
	const seen = new Set<string>();
	const benchmarkIdentities = new Map<Av1QualificationTarget, string>();
	return Object.freeze(value.map((candidate, index) => {
		const row = admitEvidenceRow(candidate, index);
		const key = `${row.target}/${corpusCaseKey(row.corpus)}`;
		if (seen.has(key)) {
			throw new Av1QualificationError(`AV1 qualification corpus case ${key} is reported more than once.`);
		}
		seen.add(key);
		const identity = benchmarkIdentityKey(row.benchmark);
		const established = benchmarkIdentities.get(row.target);
		if (established !== undefined && established !== identity) {
			throw new Av1QualificationError(
				`AV1 qualification target ${row.target} has benchmark environment, toolchain, or settings drift.`,
			);
		}
		benchmarkIdentities.set(row.target, identity);
		return row;
	}));
}

function admitEvidenceRow(value: unknown, index: number): Av1QualificationEvidenceRowV1 {
	const row = plainRecord(value, `evidence row ${index}`);
	exactKeys(row, EVIDENCE_KEYS, `evidence row ${index}`);
	const target = admitTarget(row.target);
	const corpus = admitCorpus(row.corpus, index);
	return Object.freeze({
		target,
		benchmark: admitBenchmark(row.benchmark, target, index),
		corpus,
		decode: admitDecode(row.decode, index),
		encode: admitEncode(row.encode, index),
	});
}

function admitBenchmark(
	value: unknown, target: Av1QualificationTarget, index: number,
): Av1BenchmarkIdentityV1 {
	const benchmark = plainRecord(value, `benchmark identity ${index}`);
	exactKeys(benchmark, BENCHMARK_KEYS, `benchmark identity ${index}`);
	const environment = admitEnvironment(benchmark.environment, target, index);
	const encoderSettings = admitEncoderSettings(
		benchmark.encoderSettings, environment.logicalCoreCount, index,
	);
	return Object.freeze({
		environment,
		toolchain: admitToolchain(benchmark.toolchain, index),
		encoderSettings,
	});
}

function admitEnvironment(
	value: unknown, target: Av1QualificationTarget, index: number,
): Av1BenchmarkEnvironmentV1 {
	const environment = plainRecord(value, `benchmark environment ${index}`);
	exactKeys(environment, ENVIRONMENT_KEYS, `benchmark environment ${index}`);
	const expectedOperatingSystem: Av1BenchmarkOperatingSystem = target.startsWith('linux-')
		? 'linux' : target.startsWith('win-') ? 'windows' : 'macos';
	const expectedArchitecture: Av1BenchmarkCpuArchitecture = target.endsWith('-x64') ? 'x64' : 'arm64';
	if (environment.operatingSystem !== expectedOperatingSystem
		|| environment.cpuArchitecture !== expectedArchitecture) {
		throw new Av1QualificationError(
			`AV1 qualification target ${target} does not match its benchmark environment.`,
		);
	}
	return Object.freeze({
		operatingSystem: expectedOperatingSystem,
		operatingSystemVersion: canonicalText(
			environment.operatingSystemVersion, IDENTITY_TOKEN, 'benchmark operating-system version',
		),
		cpuModel: canonicalText(environment.cpuModel, CPU_MODEL, 'benchmark CPU model'),
		cpuArchitecture: expectedArchitecture,
		logicalCoreCount: boundedPositiveInteger(
			environment.logicalCoreCount, 1_024, 'benchmark logical-core count',
		),
	});
}

function admitToolchain(value: unknown, index: number): Av1BenchmarkToolchainV1 {
	const toolchain = plainRecord(value, `benchmark toolchain ${index}`);
	exactKeys(toolchain, TOOLCHAIN_KEYS, `benchmark toolchain ${index}`);
	return Object.freeze({
		dav1d: admitBuildIdentity(toolchain.dav1d, `dav1d build ${index}`),
		libaom: admitBuildIdentity(toolchain.libaom, `libaom build ${index}`),
		'svt-av1': admitBuildIdentity(toolchain['svt-av1'], `SVT-AV1 build ${index}`),
		benchmarkHarnessSha256: digest(toolchain.benchmarkHarnessSha256, 'benchmark harness digest'),
	});
}

function admitBuildIdentity(value: unknown, label: string): Av1CodecBuildIdentityV1 {
	const identity = plainRecord(value, label);
	exactKeys(identity, BUILD_IDENTITY_KEYS, label);
	return Object.freeze({
		version: canonicalText(identity.version, VERSION, `${label} version`),
		buildSha256: digest(identity.buildSha256, `${label} digest`),
	});
}

function admitEncoderSettings(
	value: unknown, logicalCoreCount: number, index: number,
): Av1EncoderSettingsIdentityV1 {
	const settings = plainRecord(value, `encoder settings identity ${index}`);
	exactKeys(settings, ENCODER_SETTINGS_KEYS, `encoder settings identity ${index}`);
	const threadCount = boundedPositiveInteger(
		settings.threadCount, logicalCoreCount, 'encoder benchmark thread count',
	);
	return Object.freeze({
		settingsSha256: digest(settings.settingsSha256, 'encoder settings digest'),
		threadCount,
		svtAv1Preset: canonicalText(settings.svtAv1Preset, IDENTITY_TOKEN, 'SVT-AV1 preset identity'),
		libaomPreset: canonicalText(settings.libaomPreset, IDENTITY_TOKEN, 'libaom preset identity'),
	});
}

function admitCorpus(value: unknown, index: number): Av1QualificationEvidenceRowV1['corpus'] {
	const corpus = plainRecord(value, `corpus descriptor ${index}`);
	exactKeys(corpus, CORPUS_KEYS, `corpus descriptor ${index}`);
	const admitted = Object.freeze({
		resolution: oneOf(corpus.resolution, ['1080p', '4k'], 'corpus resolution'),
		bitDepth: oneOf(corpus.bitDepth, [8, 10], 'corpus bit depth'),
		content: oneOf(corpus.content, ['film', 'animation', 'screen'], 'corpus content class'),
		sourceSha256: digest(corpus.sourceSha256, 'source digest'),
	});
	if (!REQUIRED_CASE_KEYS.has(corpusCaseKey(admitted))) {
		throw new Av1QualificationError('AV1 qualification evidence names an unsupported corpus case.');
	}
	return admitted;
}

function admitDecode(value: unknown, index: number): Av1QualificationEvidenceRowV1['decode'] {
	const record = plainRecord(value, `decode comparison ${index}`);
	exactKeys(record, DECODE_KEYS, `decode comparison ${index}`);
	return Object.freeze({
		dav1d: admitDecodeMeasurement(record.dav1d, `dav1d decode measurement ${index}`),
		libaom: admitDecodeMeasurement(record.libaom, `libaom decode measurement ${index}`),
	});
}

function admitDecodeMeasurement(value: unknown, label: string): Av1DecodeMeasurementV1 {
	const record = plainRecord(value, label);
	exactKeys(record, DECODE_MEASUREMENT_KEYS, label);
	return Object.freeze({
		correct: boolean(record.correct, `${label} correctness`),
		cpuTimeMs: positive(record.cpuTimeMs, `${label} CPU time`),
		peakRssBytes: positiveInteger(record.peakRssBytes, `${label} peak RSS`),
	});
}

function admitEncode(value: unknown, index: number): Av1QualificationEvidenceRowV1['encode'] {
	const record = plainRecord(value, `encode comparison ${index}`);
	exactKeys(record, ENCODE_KEYS, `encode comparison ${index}`);
	return Object.freeze({
		'svt-av1': admitEncodeMeasurement(record['svt-av1'], `SVT-AV1 encode measurement ${index}`),
		libaom: admitEncodeMeasurement(record.libaom, `libaom encode measurement ${index}`),
	});
}

function admitEncodeMeasurement(value: unknown, label: string): Av1EncodeMeasurementV1 {
	const record = plainRecord(value, label);
	exactKeys(record, ENCODE_MEASUREMENT_KEYS, label);
	return Object.freeze({
		correct: boolean(record.correct, `${label} correctness`),
		throughputFps: positive(record.throughputFps, `${label} throughput`),
		bitrateKbps: positive(record.bitrateKbps, `${label} bitrate`),
		vmaf: finiteRange(record.vmaf, 0, 100, `${label} VMAF`),
		ssim: ratio(record.ssim, `${label} SSIM`),
	});
}

function admitTarget(value: unknown): Av1QualificationTarget {
	if (value === 'mac-x64') {
		throw new Av1QualificationError('macOS x64 is explicitly unsupported for AV1 qualification.');
	}
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new Av1QualificationError('AV1 qualification evidence names an unsupported desktop target.');
	}
	return value as Av1QualificationTarget;
}

function corpusCaseKey(value: Av1QualificationCorpusCase): string {
	return `${value.resolution}/${value.bitDepth}/${value.content}`;
}

function benchmarkIdentityKey(value: Av1BenchmarkIdentityV1): string {
	return JSON.stringify(value);
}

function relativeDelta(left: number, right: number): number {
	return Math.abs(left - right) / Math.max(left, right);
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new Av1QualificationError(`${label} must be boolean.`);
	return value;
}

function positive(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new Av1QualificationError(`${label} must be finite and positive.`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new Av1QualificationError(`${label} must be a positive safe integer.`);
	}
	return value as number;
}

function boundedPositiveInteger(value: unknown, maximum: number, label: string): number {
	const admitted = positiveInteger(value, label);
	if (admitted > maximum) {
		throw new Av1QualificationError(`${label} must not exceed ${maximum}.`);
	}
	return admitted;
}

function ratio(value: unknown, label: string): number {
	return finiteRange(value, 0, 1, label);
}

function finiteRange(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new Av1QualificationError(`${label} must be finite and in [${minimum}, ${maximum}].`);
	}
	return value;
}

function oneOf<const T>(value: unknown, choices: readonly T[], label: string): T {
	if (!choices.includes(value as T)) throw new Av1QualificationError(`${label} is unsupported.`);
	return value as T;
}

function canonicalText(value: unknown, pattern: RegExp, label: string): string {
	if (typeof value !== 'string' || !pattern.test(value)) {
		throw new Av1QualificationError(`${label} is not canonical.`);
	}
	return value;
}
