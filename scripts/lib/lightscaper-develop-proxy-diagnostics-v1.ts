/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../../src/common/editor/closed-domain-value.ts';
import { evaluateQualityWorkload, qualityFixture, qualityWorkloadBudget } from './quality-budget-config.mjs';

export const LIGHTSCAPER_DEVELOP_PROXY_DIAGNOSTIC_MARKER_V1 = 'LIGHTSCAPER_DEVELOP_PROXY_DIAGNOSTIC ';
const WORKLOAD = 'l4-photo-develop-proxy-spatial', PROFILE = 'deterministic-photo-develop-proxy-spatial-v1';
const FIXTURE = 'lightscaper-develop-proxy-spatial-4096x3072-v1';
const AMOUNTS = [25, 50, 75, 100, 125] as const, SERIAL = [75, 25, 100, 75, 125, 50] as const;
const PROTOCOL = Object.freeze({ start: 'trusted-finite-input', end: 'current-ready-plus-one-raf', warmupTrials: 1, measuredTrials: 5,
	workers: 1, retries: 0, caseDeadlineMs: 90_000, p95Method: 'nearest-rank-per-locale-then-worst' } as const);
const V8_PROTOCOL = Object.freeze({ ...PROTOCOL, caseDeadlineMs: 180_000 } as const);
type Protocol = typeof PROTOCOL | typeof V8_PROTOCOL;
const DIMENSIONS = Object.freeze({ width: 4096, height: 3072, proxyWidth: 2048, proxyHeight: 1536,
	sourceRgbaByteLength: 50_331_648, proxyRgbaByteLength: 12_582_912, pngSrgbIntent: 0 } as const);
const METRICS = Object.freeze(['photoDevelop.proxyPixelMismatchCount', 'photoDevelop.originalDigestMismatchCount',
	'photoDevelop.latestFrameMismatchCount', 'photoDevelop.serialEditP95Ms', 'photoDevelop.burstLatestReadyP95Ms'] as const);
type DataRecord = Readonly<Record<string, unknown>>;
type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
interface Fixture extends Readonly<typeof DIMENSIONS> {
	readonly encodedByteLength: number; readonly encodedSha256: string; readonly sourceRgbaSha256: string;
	readonly proxyRgbaSha256: string; readonly dehazeRgbaSha256: string;
	readonly goldens: readonly Readonly<{ amount: number; afterSha256: string }>[];
}
interface Timing { readonly inputAtMs: number; readonly readyAtMs: number; readonly presentedAtMs: number }
interface Input { readonly amount: number; readonly inputSequence: number; readonly inputTrusted: true; readonly inputAtMs: number }
interface Pixels { readonly expectedAfterSha256: string; readonly actualAfterSha256: string; readonly pixelMismatchCount: number }
interface SerialTrial extends Timing, Input, Pixels { readonly trial: number; readonly pendingObserved: true; readonly actualAmount: number }
interface BurstTrial extends Pixels {
	readonly trial: number; readonly inputs: readonly Input[]; readonly earlierWorkPending: readonly true[];
	readonly pendingObserved: true; readonly readyAtMs: number; readonly presentedAtMs: number; readonly actualAmount: number;
}
interface RecipeFacts {
	readonly processVersion: number; readonly maskCount: number; readonly dehazeAmount: number;
	readonly sharpenAmount: number; readonly sharpenThreshold: number; readonly stageOrder: readonly string[];
}
export interface LightscaperDevelopProxyDiagnosticV1 {
	readonly schemaVersion: 1; readonly profile: typeof PROFILE; readonly workloadId: typeof WORKLOAD; readonly fixtureId: typeof FIXTURE;
	readonly locale: 'en' | 'de'; readonly environmentId: 'local-runtime-diagnostics' | 'github-ubuntu-playwright-1.62.1';
	readonly browser: Readonly<{ name: 'chromium' | 'firefox'; version: string }>; readonly rendererClass: 'unknown';
	readonly instrumentation: 'none' | 'v8-browser';
	readonly runtime: Readonly<{ platform: string; userAgent: string; hardwareConcurrency: number; deviceMemoryGiB: number | null;
		viewportWidth: number; viewportHeight: number; deviceScaleFactor: number; decodePath: 'unknown' }>;
	readonly protocol: Protocol; readonly fixture: Fixture;
	readonly observations: Readonly<{
		coldOpen: Timing; beforeActualSha256: string; beforePixelMismatchCount: number; initialAfterActualSha256: string; initialAfterPixelMismatchCount: number;
		serialTrials: readonly SerialTrial[]; burstTrials: readonly BurstTrial[];
		close: Pixels & Readonly<{ pendingObserved: true; closedWithoutLatePublication: boolean }>;
		custody: Readonly<{ beforeSha256: string; afterSaveSha256: string; afterReloadSha256: string; savedRecipe: RecipeFacts; reloadedRecipe: RecipeFacts }>;
	}>;
}

/** Only complete marked EN and DE records qualify; failed partial artifacts remain separate. */
export function parseLightscaperDevelopProxyDiagnostic(output: unknown): readonly LightscaperDevelopProxyDiagnosticV1[] {
	if (typeof output !== 'string') throw new TypeError('Develop proxy output must be text.');
	if (output.length > 16 * 1024 * 1024) throw new RangeError('Develop proxy output exceeds its bound.');
	const diagnostics: unknown[] = [];
	for (const [line] of output.matchAll(/[^\r\n]+/gu)) {
		const start = line.indexOf(LIGHTSCAPER_DEVELOP_PROXY_DIAGNOSTIC_MARKER_V1);
		if (start < 0) continue;
		const source = line.slice(start + LIGHTSCAPER_DEVELOP_PROXY_DIAGNOSTIC_MARKER_V1.length);
		if (source.length > 65_536) throw new RangeError('Develop proxy record exceeds its bound.');
		const parsed: unknown = JSON.parse(source);
		assertUniqueJsonMembers(source); diagnostics.push(parsed);
		if (diagnostics.length > 2) throw new TypeError('Expected exactly one EN and one DE diagnostic.');
	}
	return normalizePair(diagnostics);
}

/** No register or latency ceiling is needed to retain and summarize actual baseline observations. */
export function summarizeLightscaperDevelopProxyDiagnosticsV1(input: unknown) {
	const diagnostics = normalizePair(input), first = diagnostics[0]!;
	let pixels = 0, originals = 0, latest = 0;
	const localeMetrics = diagnostics.map(diagnostic => {
		const { observations: observed, fixture } = diagnostic;
		pixels += mismatch(observed.beforePixelMismatchCount, observed.beforeActualSha256, fixture.proxyRgbaSha256)
			+ mismatch(observed.initialAfterPixelMismatchCount, observed.initialAfterActualSha256, golden(fixture, 50));
		latest += Number(observed.initialAfterActualSha256 !== golden(fixture, 50));
		for (const trial of [...observed.serialTrials, ...observed.burstTrials]) {
			pixels += mismatch(trial.pixelMismatchCount, trial.actualAfterSha256, trial.expectedAfterSha256);
			latest += Number(trial.actualAfterSha256 !== trial.expectedAfterSha256 || trial.actualAmount !== ('amount' in trial ? trial.amount : 50));
		}
		pixels += mismatch(observed.close.pixelMismatchCount, observed.close.actualAfterSha256, observed.close.expectedAfterSha256);
		latest += Number(!observed.close.closedWithoutLatePublication || observed.close.actualAfterSha256 !== observed.close.expectedAfterSha256);
		const custody = observed.custody;
		for (const hash of [custody.beforeSha256, custody.afterSaveSha256, custody.afterReloadSha256]) originals += Number(hash !== fixture.encodedSha256);
		for (const recipe of [custody.savedRecipe, custody.reloadedRecipe]) latest += Number(!recipeMatches(recipe));
		return Object.freeze({ locale: diagnostic.locale,
			serialEditP95Ms: nearestRank(observed.serialTrials.slice(1).map(trial => trial.presentedAtMs - trial.inputAtMs)),
			burstLatestReadyP95Ms: nearestRank(observed.burstTrials.slice(1).map(trial => trial.presentedAtMs - trial.inputs[2]!.inputAtMs)) });
	});
	const metrics = Object.freeze({ 'photoDevelop.proxyPixelMismatchCount': pixels, 'photoDevelop.originalDigestMismatchCount': originals,
		'photoDevelop.latestFrameMismatchCount': latest, 'photoDevelop.serialEditP95Ms': Math.max(...localeMetrics.map(value => value.serialEditP95Ms)),
		'photoDevelop.burstLatestReadyP95Ms': Math.max(...localeMetrics.map(value => value.burstLatestReadyP95Ms)) });
	return Object.freeze({ schemaVersion: 1, workloadId: WORKLOAD, fixtureId: FIXTURE, profile: PROFILE, rendererClass: 'unknown' as const,
		environmentId: first.environmentId, browser: first.browser, instrumentation: first.instrumentation, fixture: first.fixture,
		protocol: first.protocol, runtime: first.runtime, attemptCount: 1, retryCount: 0, diagnostics, metrics,
		localeMetrics: Object.freeze(localeMetrics), rawSampleCounts: Object.freeze({ locales: 2, warmupTrialsPerLocale: 1, measuredTrialsPerLocale: 5 }) });
}

/** Registered timing owns an explicit uninstrumented profile; ordinary coverage records remain valid diagnostics. */
export function createPendingLightscaperDevelopProxyResult(input: unknown, inputConfig: unknown) {
	const summary = summarizeLightscaperDevelopProxyDiagnosticsV1(input), config = snapshotConfig(inputConfig);
	const workload = qualityWorkloadBudget(config, WORKLOAD), registered = qualityFixture(config, FIXTURE) as { specification: unknown };
	const specification = record(registered.specification, 'registered fixture', ['fixture', 'protocol', 'timingInstrumentation']);
	if (field(specification, 'timingInstrumentation', 'registered fixture') !== 'none' || summary.instrumentation !== 'none') {
		throw new TypeError('Registered timing instrumentation must be none.');
	}
	if (JSON.stringify(normalizeFixture(field(specification, 'fixture', 'registered fixture'))) !== JSON.stringify(summary.fixture)
		|| JSON.stringify(normalizeProtocol(field(specification, 'protocol', 'registered fixture'), 'none')) !== JSON.stringify(summary.protocol)) {
		throw new TypeError('Registered fixture/protocol differs from the actual diagnostic.');
	}
	if (workload.fixtureIds.length !== 1 || workload.fixtureIds[0] !== FIXTURE) throw new TypeError('Develop proxy workload must own its exact fixture.');
	if (JSON.stringify(workload.measurementIds.toSorted()) !== JSON.stringify([...METRICS].sort())) throw new TypeError('Develop proxy measurements must exactly match its metrics.');
	const evaluation = evaluateQualityWorkload(config, workload, summary.metrics);
	return Object.freeze({ ...summary, status: evaluation.passed ? 'passed' : 'failed', metricGatePassed: evaluation.passed, evaluation });
}

function normalizePair(value: unknown): readonly LightscaperDevelopProxyDiagnosticV1[] {
	const diagnostics = exactArray(value, 2, 'EN/DE diagnostic pair').map(normalizeDiagnostic);
	if (new Set(diagnostics.map(item => item.locale)).size !== 2) throw new TypeError('Expected exactly one EN and one DE diagnostic.');
	diagnostics.sort((left, right) => left.locale === right.locale ? 0 : left.locale === 'en' ? -1 : 1);
	const comparable = (item: LightscaperDevelopProxyDiagnosticV1) => JSON.stringify({ fixture: item.fixture, protocol: item.protocol,
		browser: item.browser, runtime: item.runtime, environmentId: item.environmentId, instrumentation: item.instrumentation });
	if (comparable(diagnostics[0]!) !== comparable(diagnostics[1]!)) throw new TypeError('EN and DE diagnostic fixture/runtime/protocol identities differ.');
	return Object.freeze(diagnostics);
}
function normalizeDiagnostic(value: unknown): LightscaperDevelopProxyDiagnosticV1 {
	const input = record(value, 'develop proxy diagnostic', ['schemaVersion', 'profile', 'workloadId', 'fixtureId', 'locale', 'environmentId',
		'browser', 'rendererClass', 'instrumentation', 'runtime', 'protocol', 'fixture', 'observations']);
	for (const [key, expected] of [['schemaVersion', 1], ['profile', PROFILE], ['workloadId', WORKLOAD], ['fixtureId', FIXTURE], ['rendererClass', 'unknown']] as const) equal(input, key, expected);
	const locale = field(input, 'locale', 'diagnostic'), environmentId = field(input, 'environmentId', 'diagnostic');
	if (locale !== 'en' && locale !== 'de') throw new TypeError('Diagnostic locale must be EN or DE.');
	if (environmentId !== 'local-runtime-diagnostics' && environmentId !== 'github-ubuntu-playwright-1.62.1') throw new TypeError('Diagnostic environment is unsupported.');
	const browser = record(field(input, 'browser', 'diagnostic'), 'browser', ['name', 'version']), name = field(browser, 'name', 'browser');
	if (name !== 'chromium' && name !== 'firefox') throw new TypeError('Diagnostic browser is unsupported.');
	if (environmentId === 'github-ubuntu-playwright-1.62.1' && name !== 'chromium') throw new TypeError('Hosted diagnostics require Chromium; Firefox qualifies separately.');
	const instrumentation = field(input, 'instrumentation', 'diagnostic');
	if (instrumentation !== 'none' && instrumentation !== 'v8-browser') throw new TypeError('Diagnostic instrumentation is unsupported.');
	if (name === 'firefox' && instrumentation !== 'none') throw new TypeError('Firefox has no V8 browser instrumentation.');
	const fixture = normalizeFixture(field(input, 'fixture', 'diagnostic'));
	return Object.freeze({ schemaVersion: 1, profile: PROFILE, workloadId: WORKLOAD, fixtureId: FIXTURE, locale, environmentId,
		browser: Object.freeze({ name, version: text(field(browser, 'version', 'browser'), 'browser version', 128) }), rendererClass: 'unknown', instrumentation,
		runtime: normalizeRuntime(field(input, 'runtime', 'diagnostic')), protocol: normalizeProtocol(field(input, 'protocol', 'diagnostic'), instrumentation), fixture,
		observations: normalizeObservations(field(input, 'observations', 'diagnostic'), fixture) });
}
function normalizeFixture(value: unknown): Fixture {
	const input = record(value, 'fixture', [...Object.keys(DIMENSIONS), 'encodedByteLength', 'encodedSha256', 'sourceRgbaSha256', 'proxyRgbaSha256', 'dehazeRgbaSha256', 'goldens']);
	for (const [key, expected] of Object.entries(DIMENSIONS)) equal(input, key, expected);
	const encodedByteLength = count(input, 'encodedByteLength', 64 * 1024 * 1024);
	if (encodedByteLength === 0) throw new RangeError('Encoded fixture must contain bytes.');
	return Object.freeze({ ...DIMENSIONS, encodedByteLength, encodedSha256: hash(input, 'encodedSha256'), sourceRgbaSha256: hash(input, 'sourceRgbaSha256'),
		proxyRgbaSha256: hash(input, 'proxyRgbaSha256'), dehazeRgbaSha256: hash(input, 'dehazeRgbaSha256'),
		goldens: Object.freeze(exactArray(field(input, 'goldens', 'fixture'), 5, 'fixture goldens').map((value, index) => {
			const item = record(value, 'golden', ['amount', 'afterSha256']); equal(item, 'amount', AMOUNTS[index]!);
			return Object.freeze({ amount: AMOUNTS[index]!, afterSha256: hash(item, 'afterSha256') });
		})) });
}
function normalizeProtocol(value: unknown, instrumentation: LightscaperDevelopProxyDiagnosticV1['instrumentation']): Protocol {
	const protocol = instrumentation === 'none' ? PROTOCOL : V8_PROTOCOL;
	const input = record(value, 'protocol', Object.keys(protocol));
	for (const [key, expected] of Object.entries(protocol)) equal(input, key, expected);
	return protocol;
}
function normalizeRuntime(value: unknown): LightscaperDevelopProxyDiagnosticV1['runtime'] {
	const input = record(value, 'runtime', ['platform', 'userAgent', 'hardwareConcurrency', 'deviceMemoryGiB', 'viewportWidth', 'viewportHeight', 'deviceScaleFactor', 'decodePath']);
	equal(input, 'decodePath', 'unknown'); const memory = field(input, 'deviceMemoryGiB', 'runtime');
	return Object.freeze({ platform: text(field(input, 'platform', 'runtime'), 'platform', 256), userAgent: text(field(input, 'userAgent', 'runtime'), 'user agent', 4096),
		hardwareConcurrency: positiveCount(input, 'hardwareConcurrency', 4096), deviceMemoryGiB: memory === null ? null : finite(memory, 'device memory', true),
		viewportWidth: positiveCount(input, 'viewportWidth', 65_536), viewportHeight: positiveCount(input, 'viewportHeight', 65_536),
		deviceScaleFactor: finite(field(input, 'deviceScaleFactor', 'runtime'), 'device scale factor', true), decodePath: 'unknown' });
}
function normalizeObservations(value: unknown, fixture: Fixture): LightscaperDevelopProxyDiagnosticV1['observations'] {
	const input = record(value, 'observations', ['coldOpen', 'beforeActualSha256', 'beforePixelMismatchCount', 'initialAfterActualSha256', 'initialAfterPixelMismatchCount',
		'serialTrials', 'burstTrials', 'close', 'custody']);
	const cold = record(field(input, 'coldOpen', 'observations'), 'cold open', ['inputAtMs', 'readyAtMs', 'presentedAtMs']);
	const coldOpen = timing(cold); let priorSequence = 0, priorPresented = coldOpen.presentedAtMs;
	function captureInput(item: DataRecord, amount: number): Input {
		equal(item, 'amount', amount); equal(item, 'inputTrusted', true);
		const inputSequence = positiveCount(item, 'inputSequence'), inputAtMs = finite(field(item, 'inputAtMs', 'input'), 'input timestamp');
		if (inputSequence <= priorSequence || inputAtMs < priorPresented) throw new TypeError('Native input sequence/time must remain ordered.');
		priorSequence = inputSequence; priorPresented = inputAtMs;
		return Object.freeze({ amount, inputSequence, inputTrusted: true, inputAtMs });
	}
	const serialTrials = Object.freeze(exactArray(field(input, 'serialTrials', 'observations'), 6, 'serial trials').map((value, trial) => {
		const item = record(value, 'serial trial', ['trial', 'amount', 'inputSequence', 'inputTrusted', 'inputAtMs', 'readyAtMs', 'presentedAtMs',
			'pendingObserved', 'actualAmount', 'expectedAfterSha256', 'actualAfterSha256', 'pixelMismatchCount']);
		equal(item, 'trial', trial); equal(item, 'pendingObserved', true);
		const captured = captureInput(item, SERIAL[trial]!), times = timing(item); priorPresented = times.presentedAtMs;
		return Object.freeze({ trial, ...captured, ...times, ...pixelResult(item, fixture, captured.amount), pendingObserved: true as const,
			actualAmount: finite(field(item, 'actualAmount', 'trial'), 'actual amount') });
	}));
	const burstTrials = Object.freeze(exactArray(field(input, 'burstTrials', 'observations'), 6, 'burst trials').map((value, trial) => {
		const item = record(value, 'burst trial', ['trial', 'inputs', 'earlierWorkPending', 'pendingObserved', 'readyAtMs', 'presentedAtMs', 'actualAmount', 'expectedAfterSha256', 'actualAfterSha256', 'pixelMismatchCount']);
		equal(item, 'trial', trial); equal(item, 'pendingObserved', true);
		const inputs = Object.freeze(exactArray(field(item, 'inputs', 'burst'), 3, 'burst inputs').map((value, index) => {
			const entry = record(value, 'burst input', ['amount', 'inputSequence', 'inputTrusted', 'inputAtMs']);
			return captureInput(entry, [25, 100, 50][index]!);
		}));
		const times = timing(item, inputs[2]!.inputAtMs); priorPresented = times.presentedAtMs;
		const earlierWorkPending = Object.freeze(exactArray(field(item, 'earlierWorkPending', 'burst'), 2, 'burst pending witnesses').map(value => {
			if (value !== true) throw new TypeError('Earlier burst work must actually remain pending.'); return true as const;
		}));
		return Object.freeze({ trial, inputs, earlierWorkPending, pendingObserved: true as const, readyAtMs: times.readyAtMs, presentedAtMs: times.presentedAtMs,
			...pixelResult(item, fixture, 50), actualAmount: finite(field(item, 'actualAmount', 'burst'), 'actual amount') });
	}));
	const close = record(field(input, 'close', 'observations'), 'close', ['pendingObserved', 'closedWithoutLatePublication', 'expectedAfterSha256', 'actualAfterSha256', 'pixelMismatchCount']);
	equal(close, 'pendingObserved', true); const closedWithoutLatePublication = field(close, 'closedWithoutLatePublication', 'close');
	if (typeof closedWithoutLatePublication !== 'boolean') throw new TypeError('Close publication observation must be Boolean.');
	const custody = record(field(input, 'custody', 'observations'), 'custody', ['beforeSha256', 'afterSaveSha256', 'afterReloadSha256', 'savedRecipe', 'reloadedRecipe']);
	return Object.freeze({ coldOpen, beforeActualSha256: hash(input, 'beforeActualSha256'), beforePixelMismatchCount: count(input, 'beforePixelMismatchCount'),
		initialAfterActualSha256: hash(input, 'initialAfterActualSha256'), initialAfterPixelMismatchCount: count(input, 'initialAfterPixelMismatchCount'), serialTrials, burstTrials,
		close: Object.freeze({ pendingObserved: true, closedWithoutLatePublication, ...pixelResult(close, fixture, 50) }),
		custody: Object.freeze({ beforeSha256: hash(custody, 'beforeSha256'), afterSaveSha256: hash(custody, 'afterSaveSha256'), afterReloadSha256: hash(custody, 'afterReloadSha256'),
			savedRecipe: normalizeRecipe(field(custody, 'savedRecipe', 'custody')), reloadedRecipe: normalizeRecipe(field(custody, 'reloadedRecipe', 'custody')) }) });
}
function pixelResult(input: DataRecord, fixture: Fixture, amount: number): Pixels {
	const expectedAfterSha256 = hash(input, 'expectedAfterSha256');
	if (expectedAfterSha256 !== golden(fixture, amount)) throw new TypeError('Expected frame digest must match its requested fixture golden.');
	return Object.freeze({ expectedAfterSha256, actualAfterSha256: hash(input, 'actualAfterSha256'), pixelMismatchCount: count(input, 'pixelMismatchCount') });
}
function normalizeRecipe(value: unknown): RecipeFacts {
	const input = record(value, 'recipe facts', ['processVersion', 'maskCount', 'dehazeAmount', 'sharpenAmount', 'sharpenThreshold', 'stageOrder']);
	return Object.freeze({ processVersion: count(input, 'processVersion'), maskCount: count(input, 'maskCount'),
		dehazeAmount: finite(field(input, 'dehazeAmount', 'recipe'), 'dehaze amount'), sharpenAmount: finite(field(input, 'sharpenAmount', 'recipe'), 'sharpen amount'),
		sharpenThreshold: finite(field(input, 'sharpenThreshold', 'recipe'), 'sharpen threshold'),
		stageOrder: Object.freeze(array(field(input, 'stageOrder', 'recipe'), 'recipe stage order', 0, 128).map(value => text(value, 'stage ID', 128))) });
}
function recipeMatches(value: RecipeFacts): boolean {
	return value.processVersion === 1 && value.maskCount === 0 && value.dehazeAmount === 37.125 && value.sharpenAmount === 50
		&& value.sharpenThreshold === 0 && JSON.stringify(value.stageOrder) === JSON.stringify(['dehaze-v1', 'detail-sharpen-v1']);
}
function timing(input: DataRecord, start?: number): Timing {
	const inputAtMs = start ?? finite(field(input, 'inputAtMs', 'timing'), 'input timestamp');
	const readyAtMs = finite(field(input, 'readyAtMs', 'timing'), 'ready timestamp'), presentedAtMs = finite(field(input, 'presentedAtMs', 'timing'), 'presentation timestamp');
	if (readyAtMs < inputAtMs || presentedAtMs < readyAtMs) throw new TypeError('Timing endpoints must follow the actual input.');
	return Object.freeze({ inputAtMs, readyAtMs, presentedAtMs });
}
function exactArray(value: unknown, length: number, name: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${name} requires native arrays.`);
	return array(value, name, length, length);
}
function equal(input: DataRecord, key: string, expected: unknown): void { if (field(input, key, key) !== expected) throw new TypeError(`${key} is unsupported.`); }
function finite(value: unknown, name: string, positive = false): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER || (positive ? value <= 0 : value < 0)) throw new RangeError(`${name} must be bounded finite ${positive ? 'positive' : 'nonnegative'} data.`);
	return value;
}
function count(input: DataRecord, key: string, maximum = Number.MAX_SAFE_INTEGER): number {
	const value = finite(field(input, key, key), key);
	if (!Number.isSafeInteger(value) || value > maximum) throw new RangeError(`${key} must be a bounded safe integer.`); return value;
}
function positiveCount(input: DataRecord, key: string, maximum = Number.MAX_SAFE_INTEGER): number {
	const value = count(input, key, maximum); if (value === 0) throw new RangeError(`${key} must be positive.`); return value;
}
function text(value: unknown, name: string, maximum: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximum) throw new TypeError(`${name} must be bounded nonempty text.`); return value;
}
function hash(input: DataRecord, key: string): string {
	const value = text(field(input, key, key), key, 64); if (!/^[a-f\d]{64}$/u.test(value)) throw new TypeError(`${key} must be a lowercase SHA-256.`); return value;
}
function golden(fixture: Fixture, amount: number): string { return fixture.goldens.find(item => item.amount === amount)!.afterSha256; }
function mismatch(count: number, actual: string, expected: string): number { return Math.max(count, Number(actual !== expected)); }
function nearestRank(values: readonly number[]): number { return [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.95) - 1]!; }

/** Descriptor-only bounded snapshots keep foreign config data out of the legacy register evaluator. */
function snapshotConfig(value: unknown): JsonValue {
	let nodes = 0, characters = 0;
	function visit(input: unknown, depth: number): JsonValue {
		if (++nodes > 50_000 || depth > 16) throw new RangeError('Quality config exceeds its node/depth bound.');
		if (input === null || typeof input === 'boolean') return input;
		if (typeof input === 'string') { characters += input.length; if (characters > 8 * 1024 * 1024) throw new RangeError('Quality config text exceeds its bound.'); return input; }
		if (typeof input === 'number') { if (!Number.isFinite(input)) throw new RangeError('Quality config requires finite numbers.'); return input; }
		if (Array.isArray(input)) return array(input, 'config array', 0, 4096).map(item => visit(item, depth + 1));
		if (!input || typeof input !== 'object') throw new TypeError('Quality config requires plain JSON data.');
		const keys = Reflect.ownKeys(input);
		if (keys.length > 128 || keys.some(key => typeof key !== 'string')) throw new RangeError('Quality config fields exceed their bound.');
		const names = keys as string[], captured = record(input, 'quality config', names);
		characters += names.reduce((sum, key) => sum + key.length, 0); if (characters > 8 * 1024 * 1024) throw new RangeError('Quality config text exceeds its bound.');
		return Object.fromEntries(names.map(key => [key, visit(field(captured, key, 'quality config'), depth + 1)]));
	}
	return visit(value, 0);
}
function assertUniqueJsonMembers(source: string): void {
	const tokens = source.match(/"(?:[^"\\]|\\[\s\S])*"|[{}[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gu) ?? [];
	let position = 0;
	function visit(depth: number): void {
		if (depth > 16) throw new RangeError('Diagnostic JSON exceeds its depth bound.');
		const token = tokens[position++]; if (token !== '{' && token !== '[') return;
		const end = token === '{' ? '}' : ']', seen = new Set<string>();
		while (tokens[position] !== end) {
			if (token === '{') { const key = JSON.parse(tokens[position++]!) as string;
				if (seen.has(key)) throw new TypeError('Diagnostic JSON contains a duplicate member.'); seen.add(key); position++; }
			visit(depth + 1); if (tokens[position] === ',') position++;
		}
		position++;
	}
	visit(0);
}
