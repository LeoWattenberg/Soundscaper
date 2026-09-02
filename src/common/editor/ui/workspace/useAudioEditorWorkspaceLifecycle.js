import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
	PLAYBACK_METER_SETTINGS_STORAGE_KEY,
	RECORDING_METER_SETTINGS_STORAGE_KEY,
	productStorageKey,
} from '../meter-settings.ts';
import { isExpectedWorkspaceCancellation } from './scape-open-decision-continuation.ts';
import { useDesktopHostMenuRuntime } from './useDesktopHostMenuRuntime.ts';
import { workspaceSwitcherOptions } from './workspace-switcher-options.ts';

export function useAudioEditorWorkspaceLifecycle({
	controller,
	copy,
	fileService,
	parityRuntime,
	playbackMeterSettings,
	preferences,
	product,
	productId,
	recordingMeterSettings,
	setPlaybackMeterSettings,
	setRecordingMeterSettings,
}) {
	const [parityUi, setParityUi] = useState(() => parityRuntime.uiController.getSnapshot());
	const [localError, setLocalError] = useState('');
	const [desktopEnvironment, setDesktopEnvironment] = useState(null);
	const meterWorkspaceRef = useRef(null);
	const requestedProjectOpenedRef = useRef(false);
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
	useEffect(() => {
		const activeWorkspaceId = preferences?.workspace?.activeId || 'modern';
		const previousWorkspaceId = meterWorkspaceRef.current;
		meterWorkspaceRef.current = activeWorkspaceId;
		if (!previousWorkspaceId || previousWorkspaceId === activeWorkspaceId || activeWorkspaceId !== 'modern') return;
		setPlaybackMeterSettings((settings) => settings.position === 'side'
			? settings
			: { ...settings, position: 'side' });
		setRecordingMeterSettings((settings) => settings.position === 'side'
			? settings
			: { ...settings, position: 'side' });
	}, [preferences?.workspace?.activeId]);
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
