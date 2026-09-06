import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
	PLAYBACK_METER_SETTINGS_STORAGE_KEY,
	RECORDING_METER_SETTINGS_STORAGE_KEY,
	productStorageKey,
} from '../meter-settings.ts';
import { isExpectedWorkspaceCancellation } from './scape-open-decision-continuation.ts';
import { useDesktopHostMenuRuntime } from './useDesktopHostMenuRuntime.ts';
import { useWorkspaceViewDefaults } from './useWorkspaceViewDefaults.ts';
import { workspaceSwitcherOptions } from './workspace-switcher-options.ts';

export function useAudioEditorWorkspaceLifecycle({
	controller,
	copy,
	fileService,
	parityRuntime,
	phase,
	playbackMeterSettings,
	preferences,
	product,
	productId,
	recordingMeterSettings,
	setDialog,
	setPlaybackMeterSettings,
	setRecordingMeterSettings,
}) {
	const [parityUi, setParityUi] = useState(() => parityRuntime.uiController.getSnapshot());
	const [localError, setLocalError] = useState('');
	const [desktopEnvironment, setDesktopEnvironment] = useState(null);
	const requestedProjectOpenedRef = useRef(false);
	const launchIntentTakenRef = useRef(false);
	useEffect(() => {
		setParityUi(parityRuntime.uiController.getSnapshot());
		const unsubscribe = parityRuntime.uiController.subscribe(() => {
			setParityUi(parityRuntime.uiController.getSnapshot());
		});
		return () => {
			unsubscribe();
			parityRuntime.dispose();
			void controller.dispose();
		};
	}, [controller, parityRuntime]);
	useEffect(() => {
		try {
			globalThis.localStorage?.setItem(
				productStorageKey(PLAYBACK_METER_SETTINGS_STORAGE_KEY, productId),
				JSON.stringify(playbackMeterSettings),
			);
		} catch {
			// Meter presentation preferences are best-effort in restricted storage contexts.
		}
	}, [playbackMeterSettings, productId]);
	useEffect(() => {
		try {
			globalThis.localStorage?.setItem(
				productStorageKey(RECORDING_METER_SETTINGS_STORAGE_KEY, productId),
				JSON.stringify(recordingMeterSettings),
			);
		} catch {
			// Meter presentation preferences are best-effort in restricted storage contexts.
		}
	}, [productId, recordingMeterSettings]);
	const uiFlags = parityUi.flags;

	const onError = useCallback((error) => {
		if (isExpectedWorkspaceCancellation(error)) return;
		controller.recordLocalDiagnosticError?.(error, 'workspace');
		const message = error instanceof Error ? error.message : String(error || copy.unknownError);
		setLocalError(copy.genericError.replace('{message}', message));
	}, [controller, copy.genericError, copy.unknownError]);
	useEffect(() => {
		if (requestedProjectOpenedRef.current) return;
		requestedProjectOpenedRef.current = true;
		const projectId = new URL(globalThis.location?.href || 'http://localhost/').searchParams.get('project');
		if (!projectId || projectId.length > 256 || !/^[a-z0-9_-]+$/iu.test(projectId)) return;
		void controller.ready
			.then(() => controller.actions.project.openById(projectId))
			.catch(onError);
	}, [controller, onError]);
	const openLaunchedProjectPicker = useCallback(
		() => openWorkspaceProjectPicker({ controller, onError, setDialog }),
		[controller, onError, setDialog],
	);
	useEffect(() => {
		// A jump-list shortcut is a one-shot instruction carried in the address
		// the system opened, so it is taken once per document and never replayed.
		if (launchIntentTakenRef.current) return;
		launchIntentTakenRef.current = true;
		startWorkspaceLaunchIntent({
			controller,
			onError,
			openProjectPicker: openLaunchedProjectPicker,
		});
	}, [controller, onError, openLaunchedProjectPicker]);

	const run = useCallback((action) => {
		setLocalError('');
		try {
			const value = action();
			if (value && typeof value.catch === 'function') value.catch(onError);
			return value;
		} catch (error) {
			onError(error);
			return undefined;
		}
	}, [onError]);
	useWorkspaceViewDefaults({
		activeWorkspaceId: preferences?.workspace?.activeId || product.defaultWorkspace,
		ready: phase === 'ready',
		controller,
		run,
		setPlaybackMeterSettings,
		setRecordingMeterSettings,
	});
	const desktopHostRuntime = useDesktopHostMenuRuntime({
		development: desktopEnvironment?.development === true,
		fileService,
		onError,
		platform: desktopEnvironment?.platform,
		productId,
	});
	const switcherOptions = useMemo(
		() => workspaceSwitcherOptions(productId, copy, preferences?.workspace?.custom),
		[copy, preferences?.workspace?.custom, productId],
	);
	const publishWorkspaceSwitcherState = useCallback(() => {
		const detail = {
			productId,
			activeId: preferences?.workspace?.activeId || product.defaultWorkspace,
			workspaces: switcherOptions,
		};
		globalThis.dispatchEvent?.(new CustomEvent('scape:workspace-state', {
			detail,
		}));
		globalThis.dispatchEvent?.(new CustomEvent('soundscaper:workspace-state', {
			detail: {
				...detail,
			},
		}));
	}, [preferences?.workspace?.activeId, product.defaultWorkspace, productId, switcherOptions]);
	useEffect(() => {
		const handleWorkspaceRequest = (event) => {
			if (event?.detail?.productId && event.detail.productId !== productId) return;
			const workspaceId = event?.detail?.workspaceId;
			if (!switcherOptions.some(({ id }) => id === workspaceId)) return;
			run(() => controller.actions.preferences.setWorkspace(workspaceId));
		};
		globalThis.addEventListener?.('scape:workspace-request', handleWorkspaceRequest);
		globalThis.addEventListener?.('soundscaper:workspace-request', handleWorkspaceRequest);
		globalThis.addEventListener?.('scape:workspace-ready', publishWorkspaceSwitcherState);
		globalThis.addEventListener?.('soundscaper:workspace-ready', publishWorkspaceSwitcherState);
		publishWorkspaceSwitcherState();
		return () => {
			globalThis.removeEventListener?.('scape:workspace-request', handleWorkspaceRequest);
			globalThis.removeEventListener?.('soundscaper:workspace-request', handleWorkspaceRequest);
			globalThis.removeEventListener?.('scape:workspace-ready', publishWorkspaceSwitcherState);
			globalThis.removeEventListener?.('soundscaper:workspace-ready', publishWorkspaceSwitcherState);
		};
	}, [controller, productId, publishWorkspaceSwitcherState, run, switcherOptions]);
	useEffect(() => {
		if (!fileService.isDesktop) return undefined;
		let active = true;
		Promise.resolve(fileService.getEnvironment())
			.then((environment) => {
				if (active) setDesktopEnvironment(environment);
			})
			.catch(onError);
		return () => { active = false; };
	}, [fileService, onError]);
	return { desktopEnvironment, desktopHostRuntime, localError, onError, parityUi, run, uiFlags };
}

/**
 * The stored-project picker, opened for a person who asked for it before the
 * editor existed.
 *
 * The dialog itself can be shown at once - it is where they will wait - while
 * the listing behind it has to hold for the controller the shortcut outran.
 */
export function openWorkspaceProjectPicker({ controller, onError, setDialog }) {
	setDialog?.('projects');
	void Promise.resolve(controller.ready)
		.then(() => controller.actions.project.list())
		.catch(onError);
}

/** Rewrites the address of the open document without adding a history entry. */
function replaceDocumentAddress(address) {
	globalThis.history?.replaceState?.(globalThis.history.state ?? null, '', address);
}

/**
 * The jump-list shortcut this document was opened from, consumed.
 *
 * The manifest's shortcuts are plain URLs - `?launch=new-project` and
 * `?launch=open-project` - so the instruction survives in the address bar after
 * it has been carried out, and a refresh would repeat it. It is therefore taken
 * rather than read: the parameter is stripped with `replaceState` on the way
 * out, which keeps the session-history entry and leaves an address that reloads
 * into the editor rather than into the shortcut again.
 *
 * The parameter is cleared whatever it says. A shortcut pinned by an older
 * install can name something this build no longer offers, and the person who
 * clicked it wanted the editor either way.
 */
export function takeWorkspaceLaunchIntent(
	href = globalThis.location?.href,
	replaceAddress = replaceDocumentAddress,
) {
	if (!href) return null;
	const url = new URL(href, 'http://localhost/');
	const intent = url.searchParams.get('launch');
	if (intent === null) return null;
	url.searchParams.delete('launch');
	try {
		replaceAddress(`${url.pathname}${url.search}${url.hash}`);
	} catch {
		// Tidying the address bar is a courtesy; a history the document may not
		// rewrite must not cost the person the action they asked for.
	}
	return intent;
}

/**
 * Carries out the shortcut the editor was launched from.
 *
 * `launch_handler` is `navigate-existing`, so a second click navigates the open
 * window to the shortcut URL rather than opening another one. That navigation
 * loads a document, which is why this runs at startup and needs nothing to
 * survive between launches.
 *
 * Both actions wait for the controller, because the shortcut arrives in the
 * address the editor booted from and the boot is not finished yet.
 */
export function startWorkspaceLaunchIntent({
	controller,
	href = globalThis.location?.href,
	onError,
	openProjectPicker,
	replaceAddress = replaceDocumentAddress,
}) {
	const intent = takeWorkspaceLaunchIntent(href, replaceAddress);
	if (intent === 'new-project') {
		void Promise.resolve(controller.ready)
			.then(() => controller.actions.project.create())
			.catch(onError);
	} else if (intent === 'open-project') openProjectPicker();
	return intent;
}
