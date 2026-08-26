/* SPDX-License-Identifier: AGPL-3.0-only */

/** Expiring, cancellable Assistance search with deterministic stale-result suppression. */

export const ASSISTANCE_SEMANTIC_SEARCH_SESSION_VERSION = 1 as const;
export const ASSISTANCE_ASYNC_SEARCH_RESULT_LIMIT = 50;

export const ASSISTANCE_SEMANTIC_SEARCH_MAXIMUM_SESSION_LIFETIME_MS = 60 * 60 * 1_000;
const SESSION_ID = /^[a-f\d]{40}$/u;
const STABLE_ID = /^[A-Za-z\d][A-Za-z\d._:-]{0,255}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const PROVIDERS = Object.freeze(['transcript', 'visual', 'ocr'] as const);
const SESSION_FIELDS = Object.freeze([
	'sessionVersion', 'sessionId', 'projectId', 'projectRevision', 'expiresAtEpochMs',
]);
const RESULT_FIELDS = Object.freeze([
	'resultId', 'timelineFrame', 'label', 'detail', 'providers',
]);

export type AssistanceAsyncSearchProviderKind = typeof PROVIDERS[number];

export interface AssistanceSemanticSearchSession {
	readonly sessionVersion: typeof ASSISTANCE_SEMANTIC_SEARCH_SESSION_VERSION;
	readonly sessionId: string;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly expiresAtEpochMs: number;
}

export interface AssistanceAsyncSearchRequest {
	readonly session: AssistanceSemanticSearchSession;
	readonly query: string;
	readonly maximumResults: typeof ASSISTANCE_ASYNC_SEARCH_RESULT_LIMIT;
	readonly signal: AbortSignal;
}

export interface AssistanceAsyncSearchProvider {
	search(request: AssistanceAsyncSearchRequest): Promise<unknown>;
}

export interface AssistanceAsyncSearchEntry {
	readonly kind: 'assistance';
	readonly key: string;
	readonly label: string;
	readonly detail: string | null;
	readonly disabled: false;
	readonly disabledReason: null;
	readonly state: 'enabled';
	readonly reason: null;
	readonly handler: null;
	readonly sourceOrder: number;
	readonly target: Readonly<{ readonly resultId: string; readonly timelineFrame: number }>;
	readonly providers: readonly AssistanceAsyncSearchProviderKind[];
}

export type AssistanceAsyncSearchSnapshot = Readonly<{
	disposition: 'accepted' | 'stale';
	revision: number;
	entries: readonly AssistanceAsyncSearchEntry[];
}>;

export interface AssistanceAsyncSearchCoordinator {
	search(query: string): Promise<AssistanceAsyncSearchSnapshot>;
	cancel(): void;
	dispose(): void;
}

export function validateAssistanceSemanticSearchSession(
	value: unknown,
	nowValue = Date.now(),
): AssistanceSemanticSearchSession {
	const now = epoch(nowValue, 'semantic-search current time');
	const row = exactRecord(value, SESSION_FIELDS, 'semantic-search session');
	if (row.sessionVersion !== ASSISTANCE_SEMANTIC_SEARCH_SESSION_VERSION
		|| typeof row.sessionId !== 'string' || !SESSION_ID.test(row.sessionId)) {
		throw new TypeError('The semantic-search session identity or version is invalid.');
	}
	const projectId = stableId(row.projectId, 'semantic-search project ID');
	const projectRevision = integer(row.projectRevision, 0, Number.MAX_SAFE_INTEGER,
		'semantic-search project revision');
	const expiresAtEpochMs = epoch(row.expiresAtEpochMs, 'semantic-search expiry');
	if (expiresAtEpochMs <= now) throw new RangeError('The semantic-search session has expired.');
	if (expiresAtEpochMs - now > ASSISTANCE_SEMANTIC_SEARCH_MAXIMUM_SESSION_LIFETIME_MS) {
		throw new RangeError('The semantic-search session exceeds its short-lived bound.');
	}
	return Object.freeze({ sessionVersion: ASSISTANCE_SEMANTIC_SEARCH_SESSION_VERSION,
		sessionId: row.sessionId, projectId, projectRevision, expiresAtEpochMs });
}

export function createAssistanceAsyncSearchCoordinator(options: Readonly<{
	readonly session: AssistanceSemanticSearchSession;
	readonly provider: AssistanceAsyncSearchProvider;
	readonly now?: () => number;
}>): AssistanceAsyncSearchCoordinator {
	if (!options || typeof options !== 'object' || !options.provider
		|| typeof options.provider.search !== 'function'
		|| (options.now !== undefined && typeof options.now !== 'function')) {
		throw new TypeError('An async Assistance search coordinator needs its exact provider ports.');
	}
	const now = options.now ?? Date.now;
	let session = validateAssistanceSemanticSearchSession(options.session, now());
	let revision = 0;
	let controller: AbortController | null = null;
	let disposed = false;

	const cancel = (): void => {
		revision += 1;
		controller?.abort(new DOMException('Assistance search was superseded.', 'AbortError'));
		controller = null;
	};

	const search = async (queryValue: string): Promise<AssistanceAsyncSearchSnapshot> => {
		if (disposed) throw new Error('The async Assistance search coordinator is disposed.');
		controller?.abort(new DOMException('Assistance search was superseded.', 'AbortError'));
		controller = new AbortController();
		const ownedController = controller;
		const ownedRevision = revision + 1;
		revision = ownedRevision;
		session = validateAssistanceSemanticSearchSession(session, now());
		const query = boundedText(queryValue, 512, 'semantic-search query');
		let output: unknown;
		try {
			output = await options.provider.search(Object.freeze({
				session, query, maximumResults: ASSISTANCE_ASYNC_SEARCH_RESULT_LIMIT,
				signal: ownedController.signal,
			}));
		} catch (error) {
			if (ownedRevision !== revision || ownedController.signal.aborted || disposed) {
				return stale(ownedRevision);
			}
			throw error;
		}
		if (ownedRevision !== revision || ownedController.signal.aborted || disposed) {
			return stale(ownedRevision);
		}
		controller = null;
		return Object.freeze({ disposition: 'accepted', revision: ownedRevision,
			entries: normalizeEntries(output) });
	};

	return Object.freeze({ search, cancel, dispose(): void {
		if (disposed) return;
		disposed = true;
		cancel();
	} });
}

function normalizeEntries(value: unknown): readonly AssistanceAsyncSearchEntry[] {
	if (!Array.isArray(value) || value.length > ASSISTANCE_ASYNC_SEARCH_RESULT_LIMIT) {
		throw new RangeError('The async Assistance search result inventory exceeds its bound.');
	}
	const seen = new Set<string>();
	return Object.freeze(value.map((candidate, index): AssistanceAsyncSearchEntry => {
		const label = `async Assistance search result ${String(index)}`;
		const row = exactRecord(candidate, RESULT_FIELDS, label);
		const resultId = stableId(row.resultId, `${label} ID`);
		if (seen.has(resultId)) throw new TypeError('Async Assistance search repeats a result identity.');
		seen.add(resultId);
		const timelineFrame = integer(row.timelineFrame, 0, Number.MAX_SAFE_INTEGER,
			`${label} timeline frame`);
		const providers = providerList(row.providers, label);
		return Object.freeze({
			kind: 'assistance', key: `assistance:${resultId}`,
			label: boundedText(row.label, 4_096, `${label} label`),
			detail: row.detail === null ? null : boundedText(row.detail, 4_096, `${label} detail`),
			disabled: false, disabledReason: null, state: 'enabled', reason: null,
			handler: null, sourceOrder: index,
			target: Object.freeze({ resultId, timelineFrame }), providers,
		});
	}));
}

function providerList(value: unknown, label: string): readonly AssistanceAsyncSearchProviderKind[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > PROVIDERS.length) {
		throw new RangeError(`The ${label} provider inventory is invalid.`);
	}
	let prior = -1;
	const providers = value.map((candidate) => {
		const index = PROVIDERS.indexOf(candidate as AssistanceAsyncSearchProviderKind);
		if (index <= prior) throw new TypeError(`The ${label} providers must be canonical and unique.`);
		prior = index;
		return PROVIDERS[index]!;
	});
	return Object.freeze(providers);
}

function stale(revision: number): AssistanceAsyncSearchSnapshot {
	return Object.freeze({ disposition: 'stale', revision, entries: Object.freeze([]) });
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const row = value as Readonly<Record<string, unknown>>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`The ${label} fields are invalid.`);
	}
	return row;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !STABLE_ID.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function boundedText(value: unknown, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximum
		|| CONTROL.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}

function epoch(value: unknown, label: string): number {
	return integer(value, 0, 8_640_000_000_000_000, label);
}
