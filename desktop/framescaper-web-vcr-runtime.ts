/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_WEB_VCR_CAPTURE_GRANT_TTL_MS,
	validateWebVcrCaptureStateRequestV1,
	validateWebVcrCommandV1,
	validateWebVcrOpenRequestV1,
	validateWebVcrSessionReferenceV1,
	type WebVcrCaptureGrantV1,
	type WebVcrCaptureStateRequestV1,
	type WebVcrDispatchResultV1,
	type WebVcrHandshakeV1,
	type WebVcrResolution,
	type WebVcrSnapshot,
} from './framescaper-web-vcr-contract.ts';
import {
	createFramescaperWebVcrCaptureAuthorityV1,
	type FramescaperWebVcrCaptureAuthorityV1,
} from './framescaper-web-vcr-capture-authority.ts';
import {
	framescaperWebVcrCssViewport,
	framescaperWebVcrInputEvents,
	type FramescaperWebVcrElectronWindow,
} from './framescaper-web-vcr-electron-window.ts';
export type {
	FramescaperWebVcrElectronWindow,
} from './framescaper-web-vcr-electron-window.ts';
import {
	createFramescaperWebVcrGuestWindowOptionsV1,
	createFramescaperWebVcrHostLifecycleV1,
	createFramescaperWebVcrPopupWindowOptionsV1,
} from './framescaper-web-vcr-host.ts';
import {
	admitFramescaperWebVcrUrl,
	webVcrPopupAllowed,
} from './framescaper-web-vcr-security-policy.ts';
import {
	createClosedFramescaperWebVcrSnapshotV1,
	createFramescaperWebVcrSnapshotV1,
} from './framescaper-web-vcr-runtime-snapshot.ts';
import {
	applyFramescaperWebVcrTargetObservationV1,
	enterFramescaperWebVcrRecoveryV1,
	transitionFramescaperWebVcrCaptureStateV1,
} from './framescaper-web-vcr-runtime-capture-state.ts';
import {
	assertFramescaperWebVcrBrowserMutationIdle as assertBrowserMutationIdle,
	assertFramescaperWebVcrCaptureReady as assertCaptureReady,
	assertFramescaperWebVcrResolutionAvailable as assertResolutionAvailable,
	beginFramescaperWebVcrHistoryNavigation as navigateHistory,
	framescaperWebVcrCommittedNavigation as committedNavigation,
	framescaperWebVcrCaptureIsActive as captureIsActive,
	framescaperWebVcrCaptureSetupLocked as captureSetupLocked,
	framescaperWebVcrFailedLoadDisposition as failedLoadDisposition,
	framescaperWebVcrNavigationState as navigationState,
	framescaperWebVcrPreventableNavigation as preventableNavigation,
	framescaperWebVcrReference as reference,
	framescaperWebVcrSnapshotResult as snapshotResult,
	framescaperWebVcrStartedNavigation as startedNavigation,
	liveFramescaperWebVcrPopupCount as livePopupCount,
	markFramescaperWebVcrNavigationPending as markNavigationPending,
	loadFramescaperWebVcrNavigation,
	validateFramescaperWebVcrRuntimeOptionsV1 as runtimeOptions,
	type FramescaperWebVcrRuntimeOptionsV1 as RuntimeOptions,
	type FramescaperWebVcrRuntimeSessionV1 as RuntimeSession,
} from './framescaper-web-vcr-runtime-support.ts';
import {
	createFramescaperWebVcrTargetObserverV1,
	type FramescaperWebVcrResolvedTargetObservationV1,
} from './framescaper-web-vcr-target-observer.ts';

type EventListener = (...args: unknown[]) => void;

export interface FramescaperWebVcrRuntimeV1 {
	readonly captureAuthority: Readonly<FramescaperWebVcrCaptureAuthorityV1>;
	handshake(): Readonly<WebVcrHandshakeV1>;
	open(owner: object, request: unknown): Promise<Readonly<WebVcrSnapshot>>;
	dispatch(owner: object, command: unknown): Promise<Readonly<WebVcrDispatchResultV1>>;
	prepareCapture(owner: object, reference: unknown): Readonly<WebVcrCaptureGrantV1>;
	setCaptureState(owner: object, request: unknown): Promise<boolean>;
	disposeSession(owner: object, reference: unknown): boolean;
	revokeOwner(owner: object): boolean;
	dispose(): void;
}

export function createFramescaperWebVcrRuntimeV1(
	value: RuntimeOptions,
): Readonly<FramescaperWebVcrRuntimeV1> {
	const options = runtimeOptions(value);
	const capability = Object.freeze(options.productId !== 'framescaper'
		? { status: 'unavailable' as const, reason: 'wrong-product' as const, detail: null }
		: !options.enabled
			? { status: 'unavailable' as const, reason: options.unavailableReason ?? 'roadmap-gate', detail: null }
			: { status: 'available' as const, resolutions: Object.freeze(['720p', '1080p'] as const) });
	const host = createFramescaperWebVcrHostLifecycleV1({
		now: options.now,
		createOpaqueId: options.createOpaqueId,
		browserSession: options.browserSession,
	});
	const captureAuthority = createFramescaperWebVcrCaptureAuthorityV1({
		now: options.now,
		createOpaqueId: options.createOpaqueId,
	});
	let current: RuntimeSession | null = null;
	let generation = 0;
	let disposed = false;

	function handshake(): Readonly<WebVcrHandshakeV1> {
		return Object.freeze({
			version: 1,
			capability,
			captureGrantTtlMs: FRAMESCAPER_WEB_VCR_CAPTURE_GRANT_TTL_MS,
		});
	}

	async function open(ownerValue: object, requestValue: unknown): Promise<Readonly<WebVcrSnapshot>> {
		assertOperational();
		const owner = reference(ownerValue, 'runtime owner');
		const request = validateWebVcrOpenRequestV1(requestValue);
		assertResolutionAvailable(capability, request.resolution);
		if (current) {
			if (current.owner !== owner) revokeCurrent();
			else if (current.captureState === 'failed' || current.window.isDestroyed()) {
				revokeCurrent();
				return createSession(owner, request.resolution, 'about:blank');
			}
			else if (current.captureTransitionPending) throw new Error('Web VCR capture setup is pending.');
			else if (!current.window.isDestroyed()) {
				if (current.resolution !== request.resolution) {
					if (current.captureState !== 'ready') throw new Error('Web VCR resolution is locked during capture.');
					const url = current.navigation.url;
					revokeCurrent();
					return createSession(owner, request.resolution, url);
				}
				current.visible = true;
				return snapshot(current);
			}
		}
		return createSession(owner, request.resolution, 'about:blank');
	}

	async function dispatch(
		ownerValue: object,
		commandValue: unknown,
	): Promise<Readonly<WebVcrDispatchResultV1>> {
		assertOperational();
		const command = validateWebVcrCommandV1(commandValue);
		const state = ownedSession(ownerValue, command);
		switch (command.kind) {
			case 'navigate':
				assertBrowserMutationIdle(state);
				await navigate(state, command.url);
				break;
			case 'go-back':
				assertBrowserMutationIdle(state);
				navigateHistory(state, 'back');
				break;
			case 'go-forward':
				assertBrowserMutationIdle(state);
				navigateHistory(state, 'forward');
				break;
			case 'reload':
				assertBrowserMutationIdle(state);
				markNavigationPending(state);
				state.window.webContents.reload();
				break;
			case 'set-visibility':
				state.visible = command.visible;
				if (!command.visible) return closePanel(state);
				break;
			case 'pointer-input':
			case 'key-input':
				assertBrowserMutationIdle(state);
				for (const event of framescaperWebVcrInputEvents(command, state.resolution)) state.window.webContents.sendInputEvent(event);
				break;
			case 'set-resolution':
				assertBrowserMutationIdle(state);
				assertResolutionAvailable(capability, command.resolution);
				if (command.resolution !== state.resolution) {
					const url = state.navigation.url;
					const owner = state.owner;
					revokeCurrent();
					const replacement = await createSession(owner, command.resolution, url);
					return snapshotResult(replacement);
				}
				break;
			case 'set-auto-crop':
				assertBrowserMutationIdle(state);
				state.autoCrop = command.enabled;
				break;
			case 'set-crop':
				assertBrowserMutationIdle(state);
				state.crop = command.crop;
				state.aspect = command.aspect;
				break;
			case 'set-monitor-muted': state.monitorMuted = command.muted; break;
			case 'set-auto-stop':
				assertBrowserMutationIdle(state);
				state.autoStop = command.enabled;
				break;
			case 'request-data-clear': {
				assertBrowserMutationIdle(state);
				const confirmation = host.issueDataClearConfirmation(state.owner, state.reference);
				return Object.freeze({
					kind: 'data-clear-confirmation',
					...state.reference,
					nonce: confirmation.nonce,
					expiresAtMs: confirmation.expiresAtMs,
				});
			}
			case 'clear-browser-data':
				assertBrowserMutationIdle(state);
				const clearedOwner = state.owner;
				const clearedResolution = state.resolution;
				const clearing = host.clearBrowserData(
					state.owner, state.reference, command.confirmationNonce,
				);
				state.observer.dispose();
				captureAuthority.revokeOwner(state.owner);
				current = null;
				try {
					await clearing;
				} catch (error) {
					if (!disposed) options.emitSnapshot(clearedOwner, closedSnapshot(clearedResolution, state.reference.generation));
					throw error;
				}
				return snapshotResult(await createSession(clearedOwner, clearedResolution, 'about:blank'));
			case 'close-session': return closePanel(state);
		}
		const next = snapshot(state);
		emit(state, next);
		return snapshotResult(next);
	}

	function prepareCapture(ownerValue: object, referenceValue: unknown): Readonly<WebVcrCaptureGrantV1> {
		assertOperational();
		const state = ownedSession(ownerValue, referenceValue);
		assertCaptureReady(state);
		return captureAuthority.prepare(state.owner, state.window.webContents.mainFrame, state.reference);
	}

	async function setCaptureState(ownerValue: object, requestValue: unknown): Promise<boolean> {
		if (disposed) return false;
		let request: Readonly<WebVcrCaptureStateRequestV1>;
		let state: RuntimeSession;
		try {
			request = validateWebVcrCaptureStateRequestV1(requestValue);
			state = ownedSession(ownerValue, request);
		} catch {
			return false;
		}
		try {
			if (!await transitionFramescaperWebVcrCaptureStateV1(
				state, request, () => !disposed && current === state,
			)) {
				if (current === state) emit(state, snapshot(state));
				return false;
			}
		} catch {
			if (current === state && state.captureState !== 'failed') failSession(state, 'The exact recording fence could not be established.');
			return false;
		}
		state.captureState = request.state;
		if (request.state === 'ready') state.failure = null;
		host.setPhase(state.owner, state.reference, request.state);
		state.captureTransitionPending = false;
		if (request.state === 'finalizing' || request.state === 'recovery' || request.state === 'ready') {
			captureAuthority.teardown(state.owner, state.reference.generation);
		}
		if (request.state === 'ready' && (!state.visible || state.window.isDestroyed())) {
			const terminal = closedSnapshot(state.resolution, state.reference.generation);
			const owner = state.owner;
			closeCurrent(state);
			if (!disposed) options.emitSnapshot(owner, terminal);
			return true;
		}
		const next = snapshot(state);
		emit(state, next);
		return true;
	}

	return Object.freeze({
		captureAuthority,
		handshake,
		open,
		dispatch,
		prepareCapture,
		setCaptureState,
		disposeSession(ownerValue: object, referenceValue: unknown): boolean {
			if (disposed) return false;
			try {
				ownedSession(ownerValue, referenceValue);
				revokeCurrent();
				return true;
			} catch { return false; }
		},
		revokeOwner(ownerValue: object): boolean {
			if (disposed || !current || current.owner !== ownerValue) return false;
			revokeCurrent();
			return true;
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			revokeCurrent();
			captureAuthority.dispose();
			host.dispose();
		},
	});

	async function createSession(
		owner: object,
		resolution: WebVcrResolution,
		initialUrl: string,
	): Promise<Readonly<WebVcrSnapshot>> {
		generation += 1;
		const window = options.createWindow(createFramescaperWebVcrGuestWindowOptionsV1(resolution));
		const hostReference = host.open(owner, generation, window);
		const navigation = Object.freeze({
			generation: 1,
			url: 'about:blank',
			canGoBack: false,
			canGoForward: false,
			isLoading: false,
		});
		const observerFactory = options.createTargetObserver ?? createFramescaperWebVcrTargetObserverV1;
		const observer = observerFactory({
			debuggerPort: window.webContents.debugger,
			viewport: framescaperWebVcrCssViewport(resolution),
			navigationGeneration: () => state.navigation.generation,
			createOpaqueId: options.createOpaqueId,
			onObservation: (observation) => observeTarget(state, observation),
			onFailure: () => failSession(state, 'Target observation failed.'),
		});
		const state: RuntimeSession = {
			owner,
			reference: hostReference,
			window,
			observer,
			popups: new Set(),
			resolution,
			captureState: 'ready',
			visible: true,
			aspect: 'free',
			crop: Object.freeze({ x: 0, y: 0, width: 1, height: 1 }),
			autoCrop: true,
			monitorMuted: false,
			autoStop: false,
			activeRecordingToken: null,
			targetEndedRecordingToken: null,
			captureTransitionPending: false,
			captureTransitionInvalidated: false,
			navigation,
			target: null,
			failure: null,
		};
		current = state;
		configureGuest(state);
		try {
			await navigate(state, 'about:blank');
			await observer.start();
			if (initialUrl !== 'about:blank') {
				await navigate(state, initialUrl);
			}
		} catch (error) {
			if (current === state) {
				const failedOwner = state.owner;
				const failedResolution = state.resolution;
				revokeCurrent();
				if (!disposed) options.emitSnapshot(failedOwner, closedSnapshot(failedResolution, state.reference.generation));
			}
			throw error;
		}
		const opened = snapshot(state);
		emit(state, opened);
		return opened;
	}

	function configureGuest(state: RuntimeSession): void {
		const contents = state.window.webContents;
		contents.setAudioMuted(true);
		contents.setWindowOpenHandler(({ url }) => {
			const allowed = current === state && state.captureState === 'ready'
				&& !state.captureTransitionPending
				&& webVcrPopupAllowed({
					url,
					phase: 'ready',
					openPopupCount: livePopupCount(state),
				});
			return allowed ? Object.freeze({
				action: 'allow',
				overrideBrowserWindowOptions: createFramescaperWebVcrPopupWindowOptionsV1(),
			}) : Object.freeze({ action: 'deny' });
		});
		contents.on('did-create-window', (...args) => {
			const popup = args[0] as FramescaperWebVcrElectronWindow | undefined;
			const details = args[1] as Readonly<{ url?: unknown }> | undefined;
			if (!popup || typeof details?.url !== 'string'
				|| !host.registerPopup(state.owner, state.reference, details.url, popup)) {
				popup?.destroy();
				return;
			}
			state.popups.add(popup);
			configurePopup(state, popup);
		});
		const preventUnsafeNavigation: EventListener = (...args) => {
			const navigation = preventableNavigation(args);
			if (!navigation) return;
			if (captureSetupLocked(state)) {
				navigation.prevent();
				recoverSession(state, 'Navigation was attempted during capture.');
				return;
			}
			let allowed = state.captureState === 'ready';
			try { admitFramescaperWebVcrUrl(navigation.url); } catch { allowed = false; }
			if (!allowed) navigation.prevent();
		};
		contents.on('will-navigate', preventUnsafeNavigation);
		contents.on('will-redirect', preventUnsafeNavigation);
		contents.on('render-process-gone', () => failSession(state, 'Web VCR guest process was lost.'));
		contents.on('did-fail-load', (...args) => {
			const disposition = failedLoadDisposition(state, args, current === state);
			if (disposition === 'failed') failSession(state, 'Web VCR navigation failed.');
			else if (disposition === 'aborted') emit(state, snapshot(state));
		});
		contents.on('did-start-navigation', (...args) => observeNavigationStart(state, args));
		contents.on('did-navigate', (...args) => observeNavigationCommit(state, args, false));
		contents.on('did-navigate-in-page', (...args) => observeNavigationCommit(state, args, true));
	}

	function configurePopup(state: RuntimeSession, popup: FramescaperWebVcrElectronWindow): void {
		popup.webContents.setAudioMuted(true);
		popup.webContents.setWindowOpenHandler(() => Object.freeze({ action: 'deny' }));
		const preventUnsafe: EventListener = (...args) => {
			const navigation = preventableNavigation(args);
			if (!navigation) return;
			if (captureSetupLocked(state)) {
				navigation.prevent();
				recoverSession(state, 'Authentication popup navigation was attempted during capture.');
				return;
			}
			let allowed = state.captureState === 'ready';
			try { if (admitFramescaperWebVcrUrl(navigation.url).url === 'about:blank') allowed = false; } catch { allowed = false; }
			if (!allowed) navigation.prevent();
		};
		popup.webContents.on('will-navigate', preventUnsafe);
		popup.webContents.on('will-redirect', preventUnsafe);
		popup.webContents.on('render-process-gone', () => popup.destroy());
	}

	async function navigate(state: RuntimeSession, urlValue: string): Promise<void> {
		await loadFramescaperWebVcrNavigation(
			state,
			urlValue,
			() => current === state,
			() => failSession(state, 'Web VCR navigation failed.'),
		);
	}

	function observeNavigationStart(state: RuntimeSession, args: readonly unknown[]): void {
		if (current !== state) return;
		const navigation = startedNavigation(args);
		if (!navigation || !navigation.isMainFrame || navigation.isSameDocument) return;
		if (captureIsActive(state.captureState) || state.captureTransitionPending) {
			recoverSession(state, 'Navigation started during capture.');
			return;
		}
		try {
			const url = admitFramescaperWebVcrUrl(navigation.url).url;
			const generationValue = state.navigation.isLoading
				? state.navigation.generation : state.navigation.generation + 1;
			state.navigation = navigationState(state, { generation: generationValue, url, isLoading: true });
			state.target = null;
			emit(state, snapshot(state));
		} catch { failSession(state, 'Web VCR navigation escaped the HTTPS boundary.'); }
	}

	function observeNavigationCommit(
		state: RuntimeSession,
		args: readonly unknown[],
		sameDocument: boolean,
	): void {
		if (current !== state) return;
		const rawUrl = committedNavigation(args, sameDocument);
		if (rawUrl === null) return;
		if (sameDocument && (captureIsActive(state.captureState) || state.captureTransitionPending)) return;
		if (captureIsActive(state.captureState) || state.captureTransitionPending) {
			recoverSession(state, 'Navigation committed during capture.');
			return;
		}
		try {
			const url = admitFramescaperWebVcrUrl(rawUrl).url;
			state.navigation = navigationState(state, { url, isLoading: false });
			emit(state, snapshot(state));
		} catch { failSession(state, 'Web VCR navigation escaped the HTTPS boundary.'); }
	}

	function observeTarget(
		state: RuntimeSession,
		observation: Readonly<FramescaperWebVcrResolvedTargetObservationV1>,
	): void {
		if (current !== state) return;
		const update = applyFramescaperWebVcrTargetObservationV1(state, observation);
		if (update === 'target-lost') recoverSession(state, 'The selected media target changed during capture.');
		else if (update === 'changed' && !state.captureTransitionPending) emit(state, snapshot(state));
	}

	function failSession(state: RuntimeSession, message: string): void {
		if (current !== state) return;
		state.observer.dispose();
		captureAuthority.revokeOwner(state.owner);
		state.activeRecordingToken = null;
		state.targetEndedRecordingToken = null;
		state.failure = message;
		if (state.captureState === 'ready') {
			state.captureState = 'failed';
			host.setPhase(state.owner, state.reference, 'failed');
		} else if (state.captureState !== 'failed' && state.captureState !== 'recovery') {
			state.captureState = 'recovery';
			host.setPhase(state.owner, state.reference, 'recovery');
		}
		for (const popup of state.popups) if (!popup.isDestroyed()) popup.destroy();
		if (!state.window.isDestroyed()) state.window.destroy();
		emit(state, snapshot(state));
	}

	function recoverSession(state: RuntimeSession, message: string): void {
		if (current !== state || !enterFramescaperWebVcrRecoveryV1(state, message)) return;
		captureAuthority.revokeOwner(state.owner);
		host.setPhase(state.owner, state.reference, 'recovery');
		void state.observer.setRecordingToken(null).catch(() => undefined);
		emit(state, snapshot(state));
	}

	function closePanel(state: RuntimeSession): Readonly<WebVcrDispatchResultV1> {
		state.visible = false;
		if (captureIsActive(state.captureState)) {
			host.closePanel(state.owner, state.reference);
			const next = snapshot(state);
			emit(state, next);
			return snapshotResult(next);
		}
		const resolution = state.resolution;
		closeCurrent(state);
		return snapshotResult(closedSnapshot(resolution, state.reference.generation));
	}

	function closeCurrent(state: RuntimeSession): void {
		if (current !== state) return;
		state.observer.dispose();
		captureAuthority.revokeOwner(state.owner);
		host.closePanel(state.owner, state.reference);
		current = null;
	}

	function revokeCurrent(): void {
		if (!current) return;
		const state = current;
		state.observer.dispose();
		captureAuthority.revokeOwner(state.owner);
		host.revokeOwner(state.owner);
		current = null;
	}

	function ownedSession(ownerValue: object, referenceValue: unknown): RuntimeSession {
		const owner = reference(ownerValue, 'runtime owner');
		const requested = validateWebVcrSessionReferenceV1({
			version: (referenceValue as { version?: unknown })?.version,
			sessionId: (referenceValue as { sessionId?: unknown })?.sessionId,
			generation: (referenceValue as { generation?: unknown })?.generation,
		});
		if (!current || current.owner !== owner || current.reference.sessionId !== requested.sessionId
			|| current.reference.generation !== requested.generation) {
			throw new Error('Web VCR runtime owner or session generation is stale.');
		}
		return current;
	}

	function snapshot(state: RuntimeSession): Readonly<WebVcrSnapshot> {
		return createFramescaperWebVcrSnapshotV1(state, capability);
	}

	function closedSnapshot(resolution: WebVcrResolution, generation: number): Readonly<WebVcrSnapshot> {
		return createClosedFramescaperWebVcrSnapshotV1(resolution, generation, capability);
	}

	function emit(state: RuntimeSession, value: Readonly<WebVcrSnapshot>): void {
		if (!disposed && current === state) options.emitSnapshot(state.owner, value);
	}

	function assertOperational(): void {
		if (disposed) throw new Error('Web VCR runtime is disposed.');
	}

}
