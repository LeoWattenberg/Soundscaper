/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_WEB_VCR_DATA_CLEAR_NONCE_TTL_MS,
	validateWebVcrSessionReferenceV1,
	type WebVcrPhase,
	type WebVcrResolution,
	type WebVcrSessionReferenceV1,
} from './framescaper-web-vcr-contract.ts';
import {
	webVcrPopupAllowed,
} from './framescaper-web-vcr-security-policy.ts';

export const FRAMESCAPER_WEB_VCR_PARTITION = 'persist:framescaper-web-vcr-v1';

const HOST_PHASES = new Set<WebVcrPhase>([
	'ready', 'preparing', 'recording', 'finalizing', 'recovery', 'failed',
]);
const HOST_TRANSITIONS: Readonly<Record<string, readonly WebVcrPhase[]>> = Object.freeze({
	ready: Object.freeze<WebVcrPhase[]>(['preparing', 'failed']),
	preparing: Object.freeze<WebVcrPhase[]>(['recording', 'finalizing', 'recovery', 'failed']),
	recording: Object.freeze<WebVcrPhase[]>(['finalizing', 'recovery', 'failed']),
	finalizing: Object.freeze<WebVcrPhase[]>(['ready', 'recovery', 'failed']),
	recovery: Object.freeze<WebVcrPhase[]>(['ready', 'failed']),
	failed: Object.freeze<WebVcrPhase[]>([]),
});

export interface FramescaperWebVcrGuestWindowOptionsV1 {
	readonly show: false;
	readonly width: number;
	readonly height: number;
	readonly useContentSize: true;
	readonly webPreferences: Readonly<{
		readonly partition: typeof FRAMESCAPER_WEB_VCR_PARTITION;
		readonly sandbox: true;
		readonly contextIsolation: true;
		readonly nodeIntegration: false;
		readonly nodeIntegrationInSubFrames: false;
		readonly webSecurity: true;
		readonly allowRunningInsecureContent: false;
		readonly backgroundThrottling: false;
		readonly offscreen: Readonly<{ readonly deviceScaleFactor: 1 | 2 }>;
	}>;
}

export interface FramescaperWebVcrPopupWindowOptionsV1 {
	readonly show: true;
	readonly width: 520;
	readonly height: 640;
	readonly useContentSize: true;
	readonly webPreferences: Readonly<{
		readonly partition: typeof FRAMESCAPER_WEB_VCR_PARTITION;
		readonly sandbox: true;
		readonly contextIsolation: true;
		readonly nodeIntegration: false;
		readonly nodeIntegrationInSubFrames: false;
		readonly webSecurity: true;
		readonly allowRunningInsecureContent: false;
	}>;
}

export interface FramescaperWebVcrGuestContent {
	isDestroyed(): boolean;
	destroy(): void;
}

interface BrowserSession {
	clearAuthCache(): Promise<void>;
	clearCache(): Promise<void>;
	clearStorageData(): Promise<void>;
}

interface HostOptions {
	readonly now: () => number;
	readonly createOpaqueId: () => string;
	readonly browserSession: BrowserSession;
}

interface DataClearConfirmation {
	readonly nonce: string;
	readonly expiresAtMs: number;
}

interface HostSession {
	readonly sessionId: string;
	readonly generation: number;
	readonly primary: FramescaperWebVcrGuestContent;
	readonly popups: Set<FramescaperWebVcrGuestContent>;
	phase: WebVcrPhase;
	confirmation: DataClearConfirmation | null;
}

interface OwnerState {
	generation: number;
	session: HostSession | null;
}

export interface FramescaperWebVcrHostLifecycleV1 {
	open(owner: object, generation: number, primary: FramescaperWebVcrGuestContent): Readonly<WebVcrSessionReferenceV1>;
	setPhase(owner: object, reference: unknown, phase: WebVcrPhase): void;
	registerPopup(
		owner: object,
		reference: unknown,
		url: string,
		content: FramescaperWebVcrGuestContent,
	): boolean;
	closePanel(owner: object, reference: unknown): 'hidden' | 'destroyed';
	issueDataClearConfirmation(owner: object, reference: unknown): Readonly<DataClearConfirmation>;
	clearBrowserData(owner: object, reference: unknown, confirmationNonce: string): Promise<void>;
	revokeOwner(owner: object): boolean;
	dispose(): void;
}

export function createFramescaperWebVcrGuestWindowOptionsV1(
	resolution: WebVcrResolution,
): Readonly<FramescaperWebVcrGuestWindowOptionsV1> {
	const profile = resolution === '720p'
		? { width: 1280, height: 720, scale: 1 as const }
		: resolution === '1080p'
			? { width: 1920, height: 1080, scale: 1 as const }
			: resolution === '4k'
				? { width: 1920, height: 1080, scale: 2 as const }
				: null;
	if (!profile) throw new TypeError('Web VCR guest resolution is invalid.');
	const offscreen = Object.freeze({ deviceScaleFactor: profile.scale });
	const webPreferences = Object.freeze({
		partition: FRAMESCAPER_WEB_VCR_PARTITION,
		sandbox: true as const,
		contextIsolation: true as const,
		nodeIntegration: false as const,
		nodeIntegrationInSubFrames: false as const,
		webSecurity: true as const,
		allowRunningInsecureContent: false as const,
		backgroundThrottling: false as const,
		offscreen,
	});
	return Object.freeze({
		show: false,
		width: profile.width,
		height: profile.height,
		useContentSize: true,
		webPreferences,
	});
}

export function createFramescaperWebVcrPopupWindowOptionsV1(): Readonly<FramescaperWebVcrPopupWindowOptionsV1> {
	return Object.freeze({
		show: true,
		width: 520,
		height: 640,
		useContentSize: true,
		webPreferences: Object.freeze({
			partition: FRAMESCAPER_WEB_VCR_PARTITION,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			nodeIntegrationInSubFrames: false,
			webSecurity: true,
			allowRunningInsecureContent: false,
		}),
	});
}

/** Owns guest references and enforces destructive lifecycle ordering without importing Electron. */
export function createFramescaperWebVcrHostLifecycleV1(
	value: HostOptions,
): Readonly<FramescaperWebVcrHostLifecycleV1> {
	const options = validateOptions(value);
	const owners = new Map<object, OwnerState>();
	let disposed = false;

	function open(
		ownerValue: object,
		generationValue: number,
		primaryValue: FramescaperWebVcrGuestContent,
	): Readonly<WebVcrSessionReferenceV1> {
		assertOperational();
		const owner = reference(ownerValue, 'host owner');
		const generation = positiveGeneration(generationValue);
		const primary = guestContent(primaryValue);
		const state = ownerState(owner);
		if (generation <= state.generation) throw new Error('Web VCR host open requires a newer generation.');
		if (state.session) destroySession(state.session);
		const session: HostSession = {
			sessionId: opaqueId(options.createOpaqueId()),
			generation,
			primary,
			popups: new Set(),
			phase: 'ready',
			confirmation: null,
		};
		state.generation = generation;
		state.session = session;
		return Object.freeze({ version: 1, sessionId: session.sessionId, generation });
	}

	function setPhase(
		ownerValue: object,
		referenceValue: unknown,
		phaseValue: WebVcrPhase,
	): void {
		assertOperational();
		if (!HOST_PHASES.has(phaseValue)) throw new TypeError('Web VCR host phase is invalid.');
		const session = ownedSession(ownerValue, referenceValue);
		if (!HOST_TRANSITIONS[session.phase]?.includes(phaseValue)) {
			throw new Error('Web VCR host phase transition is invalid.');
		}
		session.phase = phaseValue;
		if (phaseValue !== 'ready') session.confirmation = null;
	}

	function registerPopup(
		ownerValue: object,
		referenceValue: unknown,
		url: string,
		contentValue: FramescaperWebVcrGuestContent,
	): boolean {
		if (disposed) return false;
		let session: HostSession;
		try {
			session = ownedSession(ownerValue, referenceValue);
		} catch {
			return false;
		}
		if (!webVcrPopupAllowed({
			url,
			phase: session.phase,
			openPopupCount: livePopups(session).length,
		})) return false;
		const content = guestContent(contentValue);
		session.popups.add(content);
		return true;
	}

	function closePanel(ownerValue: object, referenceValue: unknown): 'hidden' | 'destroyed' {
		assertOperational();
		const owner = reference(ownerValue, 'host owner');
		const session = ownedSession(owner, referenceValue);
		if (session.phase === 'preparing' || session.phase === 'recording'
			|| session.phase === 'finalizing' || session.phase === 'recovery') return 'hidden';
		destroySession(session);
		owners.get(owner)!.session = null;
		return 'destroyed';
	}

	function issueDataClearConfirmation(
		ownerValue: object,
		referenceValue: unknown,
	): Readonly<DataClearConfirmation> {
		assertOperational();
		const session = ownedSession(ownerValue, referenceValue);
		if (session.phase !== 'ready') throw new Error('Web VCR browser data can be cleared only while idle.');
		const confirmation = Object.freeze({
			nonce: opaqueId(options.createOpaqueId()),
			expiresAtMs: expiry(options.now(), FRAMESCAPER_WEB_VCR_DATA_CLEAR_NONCE_TTL_MS),
		});
		session.confirmation = confirmation;
		return confirmation;
	}

	function clearBrowserData(
		ownerValue: object,
		referenceValue: unknown,
		confirmationNonceValue: string,
	): Promise<void> {
		assertOperational();
		const owner = reference(ownerValue, 'host owner');
		const session = ownedSession(owner, referenceValue);
		if (session.phase !== 'ready') throw new Error('Web VCR browser data can be cleared only while idle.');
		const confirmation = session.confirmation;
		session.confirmation = null;
		if (!confirmation || opaqueId(confirmationNonceValue) !== confirmation.nonce) {
			throw new Error('Web VCR browser data clear confirmation is invalid or consumed.');
		}
		if (options.now() >= confirmation.expiresAtMs) {
			throw new Error('Web VCR browser data clear confirmation expired.');
		}
		destroySession(session);
		owners.get(owner)!.session = null;
		return clearEveryBrowserDataClass(options.browserSession);
	}

	return Object.freeze({
		open,
		setPhase,
		registerPopup,
		closePanel,
		issueDataClearConfirmation,
		clearBrowserData,
		revokeOwner(ownerValue: object): boolean {
			if (disposed) return false;
			const owner = optionalReference(ownerValue);
			if (!owner) return false;
			const state = owners.get(owner);
			if (!state) return false;
			if (state.session) destroySession(state.session);
			owners.delete(owner);
			return true;
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			for (const state of owners.values()) if (state.session) destroySession(state.session);
			owners.clear();
		},
	});

	function assertOperational(): void {
		if (disposed) throw new Error('Web VCR host lifecycle is disposed.');
	}

	function ownerState(owner: object): OwnerState {
		let state = owners.get(owner);
		if (!state) {
			state = { generation: 0, session: null };
			owners.set(owner, state);
		}
		return state;
	}

	function ownedSession(ownerValue: object, referenceValue: unknown): HostSession {
		const owner = reference(ownerValue, 'host owner');
		const requested = validateWebVcrSessionReferenceV1(referenceValue);
		const session = owners.get(owner)?.session;
		if (!session || session.sessionId !== requested.sessionId
			|| session.generation !== requested.generation) {
			throw new Error('Web VCR host owner or session generation is stale.');
		}
		return session;
	}
}

function livePopups(session: HostSession): FramescaperWebVcrGuestContent[] {
	const result: FramescaperWebVcrGuestContent[] = [];
	for (const popup of session.popups) {
		if (popup.isDestroyed()) session.popups.delete(popup);
		else result.push(popup);
	}
	return result;
}

function destroySession(session: HostSession): void {
	for (const popup of session.popups) destroyContent(popup);
	session.popups.clear();
	destroyContent(session.primary);
	session.confirmation = null;
}

function destroyContent(content: FramescaperWebVcrGuestContent): void {
	if (!content.isDestroyed()) content.destroy();
}

function validateOptions(value: HostOptions): HostOptions {
	if (!value || typeof value !== 'object' || typeof value.now !== 'function'
		|| typeof value.createOpaqueId !== 'function' || !value.browserSession
		|| typeof value.browserSession.clearAuthCache !== 'function'
		|| typeof value.browserSession.clearCache !== 'function'
		|| typeof value.browserSession.clearStorageData !== 'function') {
		throw new TypeError('Web VCR host lifecycle seams are invalid.');
	}
	return value;
}

async function clearEveryBrowserDataClass(session: BrowserSession): Promise<void> {
	const results = await Promise.allSettled([
		session.clearAuthCache(), session.clearCache(), session.clearStorageData(),
	]);
	const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, 'Web VCR browser data clearing failed.');
}

function guestContent(value: FramescaperWebVcrGuestContent): FramescaperWebVcrGuestContent {
	if (!value || typeof value !== 'object' || typeof value.isDestroyed !== 'function'
		|| typeof value.destroy !== 'function') {
		throw new TypeError('Web VCR guest content seam is invalid.');
	}
	return value;
}

function positiveGeneration(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError('Web VCR host generation must be a positive safe integer.');
	}
	return Number(value);
}

function expiry(nowMs: number, ttlMs: number): number {
	if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > Number.MAX_SAFE_INTEGER - ttlMs) {
		throw new RangeError('Web VCR host clock is invalid.');
	}
	return nowMs + ttlMs;
}

function reference(value: unknown, label: string): object {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError(`Web VCR ${label} must be a reference.`);
	}
	return value;
}

function optionalReference(value: unknown): object | null {
	return value && (typeof value === 'object' || typeof value === 'function') ? value : null;
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{32}$/u.test(value)) {
		throw new TypeError('Web VCR opaque identity is invalid.');
	}
	return value;
}
