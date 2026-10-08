/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../src/common/editor/closed-domain-value.ts';
import { PHOTO_LARGE_LIBRARY_SPECIFICATION_V1 as SPEC } from '../../src/lightscaper/quality/large-library-workload-v1.ts';
import { evaluateQualityWorkload, qualityFixture, qualityWorkloadBudget } from './quality-budget-config.mjs';

const WORKLOAD = 'l3-photo-library-large';
const PROFILE = 'deterministic-photo-library-20000-v1';
const MAXIMUM_OUTPUT_CHARACTERS = 16 * 1024 * 1024;
const MAXIMUM_DIAGNOSTIC_CHARACTERS = 65_536;
const FINAL_PHOTO_COUNT = SPEC.photoCount + 6 * SPEC.presentationPageSize;
const EXPECTED_QUERY_STEPS = Math.ceil(FINAL_PHOTO_COUNT / SPEC.presentationPageSize);
const MAXIMUM_QUERY_STEPS = EXPECTED_QUERY_STEPS + 2;
type DataRecord = Readonly<Record<string, unknown>>;
type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
interface ImportTrial { readonly trial: number; readonly elapsedMs: number; readonly beforeCount: number; readonly afterCount: number; readonly importedCount: number }
interface ScrollTrial { readonly trial: number; readonly frameIntervalsMs: readonly number[]; readonly renderedPhotoCount: number; readonly scrollDistancePx: number }
interface FilterTrial { readonly trial: number; readonly elapsedMs: number; readonly resultFirstPhotoId: string | null; readonly resultCount: number }
interface SearchTrial { readonly trial: number; readonly elapsedMs: number; readonly resultPhotoId: string | null; readonly resultCount: number }
export interface LightscaperLargeLibraryDiagnosticV1 {
	readonly schemaVersion: 1;
	readonly profile: typeof PROFILE;
	readonly workloadId: typeof WORKLOAD;
	readonly fixtureId: typeof SPEC.id;
	readonly fixture: typeof SPEC;
	readonly environmentId: 'local-runtime-diagnostics' | 'github-ubuntu-playwright-1.62.1';
	readonly browser: Readonly<{ name: 'chromium' | 'firefox'; version: string }>;
	readonly rendererClass: 'browser-2d';
	readonly observations: Readonly<{
		fixture: Readonly<{ photoCount: number; maximumPublishedBatchPhotos: number; sourceByteLength: number; originalActualSha256: string }>;
		importTrials: readonly ImportTrial[]; scrollTrials: readonly ScrollTrial[]; filterTrials: readonly FilterTrial[]; searchTrials: readonly SearchTrial[];
		query: Readonly<{ maximumCandidatePhotos: number; steps: number; matches: number; resultId: string | null }>;
	}>;
}

/** One bounded console record; duplicate members and every foreign field refuse. */
export function parseLightscaperLargeLibraryDiagnostic(output: unknown): LightscaperLargeLibraryDiagnosticV1 {
	if (typeof output !== 'string') throw new TypeError('Browser diagnostic output must be text.');
	if (output.length > MAXIMUM_OUTPUT_CHARACTERS) throw new RangeError('Browser diagnostic output exceeds its bound.');
	let match: LightscaperLargeLibraryDiagnosticV1 | null = null;
	for (const [line] of output.matchAll(/[^\r\n]+/gu)) {
		if (![WORKLOAD, PROFILE, SPEC.id].some(identity => line.includes(identity))) continue;
		const start = line.indexOf('{');
		if (start < 0) continue;
		const source = line.slice(start);
		if (source.length > MAXIMUM_DIAGNOSTIC_CHARACTERS) throw new RangeError('Browser diagnostic record exceeds its bound.');
		const parsed: unknown = JSON.parse(source);
		assertUniqueJsonMembers(source);
		const admitted = normalizeDiagnostic(parsed);
		if (match !== null) throw new Error(`Expected exactly one ${WORKLOAD} browser diagnostic; received duplicates.`);
		match = admitted;
	}
	if (match === null) throw new Error(`Expected exactly one ${WORKLOAD} browser diagnostic; received 0.`);
	return match;
}

/** Raw observations determine all metrics; this result is a diagnostic, not release evidence. */
export function createPendingLightscaperLargeLibraryResult(input: unknown, inputConfig: unknown) {
	const diagnostic = normalizeDiagnostic(input);
	const config = snapshotConfig(inputConfig);
	const workload = qualityWorkloadBudget(config, WORKLOAD);
	const registeredFixture = qualityFixture(config, SPEC.id) as { specification: unknown };
	assertFixture(registeredFixture.specification, false);
	if (workload.fixtureIds.length !== 1 || workload.fixtureIds[0] !== SPEC.id) throw new TypeError('Large-library workload must own exactly its pinned fixture.');
	const { fixture, importTrials, scrollTrials, filterTrials, searchTrials, query } = diagnostic.observations;
	let mismatches = Number(fixture.photoCount !== SPEC.photoCount) + Number(fixture.sourceByteLength !== SPEC.sourceByteLength);
	for (const trial of importTrials) {
		mismatches += Number(trial.beforeCount !== SPEC.photoCount + SPEC.presentationPageSize * trial.trial)
			+ Number(trial.afterCount !== SPEC.photoCount + SPEC.presentationPageSize * (trial.trial + 1))
			+ Number(trial.importedCount !== SPEC.presentationPageSize);
	}
	for (const trial of filterTrials) mismatches += Number(trial.resultFirstPhotoId !== 'large-photo-00000') + Number(trial.resultCount !== 32);
	for (const trial of searchTrials) mismatches += Number(trial.resultPhotoId !== 'large-photo-19999') + Number(trial.resultCount !== 1);
	mismatches += Number(query.resultId !== 'large-photo-19999') + Number(query.matches !== 1) + Number(query.steps !== EXPECTED_QUERY_STEPS);
	mismatches += Number(query.maximumCandidatePhotos < SPEC.presentationPageSize);
	const intervals = scrollTrials.slice(1).flatMap(trial => trial.frameIntervalsMs);
	const metrics = Object.freeze({
		'photoLibrary.resultMismatchCount': mismatches,
		'photoLibrary.originalDigestMismatchCount': Number(fixture.originalActualSha256 !== SPEC.sourceSha256),
		'photoLibrary.maximumRenderedPhotos': Math.max(...scrollTrials.map(trial => trial.renderedPhotoCount)),
		'photoLibrary.maximumPublishedBatchPhotos': fixture.maximumPublishedBatchPhotos,
		'photoLibrary.maximumCandidatePhotos': query.maximumCandidatePhotos,
		'photoLibrary.importP95Ms': nearestRank(importTrials.slice(1).map(trial => trial.elapsedMs)),
		'photoLibrary.scrollFrameIntervalP95Ms': nearestRank(intervals),
		'photoLibrary.filterP95Ms': nearestRank(filterTrials.slice(1).map(trial => trial.elapsedMs)),
		'photoLibrary.searchP95Ms': nearestRank(searchTrials.slice(1).map(trial => trial.elapsedMs)),
	});
	const evaluation = evaluateQualityWorkload(config, workload, metrics);
	return Object.freeze({
		schemaVersion: 1, status: evaluation.passed ? 'passed' : 'failed', workloadId: WORKLOAD, fixtureId: SPEC.id,
		environmentId: diagnostic.environmentId, profile: PROFILE, attemptCount: 1, retryCount: 0,
		rendererClass: diagnostic.rendererClass, browser: diagnostic.browser, fixture: diagnostic.fixture, metrics,
		rawSampleCounts: Object.freeze({ warmupTrials: 1, measuredTrials: 5, scrollFrameIntervals: intervals.length }),
		metricGatePassed: evaluation.passed, evaluation,
	});
}

function normalizeDiagnostic(value: unknown): LightscaperLargeLibraryDiagnosticV1 {
	const input = record(value, 'large-library diagnostic', ['schemaVersion', 'profile', 'workloadId', 'fixtureId', 'fixture', 'environmentId', 'browser', 'rendererClass', 'observations']);
	for (const [key, expected] of [['schemaVersion', 1], ['profile', PROFILE], ['workloadId', WORKLOAD], ['fixtureId', SPEC.id], ['rendererClass', 'browser-2d']] as const) {
		if (field(input, key, 'diagnostic') !== expected) throw new TypeError(`Large-library diagnostic ${key} is unsupported.`);
	}
	assertFixture(field(input, 'fixture', 'diagnostic'), true);
	const environmentId = field(input, 'environmentId', 'diagnostic');
	if (environmentId !== 'local-runtime-diagnostics' && environmentId !== 'github-ubuntu-playwright-1.62.1') throw new TypeError('Large-library diagnostic environment is unsupported.');
	const browser = record(field(input, 'browser', 'diagnostic'), 'browser', ['name', 'version']), browserName = field(browser, 'name', 'browser');
	if (browserName !== 'chromium' && browserName !== 'firefox') throw new TypeError('Large-library diagnostic browser is unsupported.');
	const observations = record(field(input, 'observations', 'diagnostic'), 'observations', ['fixture', 'importTrials', 'scrollTrials', 'filterTrials', 'searchTrials', 'query']);
	const fixture = record(field(observations, 'fixture', 'observations'), 'fixture observations', ['photoCount', 'maximumPublishedBatchPhotos', 'sourceByteLength', 'originalActualSha256']);
	const originalActualSha256 = text(field(fixture, 'originalActualSha256', 'fixture observations'), 'original SHA', 64);
	if (!/^[a-f\d]{64}$/u.test(originalActualSha256)) throw new TypeError('Original SHA must be a lowercase SHA-256.');
	const query = record(field(observations, 'query', 'observations'), 'query', ['maximumCandidatePhotos', 'steps', 'matches', 'resultId']);
	return Object.freeze({
		schemaVersion: 1, profile: PROFILE, workloadId: WORKLOAD, fixtureId: SPEC.id, fixture: SPEC, environmentId,
		browser: Object.freeze({ name: browserName, version: text(field(browser, 'version', 'browser'), 'browser version', 128) }), rendererClass: 'browser-2d',
		observations: Object.freeze({
			fixture: Object.freeze({ photoCount: count(fixture, 'photoCount'), maximumPublishedBatchPhotos: count(fixture, 'maximumPublishedBatchPhotos'),
				sourceByteLength: count(fixture, 'sourceByteLength'), originalActualSha256 }),
			importTrials: trials(observations, 'importTrials', ['trial', 'elapsedMs', 'beforeCount', 'afterCount', 'importedCount'], trial => Object.freeze({
				trial: count(trial, 'trial'), elapsedMs: duration(trial), beforeCount: count(trial, 'beforeCount'), afterCount: count(trial, 'afterCount'), importedCount: count(trial, 'importedCount'),
			})),
			scrollTrials: trials(observations, 'scrollTrials', ['trial', 'frameIntervalsMs', 'renderedPhotoCount', 'scrollDistancePx'], trial => Object.freeze({
				trial: count(trial, 'trial'), frameIntervalsMs: Object.freeze(exactArray(field(trial, 'frameIntervalsMs', 'scroll trial'), 32).map(value => finite(value, 'frame interval', true))),
				renderedPhotoCount: count(trial, 'renderedPhotoCount'), scrollDistancePx: finite(field(trial, 'scrollDistancePx', 'scroll trial'), 'scroll distance', true),
			})),
			filterTrials: trials(observations, 'filterTrials', ['trial', 'elapsedMs', 'resultFirstPhotoId', 'resultCount'], trial => Object.freeze({
				trial: count(trial, 'trial'), elapsedMs: duration(trial), resultFirstPhotoId: photoId(field(trial, 'resultFirstPhotoId', 'filter trial')), resultCount: count(trial, 'resultCount'),
			})),
			searchTrials: trials(observations, 'searchTrials', ['trial', 'elapsedMs', 'resultPhotoId', 'resultCount'], trial => Object.freeze({
				trial: count(trial, 'trial'), elapsedMs: duration(trial), resultPhotoId: photoId(field(trial, 'resultPhotoId', 'search trial')), resultCount: count(trial, 'resultCount'),
			})),
			query: Object.freeze({ maximumCandidatePhotos: count(query, 'maximumCandidatePhotos'), steps: count(query, 'steps', MAXIMUM_QUERY_STEPS), matches: count(query, 'matches'),
				resultId: photoId(field(query, 'resultId', 'query')) }),
		}),
	});
}

function assertFixture(value: unknown, includeId: boolean): void {
	const fields = Object.keys(SPEC).filter(key => includeId || key !== 'id');
	const input = record(value, 'fixture specification', fields);
	for (const key of fields) if (field(input, key, 'fixture specification') !== SPEC[key as keyof typeof SPEC]) throw new TypeError(`Large-library fixture ${key} differs from its pinned specification.`);
}
function trials<T>(observations: DataRecord, key: string, fields: readonly string[], normalize: (value: DataRecord) => T): readonly T[] {
	return Object.freeze(exactArray(field(observations, key, 'observations'), 6).map((value, index) => {
		const trial = record(value, key, fields);
		if (count(trial, 'trial') !== index) throw new TypeError(`${key} must contain ordered unique trials 0 through 5.`);
		return normalize(trial);
	}));
}
function count(input: DataRecord, key: string, maximum = Number.MAX_SAFE_INTEGER): number {
	const value = field(input, key, key);
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new RangeError(`${key} must be a bounded nonnegative safe integer.`);
	return value;
}
function finite(value: unknown, name: string, positive = false): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) throw new RangeError(`${name} must be finite and ${positive ? 'positive' : 'nonnegative'}.`);
	return value;
}
function duration(trial: DataRecord): number { return finite(field(trial, 'elapsedMs', 'trial'), 'elapsed time'); }
function text(value: unknown, name: string, maximum: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum) throw new TypeError(`${name} must be nonempty bounded text.`);
	return value;
}
function photoId(value: unknown): string | null { return value === null ? null : text(value, 'photo ID', 128); }
function nearestRank(values: readonly number[]): number { return [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1]!; }

/** Descriptor snapshots also admit array length without caller-owned property reads. */
function array(value: unknown, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError('Diagnostic data must contain native arrays.');
	const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
	if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > maximum) throw new RangeError('Diagnostic array exceeds its bound.');
	const result: unknown[] = [];
	for (let index = 0; index < length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) throw new TypeError('Diagnostic arrays must contain dense own data.');
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).length !== length + 1) throw new TypeError('Diagnostic array contains unsupported fields.');
	return result;
}
function exactArray(value: unknown, length: number): readonly unknown[] {
	const result = array(value, length);
	if (result.length !== length) throw new RangeError(`Diagnostic array requires exactly ${String(length)} entries.`);
	return result;
}

/** Never hand caller objects to the legacy quality-register evaluator. */
function snapshotConfig(value: unknown): JsonValue {
	let nodes = 0, characters = 0;
	function visit(input: unknown, depth: number): JsonValue {
		if (++nodes > 50_000 || depth > 16) throw new RangeError('Quality config exceeds its node/depth bound.');
		if (input === null || typeof input === 'boolean') return input;
		if (typeof input === 'string') {
			characters += input.length;
			if (characters > 8 * 1024 * 1024) throw new RangeError('Quality config exceeds its text bound.');
			return input;
		}
		if (typeof input === 'number') {
			if (!Number.isFinite(input)) throw new RangeError('Quality config numbers must be finite.');
			return input;
		}
		if (Array.isArray(input)) return array(input, 4_096).map(item => visit(item, depth + 1));
		if (!input || typeof input !== 'object') throw new TypeError('Quality config must contain only plain JSON data.');
		const keys = Reflect.ownKeys(input);
		if (keys.length > 128 || keys.some(key => typeof key !== 'string')) throw new RangeError('Quality config record exceeds its field bound.');
		const names = keys as string[], source = record(input, 'quality config', names);
		characters += names.reduce((length, key) => length + key.length, 0);
		if (characters > 8 * 1024 * 1024) throw new RangeError('Quality config exceeds its text bound.');
		return Object.fromEntries(names.map(key => [key, visit(field(source, key, 'quality config'), depth + 1)]));
	}
	return visit(value, 0);
}

/** JSON.parse alone silently replaces duplicate keys, including escaped spellings. */
function assertUniqueJsonMembers(source: string): void {
	const tokens = source.match(/"(?:[^"\\]|\\[\s\S])*"|[{}[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gu) ?? [];
	let position = 0;
	function visit(depth: number): void {
		if (depth > 16) throw new RangeError('Diagnostic JSON exceeds its depth bound.');
		const token = tokens[position++];
		if (token !== '{' && token !== '[') return;
		const end = token === '{' ? '}' : ']', seen = new Set<string>();
		while (tokens[position] !== end) {
			if (token === '{') {
				const key = JSON.parse(tokens[position++]!) as string;
				if (seen.has(key)) throw new TypeError('Diagnostic JSON contains a duplicate member.');
				seen.add(key); position++; // Native JSON.parse has already checked the colon.
			}
			visit(depth + 1);
			if (tokens[position] === ',') position++;
		}
		position++;
	}
	visit(0);
}
