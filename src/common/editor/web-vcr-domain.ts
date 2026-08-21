/* SPDX-License-Identifier: AGPL-3.0-only */

export const WEB_VCR_RESOLUTIONS = Object.freeze(['720p', '1080p', '4k'] as const);
export const WEB_VCR_ASPECTS = Object.freeze(['free', '16:9', '9:16', '1:1'] as const);
export const WEB_VCR_LIFECYCLE_PHASES = Object.freeze([
	'closed',
	'opening',
	'ready',
	'preparing',
	'recording',
	'finalizing',
	'recovery',
	'failed',
] as const);
export const WEB_VCR_CAPABILITY_REASONS = Object.freeze([
	'roadmap-gate',
	'wrong-product',
	'unsupported-platform',
	'desktop-bridge-unavailable',
	'guest-capture-unavailable',
	'video-track-unavailable',
	'audio-track-unavailable',
	'crop-pipeline-unavailable',
	'encoder-unqualified',
	'runtime-error',
] as const);
export const WEB_VCR_MEDIA_STATES = Object.freeze(['playing', 'paused', 'ended'] as const);
export const WEB_VCR_INPUT_MODIFIERS = Object.freeze(['alt', 'control', 'meta', 'shift'] as const);

export type WebVcrResolution = typeof WEB_VCR_RESOLUTIONS[number];
export type WebVcrAspect = typeof WEB_VCR_ASPECTS[number];
export type WebVcrLifecyclePhase = typeof WEB_VCR_LIFECYCLE_PHASES[number];
export type WebVcrCapabilityReason = typeof WEB_VCR_CAPABILITY_REASONS[number];
export type WebVcrMediaState = typeof WEB_VCR_MEDIA_STATES[number];
export type WebVcrInputModifier = typeof WEB_VCR_INPUT_MODIFIERS[number];

export interface WebVcrDimensions {
	readonly width: number;
	readonly height: number;
}

export interface WebVcrNormalizedCrop {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export type WebVcrCapability =
	| Readonly<{ readonly status: 'checking' }>
	| Readonly<{
		readonly status: 'available';
		readonly resolutions: readonly WebVcrResolution[];
	}>
	| Readonly<{
		readonly status: 'unavailable';
		readonly reason: WebVcrCapabilityReason;
		readonly detail: string | null;
	}>;

export interface WebVcrTargetSummary {
	readonly targetId: string;
	readonly generation: number;
	readonly mediaState: WebVcrMediaState;
	readonly aperture: WebVcrNormalizedCrop;
	readonly intrinsicSize: WebVcrDimensions;
}

export interface WebVcrNavigationState {
	readonly generation: number;
	readonly url: string;
	readonly canGoBack: boolean;
	readonly canGoForward: boolean;
	readonly isLoading: boolean;
}

export interface WebVcrRecordingMetrics {
	readonly elapsedMs: number;
	readonly capturedFrames: number;
	readonly droppedFrames: number;
	readonly audioDropoutFrames: number;
	readonly currentAvDriftMs: number | null;
	readonly maximumAbsoluteAvDriftMs: number | null;
}

export interface WebVcrSnapshot {
	readonly version: 1;
	readonly sessionId: string | null;
	readonly generation: number;
	readonly phase: WebVcrLifecyclePhase;
	readonly capability: WebVcrCapability;
	readonly resolution: WebVcrResolution;
	readonly aspect: WebVcrAspect;
	readonly crop: WebVcrNormalizedCrop;
	readonly autoCrop: boolean;
	readonly monitorMuted: boolean;
	readonly autoStop: boolean;
	readonly visible: boolean;
	readonly navigation: WebVcrNavigationState;
	readonly target: WebVcrTargetSummary | null;
	readonly targetEndedRecordingToken: string | null;
	readonly captureSurface: WebVcrDimensions;
	readonly outputSize: WebVcrDimensions | null;
	readonly metrics: WebVcrRecordingMetrics | null;
	readonly failure: string | null;
}

interface WebVcrCommandBaseV1 {
	readonly version: 1;
	readonly sessionId: string;
	readonly generation: number;
}

export type WebVcrPointerAction = 'move' | 'down' | 'up' | 'wheel';
export type WebVcrPointerButton = 'none' | 'left' | 'middle' | 'right';
export type WebVcrKeyAction = 'down' | 'up';

export type WebVcrCommandV1 =
	| Readonly<WebVcrCommandBaseV1 & { readonly kind: 'navigate'; readonly url: string }>
	| Readonly<WebVcrCommandBaseV1 & { readonly kind: 'go-back' }>
	| Readonly<WebVcrCommandBaseV1 & { readonly kind: 'go-forward' }>
	| Readonly<WebVcrCommandBaseV1 & { readonly kind: 'reload' }>
	| Readonly<WebVcrCommandBaseV1 & { readonly kind: 'set-visibility'; readonly visible: boolean }>
	| Readonly<WebVcrCommandBaseV1 & {
		readonly kind: 'pointer-input';
		readonly action: WebVcrPointerAction;
		readonly x: number;
		readonly y: number;
		readonly button: WebVcrPointerButton;
		readonly deltaX: number;
		readonly deltaY: number;
		readonly modifiers: readonly WebVcrInputModifier[];
	}>
	| Readonly<WebVcrCommandBaseV1 & {
		readonly kind: 'key-input';
		readonly action: WebVcrKeyAction;
		readonly key: string;
		readonly code: string;
		readonly repeat: boolean;
		readonly modifiers: readonly WebVcrInputModifier[];
	}>
	| Readonly<WebVcrCommandBaseV1 & {
		readonly kind: 'set-resolution'; readonly resolution: WebVcrResolution;
	}>
	| Readonly<WebVcrCommandBaseV1 & { readonly kind: 'set-auto-crop'; readonly enabled: boolean }>
	| Readonly<WebVcrCommandBaseV1 & {
		readonly kind: 'set-crop';
		readonly crop: WebVcrNormalizedCrop;
		readonly aspect: WebVcrAspect;
	}>
	| Readonly<WebVcrCommandBaseV1 & { readonly kind: 'set-monitor-muted'; readonly muted: boolean }>
	| Readonly<WebVcrCommandBaseV1 & { readonly kind: 'set-auto-stop'; readonly enabled: boolean }>
	| Readonly<WebVcrCommandBaseV1 & { readonly kind: 'request-data-clear' }>
	| Readonly<WebVcrCommandBaseV1 & {
		readonly kind: 'clear-browser-data'; readonly confirmationNonce: string;
	}>
	| Readonly<WebVcrCommandBaseV1 & { readonly kind: 'close-session' }>;

type DataRecord = Readonly<Record<string, unknown>>;

export function normalizeWebVcrResolution(value: unknown): WebVcrResolution {
	return enumValue(value, WEB_VCR_RESOLUTIONS, 'Web VCR resolution');
}

export function normalizeWebVcrAspect(value: unknown): WebVcrAspect {
	return enumValue(value, WEB_VCR_ASPECTS, 'Web VCR aspect');
}

export function normalizeWebVcrLifecyclePhase(value: unknown): WebVcrLifecyclePhase {
	return enumValue(value, WEB_VCR_LIFECYCLE_PHASES, 'Web VCR lifecycle phase');
}

export function normalizeWebVcrCapability(value: unknown): WebVcrCapability {
	const candidate = dataRecord(value, 'Web VCR capability');
	switch (candidate.status) {
		case 'checking':
			closedKeys(candidate, 'Web VCR capability', ['status']);
			return Object.freeze({ status: 'checking' });
		case 'available': {
			closedKeys(candidate, 'Web VCR capability', ['status', 'resolutions']);
			const values = denseArray(candidate.resolutions, 'Web VCR capability resolutions', 3);
			if (values.length === 0) throw new RangeError('Web VCR capability resolutions must not be empty.');
			const seen = new Set<WebVcrResolution>();
			const resolutions = values.map((entry): WebVcrResolution => {
				const resolution = normalizeWebVcrResolution(entry);
				if (seen.has(resolution)) throw new RangeError(`Duplicate Web VCR resolution ${resolution}.`);
				seen.add(resolution);
				return resolution;
			});
			return Object.freeze({ status: 'available', resolutions: Object.freeze(resolutions) });
		}
		case 'unavailable':
			closedKeys(candidate, 'Web VCR capability', ['status', 'reason', 'detail']);
			return Object.freeze({
				status: 'unavailable',
				reason: enumValue(candidate.reason, WEB_VCR_CAPABILITY_REASONS, 'Web VCR capability reason'),
				detail: candidate.detail === null
					? null
					: canonicalString(candidate.detail, 'Web VCR capability detail', 1_024),
			});
		default:
			throw new TypeError('Web VCR capability status is invalid.');
	}
}

export function normalizeWebVcrDimensions(
	value: unknown,
	name = 'Web VCR dimensions',
): Readonly<WebVcrDimensions> {
	const candidate = dataRecord(value, name);
	closedKeys(candidate, name, ['width', 'height']);
	return Object.freeze({
		width: positiveSafeInteger(candidate.width, `${name} width`),
		height: positiveSafeInteger(candidate.height, `${name} height`),
	});
}

export function normalizeWebVcrNormalizedCrop(value: unknown): Readonly<WebVcrNormalizedCrop> {
	const candidate = dataRecord(value, 'Web VCR normalized crop');
	closedKeys(candidate, 'Web VCR normalized crop', ['x', 'y', 'width', 'height']);
	const x = unitInterval(candidate.x, 'Web VCR normalized crop x');
	const y = unitInterval(candidate.y, 'Web VCR normalized crop y');
	const width = positiveUnitInterval(candidate.width, 'Web VCR normalized crop width');
	const height = positiveUnitInterval(candidate.height, 'Web VCR normalized crop height');
	if (x + width > 1 + Number.EPSILON * 8 || y + height > 1 + Number.EPSILON * 8) {
		throw new RangeError('Web VCR normalized crop must remain inside the capture surface.');
	}
	return Object.freeze({
		x,
		y,
		width: canonicalNumber(x + width > 1 ? 1 - x : width),
		height: canonicalNumber(y + height > 1 ? 1 - y : height),
	});
}

export function normalizeWebVcrTargetSummary(value: unknown): Readonly<WebVcrTargetSummary> {
	const candidate = dataRecord(value, 'Web VCR target summary');
	closedKeys(candidate, 'Web VCR target summary', [
		'targetId', 'generation', 'mediaState', 'aperture', 'intrinsicSize',
	]);
	return Object.freeze({
		targetId: canonicalString(candidate.targetId, 'Web VCR target ID', 256),
		generation: nonNegativeSafeInteger(candidate.generation, 'Web VCR target generation'),
		mediaState: enumValue(candidate.mediaState, WEB_VCR_MEDIA_STATES, 'Web VCR target media state'),
		aperture: normalizeWebVcrNormalizedCrop(candidate.aperture),
		intrinsicSize: normalizeWebVcrDimensions(candidate.intrinsicSize, 'Web VCR target intrinsic size'),
	});
}

export function normalizeWebVcrNavigationState(value: unknown): Readonly<WebVcrNavigationState> {
	const candidate = dataRecord(value, 'Web VCR navigation state');
	closedKeys(candidate, 'Web VCR navigation state', [
		'generation', 'url', 'canGoBack', 'canGoForward', 'isLoading',
	]);
	return Object.freeze({
		generation: nonNegativeSafeInteger(candidate.generation, 'Web VCR navigation generation'),
		url: normalizeWebVcrUrl(candidate.url),
		canGoBack: booleanValue(candidate.canGoBack, 'Web VCR canGoBack'),
		canGoForward: booleanValue(candidate.canGoForward, 'Web VCR canGoForward'),
		isLoading: booleanValue(candidate.isLoading, 'Web VCR isLoading'),
	});
}

export function normalizeWebVcrRecordingMetrics(value: unknown): Readonly<WebVcrRecordingMetrics> {
	const candidate = dataRecord(value, 'Web VCR recording metrics');
	closedKeys(candidate, 'Web VCR recording metrics', [
		'elapsedMs', 'capturedFrames', 'droppedFrames', 'audioDropoutFrames',
		'currentAvDriftMs', 'maximumAbsoluteAvDriftMs',
	]);
	return Object.freeze({
		elapsedMs: nonNegativeFiniteNumber(candidate.elapsedMs, 'Web VCR elapsed milliseconds'),
		capturedFrames: nonNegativeSafeInteger(candidate.capturedFrames, 'Web VCR captured frames'),
		droppedFrames: nonNegativeSafeInteger(candidate.droppedFrames, 'Web VCR dropped frames'),
		audioDropoutFrames: nonNegativeSafeInteger(
			candidate.audioDropoutFrames, 'Web VCR audio dropout frames',
		),
		currentAvDriftMs: nullableFiniteNumber(candidate.currentAvDriftMs, 'Web VCR current A/V drift'),
		maximumAbsoluteAvDriftMs: candidate.maximumAbsoluteAvDriftMs === null
			? null
			: nonNegativeFiniteNumber(
				candidate.maximumAbsoluteAvDriftMs, 'Web VCR maximum absolute A/V drift',
			),
	});
}

export function normalizeWebVcrSnapshot(value: unknown): Readonly<WebVcrSnapshot> {
	const candidate = dataRecord(value, 'Web VCR snapshot');
	closedKeys(candidate, 'Web VCR snapshot', [
		'version', 'sessionId', 'generation', 'phase', 'capability', 'resolution', 'aspect', 'crop',
		'autoCrop', 'monitorMuted', 'autoStop', 'visible', 'navigation', 'target',
		'targetEndedRecordingToken', 'captureSurface',
		'outputSize', 'metrics', 'failure',
	]);
	if (candidate.version !== 1) throw new TypeError('Web VCR snapshot version is invalid.');
	return Object.freeze({
		version: 1,
		sessionId: candidate.sessionId === null
			? null
			: canonicalString(candidate.sessionId, 'Web VCR session ID', 256),
		generation: nonNegativeSafeInteger(candidate.generation, 'Web VCR snapshot generation'),
		phase: normalizeWebVcrLifecyclePhase(candidate.phase),
		capability: normalizeWebVcrCapability(candidate.capability),
		resolution: normalizeWebVcrResolution(candidate.resolution),
		aspect: normalizeWebVcrAspect(candidate.aspect),
		crop: normalizeWebVcrNormalizedCrop(candidate.crop),
		autoCrop: booleanValue(candidate.autoCrop, 'Web VCR autoCrop'),
		monitorMuted: booleanValue(candidate.monitorMuted, 'Web VCR monitorMuted'),
		autoStop: booleanValue(candidate.autoStop, 'Web VCR autoStop'),
		visible: booleanValue(candidate.visible, 'Web VCR visible'),
		navigation: normalizeWebVcrNavigationState(candidate.navigation),
		target: candidate.target === null ? null : normalizeWebVcrTargetSummary(candidate.target),
		targetEndedRecordingToken: nullableRecordingToken(candidate.targetEndedRecordingToken),
		captureSurface: normalizeWebVcrDimensions(candidate.captureSurface, 'Web VCR capture surface'),
		outputSize: candidate.outputSize === null
			? null
			: normalizeWebVcrDimensions(candidate.outputSize, 'Web VCR output size'),
		metrics: candidate.metrics === null ? null : normalizeWebVcrRecordingMetrics(candidate.metrics),
		failure: candidate.failure === null
			? null
			: canonicalString(candidate.failure, 'Web VCR failure', 1_024),
	});
}

export function normalizeWebVcrCommandV1(value: unknown): WebVcrCommandV1 {
	const candidate = dataRecord(value, 'Web VCR command');
	const base = normalizeCommandBase(candidate);
	switch (candidate.kind) {
		case 'navigate':
			closedCommand(candidate, ['url']);
			return Object.freeze({ ...base, kind: 'navigate', url: normalizeWebVcrUrl(candidate.url) });
		case 'go-back':
		case 'go-forward':
		case 'reload':
		case 'request-data-clear':
		case 'close-session':
			closedCommand(candidate, []);
			return Object.freeze({ ...base, kind: candidate.kind });
		case 'set-visibility':
			closedCommand(candidate, ['visible']);
			return Object.freeze({
				...base, kind: 'set-visibility', visible: booleanValue(candidate.visible, 'Web VCR visibility'),
			});
		case 'pointer-input':
			return normalizePointerCommand(candidate, base);
		case 'key-input':
			return normalizeKeyCommand(candidate, base);
		case 'set-resolution':
			closedCommand(candidate, ['resolution']);
			return Object.freeze({
				...base, kind: 'set-resolution', resolution: normalizeWebVcrResolution(candidate.resolution),
			});
		case 'set-auto-crop':
			closedCommand(candidate, ['enabled']);
			return Object.freeze({
				...base, kind: 'set-auto-crop', enabled: booleanValue(candidate.enabled, 'Web VCR auto crop'),
			});
		case 'set-crop':
			closedCommand(candidate, ['crop', 'aspect']);
			return Object.freeze({
				...base, kind: 'set-crop',
				crop: normalizeWebVcrNormalizedCrop(candidate.crop),
				aspect: normalizeWebVcrAspect(candidate.aspect),
			});
		case 'set-monitor-muted':
			closedCommand(candidate, ['muted']);
			return Object.freeze({
				...base, kind: 'set-monitor-muted',
				muted: booleanValue(candidate.muted, 'Web VCR monitor muted'),
			});
		case 'set-auto-stop':
			closedCommand(candidate, ['enabled']);
			return Object.freeze({
				...base, kind: 'set-auto-stop', enabled: booleanValue(candidate.enabled, 'Web VCR auto stop'),
			});
		case 'clear-browser-data':
			closedCommand(candidate, ['confirmationNonce']);
			return Object.freeze({
				...base, kind: 'clear-browser-data',
				confirmationNonce: canonicalString(
					candidate.confirmationNonce, 'Web VCR clear-data confirmation nonce', 256,
				),
			});
		default:
			throw new TypeError('Web VCR command kind is invalid.');
	}
}

function normalizePointerCommand(
	candidate: DataRecord,
	base: WebVcrCommandBaseV1,
): Extract<WebVcrCommandV1, { readonly kind: 'pointer-input' }> {
	closedCommand(candidate, ['action', 'x', 'y', 'button', 'deltaX', 'deltaY', 'modifiers']);
	const action = enumValue(candidate.action, ['move', 'down', 'up', 'wheel'] as const, 'Web VCR pointer action');
	const button = enumValue(
		candidate.button, ['none', 'left', 'middle', 'right'] as const, 'Web VCR pointer button',
	);
	const deltaX = boundedFiniteNumber(candidate.deltaX, 'Web VCR pointer deltaX', -10_000, 10_000);
	const deltaY = boundedFiniteNumber(candidate.deltaY, 'Web VCR pointer deltaY', -10_000, 10_000);
	if (action === 'wheel' && button !== 'none') {
		throw new RangeError('Wheel input must not carry a pointer button.');
	}
	if ((action === 'down' || action === 'up') && button === 'none') {
		throw new RangeError('Pointer down and up input require a pointer button.');
	}
	if (action !== 'wheel' && (deltaX !== 0 || deltaY !== 0)) {
		throw new RangeError('Only wheel input may carry pointer deltas.');
	}
	return Object.freeze({
		...base,
		kind: 'pointer-input',
		action,
		x: unitInterval(candidate.x, 'Web VCR pointer x'),
		y: unitInterval(candidate.y, 'Web VCR pointer y'),
		button,
		deltaX,
		deltaY,
		modifiers: normalizeInputModifiers(candidate.modifiers),
	});
}

function normalizeKeyCommand(
	candidate: DataRecord,
	base: WebVcrCommandBaseV1,
): Extract<WebVcrCommandV1, { readonly kind: 'key-input' }> {
	closedCommand(candidate, ['action', 'key', 'code', 'repeat', 'modifiers']);
	return Object.freeze({
		...base,
		kind: 'key-input',
		action: enumValue(candidate.action, ['down', 'up'] as const, 'Web VCR key action'),
		key: boundedInputString(candidate.key, 'Web VCR input key'),
		code: canonicalString(candidate.code, 'Web VCR input code', 64),
		repeat: booleanValue(candidate.repeat, 'Web VCR input repeat'),
		modifiers: normalizeInputModifiers(candidate.modifiers),
	});
}

function normalizeCommandBase(candidate: DataRecord): WebVcrCommandBaseV1 {
	if (candidate.version !== 1) throw new TypeError('Web VCR command version is invalid.');
	return Object.freeze({
		version: 1,
		sessionId: canonicalString(candidate.sessionId, 'Web VCR command session ID', 256),
		generation: nonNegativeSafeInteger(candidate.generation, 'Web VCR command generation'),
	});
}

function closedCommand(candidate: DataRecord, extraKeys: readonly string[]): void {
	closedKeys(candidate, 'Web VCR command', ['version', 'sessionId', 'generation', 'kind', ...extraKeys]);
}

function normalizeInputModifiers(value: unknown): readonly WebVcrInputModifier[] {
	const entries = denseArray(value, 'Web VCR input modifiers', WEB_VCR_INPUT_MODIFIERS.length);
	const seen = new Set<WebVcrInputModifier>();
	return Object.freeze(entries.map((entry): WebVcrInputModifier => {
		const modifier = enumValue(entry, WEB_VCR_INPUT_MODIFIERS, 'Web VCR input modifier');
		if (seen.has(modifier)) throw new RangeError(`Duplicate Web VCR input modifier ${modifier}.`);
		seen.add(modifier);
		return modifier;
	}));
}

function normalizeWebVcrUrl(value: unknown): string {
	const raw = canonicalString(value, 'Web VCR URL', 4_096);
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new TypeError('Web VCR URL must be an HTTPS URL or about:blank.');
	}
	if (url.href === 'about:blank') return url.href;
	if (url.protocol !== 'https:') throw new TypeError('Web VCR URL must be an HTTPS URL or about:blank.');
	if (url.username !== '' || url.password !== '') throw new TypeError('Web VCR URL must not contain credentials.');
	return url.href;
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype
			&& Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of Reflect.ownKeys(record)) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	return Object.freeze(result);
}

function closedKeys(value: DataRecord, name: string, keys: readonly string[]): void {
	const actualKeys = Object.keys(value);
	const allowed = new Set(keys);
	if (actualKeys.length !== keys.length
		|| actualKeys.some((key) => !allowed.has(key))
		|| keys.some((key) => !Object.hasOwn(value, key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
}

function denseArray(value: unknown, name: string, maximumLength: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a standard dense array.`);
	}
	if (value.length > maximumLength) throw new RangeError(`${name} exceeds its item limit.`);
	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) throw new TypeError(`${name} must be dense.`);
	}
	return value;
}

function enumValue<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	name: string,
): Values[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function canonicalString(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength
		|| value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}

function boundedInputString(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 64
		|| /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} must be a bounded non-control string.`);
	}
	return value;
}

function nullableRecordingToken(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) {
		throw new TypeError('Web VCR target-ended recording token is invalid.');
	}
	return value;
}

function booleanValue(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean.`);
	return value;
}

function unitInterval(value: unknown, name: string): number {
	return boundedFiniteNumber(value, name, 0, 1);
}

function positiveUnitInterval(value: unknown, name: string): number {
	const result = boundedFiniteNumber(value, name, 0, 1);
	if (result === 0) throw new RangeError(`${name} must be positive.`);
	return result;
}

function boundedFiniteNumber(value: unknown, name: string, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} must be a finite number from ${String(minimum)} through ${String(maximum)}.`);
	}
	return canonicalNumber(value);
}

function nonNegativeFiniteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative finite number.`);
	}
	return canonicalNumber(value);
}

function nullableFiniteNumber(value: unknown, name: string): number | null {
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new RangeError(`${name} must be a finite number or null.`);
	}
	return canonicalNumber(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function canonicalNumber(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
