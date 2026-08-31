/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_FORMAT_VERSION } from './scape-archive-envelope.ts';
import { LOCAL_DIAGNOSTICS_ERROR_LIMIT } from './local-diagnostics-error-journal.ts';
import {
	ARCHITECTURES, BROWSER_NAMES, ERROR_SOURCES, EVICTION_PROTECTIONS,
	LOCAL_DIAGNOSTICS_CAPABILITY_IDS, LOCAL_DIAGNOSTICS_MAX_BYTES,
	LOCAL_DIAGNOSTICS_REPORT_SCHEMA_VERSION, PLATFORMS, PREFLIGHT_STATUSES,
	PRODUCT_IDS, PROJECT_FAMILIES, RECOVERY_STATES, STORAGE_BACKENDS,
	STORAGE_PRESSURES, STORAGE_STATES,
	type Architecture, type BrowserName, type LocalDiagnosticsReport,
	type LocalDiagnosticsRuntimeIdentity, type Platform, type ProductId, type RecoveryState,
	type SerializedLocalDiagnosticsReport,
} from './local-diagnostics-contract.ts';

export {
	LOCAL_DIAGNOSTICS_CAPABILITY_IDS,
	LOCAL_DIAGNOSTICS_MAX_BYTES,
	LOCAL_DIAGNOSTICS_REPORT_SCHEMA_VERSION,
} from './local-diagnostics-contract.ts';
export type {
	LocalDiagnosticsReport,
	LocalDiagnosticsRuntimeIdentity,
	SerializedLocalDiagnosticsReport,
} from './local-diagnostics-contract.ts';

export function createLocalDiagnosticsRuntimeIdentity(input: Readonly<{
	isDesktop: boolean;
	locale?: unknown;
	desktopEnvironment?: unknown;
	navigator?: unknown;
}>): Readonly<LocalDiagnosticsRuntimeIdentity> {
	const environment = record(input.desktopEnvironment);
	const navigatorValue = record(input.navigator);
	if (input.isDesktop) {
		const versions = record(data(environment, 'runtimeVersions'));
		return deepFreeze({
			kind: 'desktop',
			platform: normalizedPlatform(data(environment, 'platform')),
			architecture: normalizedArchitecture(data(environment, 'arch')),
			locale: normalizedLocale(data(environment, 'locale') ?? input.locale),
			browser: null,
			desktop: {
				electron: normalizedVersion(data(versions, 'electron')),
				chromium: normalizedVersion(data(versions, 'chromium')),
				node: normalizedVersion(data(versions, 'node')),
			},
		});
	}
	const platformText = stringValue(data(navigatorValue, 'platform')) ?? '';
	const userAgent = stringValue(data(navigatorValue, 'userAgent')) ?? '';
	return deepFreeze({
		kind: 'browser',
		platform: browserPlatform(`${platformText} ${userAgent}`),
		architecture: normalizedArchitecture(`${platformText} ${userAgent}`),
		locale: normalizedLocale(input.locale ?? data(navigatorValue, 'language')),
		browser: browserIdentity(userAgent),
		desktop: null,
	});
}

export function buildLocalDiagnosticsReport(input: Readonly<{
	generatedAt: unknown;
	applicationVersion: unknown;
	productId: unknown;
	runtime: Readonly<LocalDiagnosticsRuntimeIdentity>;
	capabilities: unknown;
	streaming: unknown;
	snapshot: unknown;
	diagnostics: unknown;
}>): Readonly<LocalDiagnosticsReport> {
	const productId = productIdValue(input.productId);
	const snapshot = record(input.snapshot);
	const project = record(data(snapshot, 'project'));
	const identity = projectIdentity(project);
	const generatedAt = normalizedTimestamp(input.generatedAt);
	const errors = normalizedErrors(input.diagnostics, generatedAt);
	const storage = record(data(snapshot, 'storage'));
	const report: LocalDiagnosticsReport = {
		kind: 'soundscaper-local-diagnostics',
		schemaVersion: LOCAL_DIAGNOSTICS_REPORT_SCHEMA_VERSION,
		generatedAt,
		product: { id: productId },
		versions: {
			application: normalizedApplicationVersion(input.applicationVersion),
			diagnostics: LOCAL_DIAGNOSTICS_REPORT_SCHEMA_VERSION,
			project: identity && { family: identity.family, version: identity.version },
			scapeFormat: SCAPE_FORMAT_VERSION,
		},
		environment: input.runtime,
		capabilities: capabilitySnapshot(input.capabilities),
		errors: { retainedLimit: LOCAL_DIAGNOSTICS_ERROR_LIMIT, recent: errors },
		storage: {
			state: enumValue(data(storage, 'state'), STORAGE_STATES, 'unknown'),
			backend: enumValue(data(storage, 'backend'), STORAGE_BACKENDS, 'unknown'),
			persistent: data(storage, 'persistent') === true,
			ephemeral: data(storage, 'ephemeral') === true,
			pressure: enumValue(data(storage, 'pressure'), STORAGE_PRESSURES, 'unknown'),
			evictionProtection: enumValue(
				data(storage, 'evictionProtection'), EVICTION_PROTECTIONS, 'unknown',
			),
			usageBytes: byteCount(data(storage, 'usage')),
			quotaBytes: byteCount(data(storage, 'quota')),
			freeBytes: byteCount(data(storage, 'free')),
			lastPreflightStatus: enumValue(
				data(record(data(storage, 'lastPreflight')), 'status'), PREFLIGHT_STATUSES, 'unknown',
			),
		},
		library: {
			projectCount: arrayLength(data(snapshot, 'projects')),
			openProjectCount: arrayLength(data(snapshot, 'projectTabs')),
			current: identity ? {
				family: identity.family,
				version: identity.version,
				revision: nonnegativeInteger(data(project, 'revision')) ?? 0,
				readOnly: data(snapshot, 'readOnly') === true,
			} : null,
		},
		recovery: {
			takeCycle: productId === 'soundscaper'
				? data(snapshot, 'takeCycleRecovery') == null ? 'inactive' : 'pending'
				: 'not-applicable',
			capture: productId === 'framescaper'
				? activeRecoveryState(data(record(data(snapshot, 'capture')), 'phase'))
				: 'not-applicable',
			webVcr: productId === 'framescaper'
				? activeRecoveryState(data(record(data(snapshot, 'webVcr')), 'phase'))
				: 'not-applicable',
			renderQueue: 'not-observed',
		},
		streaming: streamingSnapshot(input.streaming),
	};
	return deepFreeze(report);
}

export function serializeLocalDiagnosticsReport(value: unknown): Readonly<SerializedLocalDiagnosticsReport> {
	assertLocalDiagnosticsReport(value);
	const text = `${JSON.stringify(value, null, '\t')}\n`;
	const byteLength = new TextEncoder().encode(text).byteLength;
	if (byteLength > LOCAL_DIAGNOSTICS_MAX_BYTES) {
		throw new RangeError(`A local diagnostic report cannot exceed ${String(LOCAL_DIAGNOSTICS_MAX_BYTES)} bytes.`);
	}
	return Object.freeze({
		text,
		fileName: `${value.product.id}-diagnostics-${value.generatedAt.slice(0, 10)}.json`,
		mimeType: 'application/json' as const,
	});
}

export async function saveLocalDiagnosticsReport(
	report: unknown,
	fileService: Readonly<{
		saveFile?: (request: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
	}> | null | undefined,
): Promise<Readonly<SerializedLocalDiagnosticsReport>> {
	const serialized = serializeLocalDiagnosticsReport(report);
	if (fileService?.saveFile) {
		await fileService.saveFile({
			purpose: 'report',
			suggestedName: serialized.fileName,
			mimeType: serialized.mimeType,
			blob: new Blob([serialized.text], { type: serialized.mimeType }),
		});
	}
	return serialized;
}

function capabilitySnapshot(value: unknown) {
	const capabilities = record(value);
	return LOCAL_DIAGNOSTICS_CAPABILITY_IDS.map((id) => Object.freeze({
		id,
		available: data(capabilities, id) === true,
	}));
}

function streamingSnapshot(value: unknown) {
	const streaming = record(value);
	return Object.freeze({
		streamUnderrunFrames: nonnegativeInteger(data(streaming, 'streamUnderrunFrames')) ?? 0,
		streamedPlaybackObserved: data(streaming, 'streamedPlaybackObserved') === true,
	});
}

function normalizedErrors(value: unknown, fallbackTimestamp: string) {
	const recent = data(record(value), 'recentErrors');
	if (!Array.isArray(recent)) return [];
	return recent.slice(-LOCAL_DIAGNOSTICS_ERROR_LIMIT).map((candidate) => {
		const entry = record(candidate);
		return Object.freeze({
			occurredAt: optionalTimestamp(data(entry, 'occurredAt')) ?? fallbackTimestamp,
			source: enumValue(data(entry, 'source'), ERROR_SOURCES, 'controller'),
			name: normalizedName(data(entry, 'name')),
			code: normalizedCode(data(entry, 'code')),
		});
	});
}

function projectIdentity(project: Readonly<Record<string, unknown>> | null) {
	const family = data(project, 'schemaFamily');
	const version = nonnegativeInteger(data(project, 'schemaVersion'));
	return enumIncludes(PROJECT_FAMILIES, family) && version !== null && version > 0
		? { family, version }
		: null;
}

function activeRecoveryState(value: unknown): RecoveryState {
	if (value === null || value === undefined || value === 'inactive' || value === 'closed') return 'inactive';
	if (value === 'recovery' || value === 'failed') return 'recovery';
	return typeof value === 'string' ? 'active' : 'inactive';
}

function browserIdentity(userAgent: string): Readonly<{ name: BrowserName; version: string | null }> {
	const candidates: readonly [BrowserName, RegExp][] = [
		['firefox', /Firefox\/([0-9.]+)/u],
		['chromium', /(?:Chrome|Chromium)\/([0-9.]+)/u],
		['webkit', /Version\/([0-9.]+).*Safari\//u],
	];
	for (const [name, pattern] of candidates) {
		const match = pattern.exec(userAgent);
		if (match) return Object.freeze({ name, version: normalizedVersion(match[1]) });
	}
	return Object.freeze({ name: 'unknown', version: null });
}

function browserPlatform(value: string): Platform {
	if (/Android/iu.test(value)) return 'android';
	if (/iPhone|iPad|iPod/iu.test(value)) return 'ios';
	if (/Win/iu.test(value)) return 'win32';
	if (/Mac/iu.test(value)) return 'darwin';
	if (/Linux/iu.test(value)) return 'linux';
	return 'unknown';
}

function normalizedPlatform(value: unknown): Platform {
	return enumValue(value, PLATFORMS, 'unknown');
}

function normalizedArchitecture(value: unknown): Architecture {
	const text = stringValue(value) ?? '';
	if (/arm64|aarch64/iu.test(text)) return 'arm64';
	if (/\barm\b/iu.test(text)) return 'arm';
	if (/x86_64|x64|Win64/iu.test(text)) return 'x64';
	if (/ia32|i[3-6]86/iu.test(text)) return 'ia32';
	return 'unknown';
}

function normalizedLocale(value: unknown): string {
	const locale = stringValue(value)?.trim().toLowerCase() ?? '';
	return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(locale) && locale.length <= 35 ? locale : 'und';
}

function normalizedApplicationVersion(value: unknown): string {
	const version = stringValue(value)?.trim() ?? '';
	return /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(version) ? version : 'unknown';
}

function normalizedVersion(value: unknown): string | null {
	const version = stringValue(value)?.trim() ?? '';
	return /^[0-9]+(?:\.[0-9]+){0,4}(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)
		&& version.length <= 64 ? version : null;
}

function normalizedName(value: unknown): string {
	const name = stringValue(value) ?? '';
	return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name) ? name : 'NonError';
}

function normalizedCode(value: unknown): string {
	const code = stringValue(value) ?? '';
	return /^[A-Z][A-Z0-9_]{0,63}$/u.test(code) ? code : 'UNCLASSIFIED';
}

function normalizedTimestamp(value: unknown): string {
	const timestamp = optionalTimestamp(value);
	if (timestamp === null) throw new TypeError('A valid diagnostic generation timestamp is required.');
	return timestamp;
}

function optionalTimestamp(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function productIdValue(value: unknown): ProductId {
	if (enumIncludes(PRODUCT_IDS, value)) return value;
	throw new RangeError('A local diagnostic report requires a registered product.');
}

function byteCount(value: unknown): number | null {
	return nonnegativeInteger(value);
}

function nonnegativeInteger(value: unknown): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function stringValue(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function data(value: Readonly<Record<string, unknown>> | null, key: string): unknown {
	if (!value) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function enumIncludes<const Values extends readonly string[]>(values: Values, value: unknown): value is Values[number] {
	return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	fallback: Values[number],
): Values[number] {
	return enumIncludes(values, value) ? value : fallback;
}

function deepFreeze<Value>(value: Value): Readonly<Value> {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function assertLocalDiagnosticsReport(value: unknown): asserts value is LocalDiagnosticsReport {
	const report = exactRecord(value, [
		'kind', 'schemaVersion', 'generatedAt', 'product', 'versions', 'environment',
		'capabilities', 'errors', 'storage', 'library', 'recovery', 'streaming',
	], 'report');
	assertEqual(data(report, 'kind'), 'soundscaper-local-diagnostics', 'report kind');
	assertEqual(data(report, 'schemaVersion'), 1, 'report schema version');
	assertTimestamp(data(report, 'generatedAt'), 'report generatedAt');
	const product = exactRecord(data(report, 'product'), ['id'], 'product');
	assertEnum(data(product, 'id'), PRODUCT_IDS, 'product id');
	const versions = exactRecord(
		data(report, 'versions'), ['application', 'diagnostics', 'project', 'scapeFormat'], 'versions',
	);
	assertToken(data(versions, 'application'), /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u, 'application version');
	assertEqual(data(versions, 'diagnostics'), 1, 'diagnostics version');
	assertEqual(data(versions, 'scapeFormat'), SCAPE_FORMAT_VERSION, 'Scape version');
	assertProjectVersion(data(versions, 'project'));
	assertEnvironment(data(report, 'environment'));
	assertCapabilities(data(report, 'capabilities'));
	assertErrors(data(report, 'errors'));
	assertStorage(data(report, 'storage'));
	assertLibrary(data(report, 'library'));
	assertRecovery(data(report, 'recovery'));
	assertStreaming(data(report, 'streaming'));
}

function assertEnvironment(value: unknown): void {
	const environment = exactRecord(
		value, ['kind', 'platform', 'architecture', 'locale', 'browser', 'desktop'], 'environment',
	);
	const kind = data(environment, 'kind');
	assertEnum(kind, ['browser', 'desktop'] as const, 'runtime kind');
	assertEnum(data(environment, 'platform'), PLATFORMS, 'platform');
	assertEnum(data(environment, 'architecture'), ARCHITECTURES, 'architecture');
	assertToken(data(environment, 'locale'), /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$|^und$/u, 'locale');
	if (kind === 'browser') {
		const browser = exactRecord(data(environment, 'browser'), ['name', 'version'], 'browser');
		assertEnum(data(browser, 'name'), BROWSER_NAMES, 'browser name');
		assertNullableVersion(data(browser, 'version'), 'browser version');
		assertEqual(data(environment, 'desktop'), null, 'desktop environment');
	} else {
		assertEqual(data(environment, 'browser'), null, 'browser environment');
		const desktop = exactRecord(
			data(environment, 'desktop'), ['electron', 'chromium', 'node'], 'desktop environment',
		);
		for (const key of ['electron', 'chromium', 'node']) {
			assertNullableVersion(data(desktop, key), `${key} version`);
		}
	}
}

function assertCapabilities(value: unknown): void {
	const capabilities = denseArray(value, 'capabilities');
	if (capabilities.length !== LOCAL_DIAGNOSTICS_CAPABILITY_IDS.length) {
		throw new TypeError('Diagnostic capability keys do not match the allowlist.');
	}
	for (const [index, expectedId] of LOCAL_DIAGNOSTICS_CAPABILITY_IDS.entries()) {
		const capability = exactRecord(capabilities[index], ['id', 'available'], 'capability');
		assertEqual(data(capability, 'id'), expectedId, 'capability id');
		assertBoolean(data(capability, 'available'), 'capability availability');
	}
}

function assertErrors(value: unknown): void {
	const errors = exactRecord(value, ['retainedLimit', 'recent'], 'errors');
	assertEqual(data(errors, 'retainedLimit'), LOCAL_DIAGNOSTICS_ERROR_LIMIT, 'retained error limit');
	const recent = denseArray(data(errors, 'recent'), 'recent errors');
	if (recent.length > LOCAL_DIAGNOSTICS_ERROR_LIMIT) {
		throw new RangeError('A diagnostic report cannot retain more than 32 errors.');
	}
	for (const candidate of recent) {
		const entry = exactRecord(candidate, ['occurredAt', 'source', 'name', 'code'], 'error');
		assertTimestamp(data(entry, 'occurredAt'), 'error timestamp');
		assertEnum(data(entry, 'source'), ERROR_SOURCES, 'error source');
		assertToken(data(entry, 'name'), /^[A-Za-z][A-Za-z0-9]{0,63}$/u, 'error name');
		assertToken(data(entry, 'code'), /^[A-Z][A-Z0-9_]{0,63}$/u, 'error code');
	}
}

function assertStorage(value: unknown): void {
	const storage = exactRecord(value, [
		'state', 'backend', 'persistent', 'ephemeral', 'pressure', 'evictionProtection',
		'usageBytes', 'quotaBytes', 'freeBytes', 'lastPreflightStatus',
	], 'storage');
	assertEnum(data(storage, 'state'), STORAGE_STATES, 'storage state');
	assertEnum(data(storage, 'backend'), STORAGE_BACKENDS, 'storage backend');
	assertBoolean(data(storage, 'persistent'), 'storage persistence');
	assertBoolean(data(storage, 'ephemeral'), 'storage ephemerality');
	assertEnum(data(storage, 'pressure'), STORAGE_PRESSURES, 'storage pressure');
	assertEnum(data(storage, 'evictionProtection'), EVICTION_PROTECTIONS, 'eviction protection');
	for (const key of ['usageBytes', 'quotaBytes', 'freeBytes']) assertNullableCount(data(storage, key), key);
	assertEnum(data(storage, 'lastPreflightStatus'), PREFLIGHT_STATUSES, 'preflight status');
}

function assertLibrary(value: unknown): void {
	const library = exactRecord(value, ['projectCount', 'openProjectCount', 'current'], 'library');
	assertCount(data(library, 'projectCount'), 'project count');
	assertCount(data(library, 'openProjectCount'), 'open project count');
	const current = data(library, 'current');
	if (current === null) return;
	const project = exactRecord(current, ['family', 'version', 'revision', 'readOnly'], 'current project');
	assertEnum(data(project, 'family'), PROJECT_FAMILIES, 'current project family');
	assertPositiveCount(data(project, 'version'), 'current project version');
	assertCount(data(project, 'revision'), 'current project revision');
	assertBoolean(data(project, 'readOnly'), 'current project read-only state');
}

function assertRecovery(value: unknown): void {
	const recovery = exactRecord(
		value, ['takeCycle', 'capture', 'webVcr', 'renderQueue'], 'recovery',
	);
	for (const key of ['takeCycle', 'capture', 'webVcr']) {
		assertEnum(data(recovery, key), RECOVERY_STATES, `${key} recovery state`);
	}
	assertEqual(data(recovery, 'renderQueue'), 'not-observed', 'render queue state');
}

function assertStreaming(value: unknown): void {
	const streaming = exactRecord(
		value, ['streamUnderrunFrames', 'streamedPlaybackObserved'], 'streaming',
	);
	assertCount(data(streaming, 'streamUnderrunFrames'), 'stream underrun frames');
	assertBoolean(data(streaming, 'streamedPlaybackObserved'), 'streamed playback observation');
}

function assertProjectVersion(value: unknown): void {
	if (value === null) return;
	const project = exactRecord(value, ['family', 'version'], 'project version');
	assertEnum(data(project, 'family'), PROJECT_FAMILIES, 'project family');
	assertPositiveCount(data(project, 'version'), 'project version');
}

function exactRecord(value: unknown, keys: readonly string[], label: string) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`Diagnostic ${label} must be a plain record.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`Diagnostic ${label} must be a plain record.`);
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, 'value'))) {
		throw new TypeError(`Diagnostic ${label} cannot contain accessors.`);
	}
	const actual = Object.keys(value);
	if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
		throw new TypeError(`Diagnostic ${label} keys do not match the schema.`);
	}
	return value as Readonly<Record<string, unknown>>;
}

function denseArray(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`Diagnostic ${label} must be an array.`);
	const keys = Object.keys(value);
	if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
		throw new TypeError(`Diagnostic ${label} must be a dense array.`);
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (keys.some((key) => !Object.hasOwn(descriptors[key], 'value'))) {
		throw new TypeError(`Diagnostic ${label} cannot contain accessors.`);
	}
	return value;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
	if (actual !== expected) throw new TypeError(`Diagnostic ${label} is invalid.`);
}

function assertEnum(actual: unknown, values: readonly string[], label: string): void {
	if (!enumIncludes(values, actual)) throw new TypeError(`Diagnostic ${label} is invalid.`);
}

function assertToken(actual: unknown, pattern: RegExp, label: string): void {
	if (typeof actual !== 'string' || !pattern.test(actual)) {
		throw new TypeError(`Diagnostic ${label} is invalid.`);
	}
}

function assertTimestamp(actual: unknown, label: string): void {
	if (optionalTimestamp(actual) !== actual) throw new TypeError(`Diagnostic ${label} is invalid.`);
}

function assertNullableVersion(actual: unknown, label: string): void {
	if (actual !== null && normalizedVersion(actual) !== actual) {
		throw new TypeError(`Diagnostic ${label} is invalid.`);
	}
}

function assertBoolean(actual: unknown, label: string): void {
	if (typeof actual !== 'boolean') throw new TypeError(`Diagnostic ${label} is invalid.`);
}

function assertCount(actual: unknown, label: string): void {
	if (nonnegativeInteger(actual) === null) throw new TypeError(`Diagnostic ${label} is invalid.`);
}

function assertPositiveCount(actual: unknown, label: string): void {
	if (nonnegativeInteger(actual) === null || actual === 0) throw new TypeError(`Diagnostic ${label} is invalid.`);
}

function assertNullableCount(actual: unknown, label: string): void {
	if (actual !== null) assertCount(actual, label);
}
