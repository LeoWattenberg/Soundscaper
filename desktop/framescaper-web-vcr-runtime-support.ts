/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	WebVcrCaptureStateRequestV1,
	WebVcrCapability,
	WebVcrCapabilityReason,
	WebVcrDispatchResultV1,
	WebVcrHostCaptureState,
	WebVcrNormalizedCrop,
	WebVcrResolution,
	WebVcrSessionReferenceV1,
	WebVcrSnapshot,
	WebVcrTargetSummary,
} from './framescaper-web-vcr-contract.ts';
import type {
	FramescaperWebVcrElectronWindow,
	FramescaperWebVcrRuntimeBrowserSession,
} from './framescaper-web-vcr-electron-window.ts';
import type {
	FramescaperWebVcrTargetObserverV1,
	createFramescaperWebVcrTargetObserverV1,
} from './framescaper-web-vcr-target-observer.ts';

export interface FramescaperWebVcrRuntimeOptionsV1 {
	readonly productId: string;
	readonly qualified: boolean;
	readonly unavailableReason?: WebVcrCapabilityReason;
	readonly now: () => number;
	readonly createOpaqueId: () => string;
	readonly createWindow: (value: unknown) => FramescaperWebVcrElectronWindow;
	readonly browserSession: FramescaperWebVcrRuntimeBrowserSession;
	readonly createTargetObserver?: typeof createFramescaperWebVcrTargetObserverV1;
	readonly emitSnapshot: (owner: object, snapshot: Readonly<WebVcrSnapshot>) => void;
}

export interface FramescaperWebVcrRuntimeSessionV1 {
	readonly owner: object;
	readonly reference: Readonly<WebVcrSessionReferenceV1>;
	readonly window: FramescaperWebVcrElectronWindow;
	readonly observer: FramescaperWebVcrTargetObserverV1;
	readonly popups: Set<FramescaperWebVcrElectronWindow>;
	resolution: WebVcrResolution;
	captureState: WebVcrHostCaptureState | 'failed';
	visible: boolean;
	aspect: WebVcrSnapshot['aspect'];
	crop: Readonly<WebVcrNormalizedCrop>;
	autoCrop: boolean;
	monitorMuted: boolean;
	autoStop: boolean;
	activeRecordingToken: string | null;
	targetEndedRecordingToken: string | null;
	captureTransitionPending: boolean;
	captureTransitionInvalidated: boolean;
	navigation: WebVcrSnapshot['navigation'];
	target: Readonly<WebVcrTargetSummary> | null;
	failure: string | null;
}

const TRANSITIONS: Readonly<Record<WebVcrHostCaptureState, readonly WebVcrHostCaptureState[]>> = Object.freeze({
	ready: Object.freeze<WebVcrHostCaptureState[]>(['preparing']),
	preparing: Object.freeze<WebVcrHostCaptureState[]>(['recording', 'finalizing', 'recovery']),
	recording: Object.freeze<WebVcrHostCaptureState[]>(['finalizing', 'recovery']),
	finalizing: Object.freeze<WebVcrHostCaptureState[]>(['ready', 'recovery']),
	recovery: Object.freeze<WebVcrHostCaptureState[]>(['ready']),
});

export function webVcrCaptureStateTransitionAllowed(
	current: FramescaperWebVcrRuntimeSessionV1['captureState'],
	next: WebVcrCaptureStateRequestV1['state'],
): boolean {
	return current !== 'failed' && TRANSITIONS[current].includes(next);
}

export function framescaperWebVcrSnapshotResult(
	snapshot: Readonly<WebVcrSnapshot>,
): Readonly<WebVcrDispatchResultV1> {
	return Object.freeze({ version: 1, kind: 'snapshot', snapshot });
}

export function liveFramescaperWebVcrPopupCount(state: FramescaperWebVcrRuntimeSessionV1): number {
	let count = 0;
	for (const popup of state.popups) {
		if (popup.isDestroyed()) state.popups.delete(popup);
		else count += 1;
	}
	return count;
}

export function validateFramescaperWebVcrRuntimeOptionsV1(
	value: FramescaperWebVcrRuntimeOptionsV1,
): FramescaperWebVcrRuntimeOptionsV1 {
	if (!value || typeof value !== 'object' || typeof value.productId !== 'string'
		|| typeof value.qualified !== 'boolean' || typeof value.now !== 'function'
		|| (value.unavailableReason !== undefined && typeof value.unavailableReason !== 'string')
		|| typeof value.createOpaqueId !== 'function' || typeof value.createWindow !== 'function'
		|| !value.browserSession || typeof value.browserSession.clearAuthCache !== 'function'
		|| typeof value.browserSession.clearCache !== 'function'
		|| typeof value.browserSession.clearStorageData !== 'function'
		|| (value.createTargetObserver !== undefined && typeof value.createTargetObserver !== 'function')
		|| typeof value.emitSnapshot !== 'function') {
		throw new TypeError('Web VCR runtime seams are invalid.');
	}
	return value;
}

export function framescaperWebVcrReference(value: unknown, label: string): object {
	if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
		throw new TypeError(`Web VCR ${label} must be a reference.`);
	}
	return value;
}

export function assertFramescaperWebVcrBrowserMutationIdle(
	state: FramescaperWebVcrRuntimeSessionV1,
): void {
	if (state.captureState !== 'ready' || state.captureTransitionPending) {
		throw new Error('Web VCR browser mutation is locked during capture.');
	}
}

export function assertFramescaperWebVcrCaptureReady(
	state: FramescaperWebVcrRuntimeSessionV1,
): void {
	if (state.captureState !== 'ready' || state.captureTransitionPending || state.navigation.isLoading
		|| !state.visible || state.window.isDestroyed()) {
		throw new Error('Web VCR guest is not idle, settled, and visible for capture.');
	}
}

export function assertFramescaperWebVcrResolutionAvailable(
	capability: Readonly<WebVcrCapability>,
	resolution: WebVcrResolution,
): void {
	if (capability.status !== 'available' || resolution === '4k'
		|| !capability.resolutions.includes(resolution)) {
		throw new Error('Web VCR resolution is unavailable or unqualified.');
	}
}

export function framescaperWebVcrCaptureIsActive(
	phase: FramescaperWebVcrRuntimeSessionV1['captureState'],
): boolean {
	return phase === 'preparing' || phase === 'recording'
		|| phase === 'finalizing' || phase === 'recovery';
}

export function framescaperWebVcrCaptureSetupLocked(
	state: FramescaperWebVcrRuntimeSessionV1,
): boolean {
	return state.captureTransitionPending || state.captureState === 'preparing'
		|| state.captureState === 'recording' || state.captureState === 'finalizing';
}

export interface FramescaperWebVcrStartedNavigationV1 {
	readonly url: string;
	readonly isMainFrame: boolean;
	readonly isSameDocument: boolean;
}

export function framescaperWebVcrStartedNavigation(
	args: readonly unknown[],
): Readonly<FramescaperWebVcrStartedNavigationV1> | null {
	const details = [...args].reverse().find((entry) => entry && typeof entry === 'object'
		&& Object.hasOwn(entry, 'url')) as
		| Readonly<{ url?: unknown; isMainFrame?: unknown; isSameDocument?: unknown }> | undefined;
	const url = details?.url ?? args[1];
	if (typeof url !== 'string') return null;
	return Object.freeze({
		url,
		isMainFrame: (details?.isMainFrame ?? args[3]) !== false,
		isSameDocument: (details?.isSameDocument ?? args[2]) === true,
	});
}

export function framescaperWebVcrPreventableNavigation(args: readonly unknown[]): Readonly<{
	readonly url: string;
	prevent(): void;
}> | null {
	const navigation = framescaperWebVcrStartedNavigation(args);
	if (!navigation || !navigation.isMainFrame || navigation.isSameDocument) return null;
	const event = args[0] as Readonly<{ preventDefault?: () => void }> | undefined;
	return Object.freeze({
		url: navigation.url,
		prevent: () => { event?.preventDefault?.(); },
	});
}

export function framescaperWebVcrCommittedNavigation(
	args: readonly unknown[],
	sameDocument: boolean,
): string | null {
	if (sameDocument && args[2] !== true) return null;
	const url = args[1] ?? args.find((entry) => typeof entry === 'string');
	return typeof url === 'string' ? url : null;
}

export function framescaperWebVcrNavigationState(
	state: FramescaperWebVcrRuntimeSessionV1,
	change: Partial<WebVcrSnapshot['navigation']>,
): WebVcrSnapshot['navigation'] {
	return Object.freeze({
		...state.navigation,
		...change,
		canGoBack: state.window.webContents.navigationHistory.canGoBack(),
		canGoForward: state.window.webContents.navigationHistory.canGoForward(),
	});
}

export function markFramescaperWebVcrNavigationPending(
	state: FramescaperWebVcrRuntimeSessionV1,
): void {
	state.navigation = framescaperWebVcrNavigationState(state, {
		generation: state.navigation.generation + 1,
		isLoading: true,
	});
	state.target = null;
}

export function beginFramescaperWebVcrHistoryNavigation(
	state: FramescaperWebVcrRuntimeSessionV1,
	direction: 'back' | 'forward',
): void {
	const history = state.window.webContents.navigationHistory;
	const available = direction === 'back' ? history.canGoBack() : history.canGoForward();
	if (!available) throw new Error(`Web VCR history has no ${direction === 'back' ? 'previous' : 'next'} page.`);
	markFramescaperWebVcrNavigationPending(state);
	if (direction === 'back') history.goBack();
	else history.goForward();
}
