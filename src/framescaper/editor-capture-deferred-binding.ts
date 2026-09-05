/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCaptureAppBindingOptions,
	createFramescaperCaptureAppBinding,
} from '../common/editor/controller/framescaper-capture-app-binding.ts';
import type { FramescaperCaptureAppComposition } from
	'../common/editor/controller/framescaper-capture-app-composition.ts';
import type { FramescaperCaptureOriginGuardSnapshot } from
	'../common/editor/controller/framescaper-capture-origin-guard.ts';
import type {
	FramescaperCaptureSessionActions,
	FramescaperCaptureSessionService,
	FramescaperCaptureSessionSnapshot,
} from '../common/editor/controller/framescaper-capture-session-types.ts';
import type { FramescaperWebVcrActions } from
	'../common/editor/controller/framescaper-web-vcr-controller-types.ts';
import { createFramescaperWebVcrUiSnapshot } from
	'../common/editor/controller/framescaper-web-vcr-ui-snapshot.ts';
import {
	framescaperCaptureRecoveryPresent,
	type FramescaperCaptureRecoveryPresencePort,
} from '../common/editor/storage/framescaper-capture-recovery-presence.ts';
import type { WebVcrCapability } from '../common/editor/web-vcr-domain.ts';
import type { FramescaperEditorCaptureImplementation } from './editor-capture-runtime-implementation.ts';

export type FramescaperCaptureBinding = NonNullable<ReturnType<typeof createFramescaperCaptureAppBinding>>;
export type FramescaperCaptureImplementationLoader = () => Promise<FramescaperEditorCaptureImplementation>;

const EMPTY = Object.freeze([]);

/**
 * The idle session snapshot: what the real service reports before anything has
 * probed a runtime or touched a source. The one field left at `null` is
 * `displaySelectionMode`, which the composition reads off the adapter it picks
 * for the environment; nothing eager reads it, and the setup panel that does
 * is what loads the runtime.
 */
export const FRAMESCAPER_CAPTURE_IDLE_SNAPSHOT: Readonly<FramescaperCaptureSessionSnapshot> = Object.freeze({
	phase: 'inactive',
	availability: Object.freeze({ status: 'checking' as const }),
	requestedRoles: EMPTY,
	sources: EMPTY,
	sourcesFrozen: false,
	destination: null,
	countdownMs: null,
	permissionRequestGeneration: null,
	failure: null,
	devices: EMPTY,
	selectedDeviceIds: Object.freeze({}),
	displaySelectionMode: null,
	displaySources: EMPTY,
	selectedDisplaySourceToken: null,
	monitoring: false,
	inputGain: 1,
	elapsedTimeMs: 0,
	setupDefaults: Object.freeze({ destination: 'both' as const, countdownMs: 3_000 }),
	metrics: EMPTY,
});

type SyncCaptureAction = 'openSetup' | 'selectDisplaySource' | 'configure' | 'setSetupDefaults' | 'arm' | 'resetFailure';
type AsyncCaptureAction = Exclude<keyof FramescaperCaptureSessionActions, SyncCaptureAction>;
type WebVcrAction = keyof FramescaperWebVcrActions;
type Replay = () => void;

/**
 * The app binding the editor composes at construction, with the capture stack
 * behind a dynamic import.
 *
 * Until the implementation loads, the binding reports the idle session the real
 * service would report before its first gesture, the Web VCR capability the real
 * controller would settle on for this environment, and origin guards that block
 * nothing — sound because a capture origin can exist only with a live session,
 * which needs the runtime, or with durable state, which `initialize` probes for
 * and loads on. Every asynchronous action loads and delegates; a synchronous
 * one is journaled and replayed, in order, once the runtime has initialized, so
 * a setup default changed before the first preview is not lost.
 *
 * The runtime is loaded at startup only when a desktop bridge is present or the
 * durable presence probe finds capture state. A probe that fails loads rather
 * than assumes: the cost of a wrong negative is an unrecoverable capture.
 */
export function createDeferredFramescaperCaptureAppBinding(
	options: FramescaperCaptureAppBindingOptions,
	load: FramescaperCaptureImplementationLoader,
): Readonly<FramescaperCaptureAppComposition> | null {
	if (options.productId !== 'framescaper') return null;
	let loaded: FramescaperCaptureBinding | null = null;
	let loading: Promise<FramescaperCaptureBinding> | null = null;
	let initialized: Promise<void> | null = null;
	let disposed = false;
	const journal: Replay[] = [];
	const idleWebVcr = createFramescaperWebVcrUiSnapshot({
		capability: coldWebVcrCapability(options),
		phase: 'closed',
		modeActive: false,
		host: null,
		dimensions: null,
		failure: null,
	});

	function warn(error: unknown): void {
		options.onWarning?.(error);
	}

	function ensureLoaded(): Promise<FramescaperCaptureBinding> {
		if (disposed) return Promise.reject(new Error('Framescaper capture is disposed.'));
		loading ??= Promise.resolve()
			.then(load)
			.then(async (implementation) => {
				const binding = implementation.createAppBinding(options);
				if (!binding) throw new Error('The Framescaper capture runtime did not bind to this editor.');
				await binding.initialize();
				loaded = binding;
				for (const replay of journal.splice(0)) {
					try { replay(); } catch (error) { warn(error); }
				}
				options.onChange?.();
				return binding;
			});
		return loading;
	}

	function kick(): void {
		ensureLoaded().catch(warn);
	}

	async function shouldLoadAtStartup(): Promise<boolean> {
		if (options.desktopBridge || options.webVcrBridge) return true;
		const repository = presencePort(options.store);
		if (!repository) return false;
		try {
			const inventory = (await options.store.listProjects()).map((entry) => entry.id);
			return await framescaperCaptureRecoveryPresent(repository, options.getActiveProject()?.id ?? null, inventory);
		} catch (error) {
			warn(error);
			return true;
		}
	}

	function deferSync<Name extends SyncCaptureAction>(name: Name): FramescaperCaptureSessionActions[Name] {
		return ((...args: Parameters<FramescaperCaptureSessionActions[Name]>) => {
			const apply = (binding: FramescaperCaptureBinding) => (
				(binding.actions[name] as (...value: typeof args) => void)(...args)
			);
			if (loaded) { apply(loaded); return; }
			const binding = () => { if (loaded) apply(loaded); };
			journal.push(binding);
			kick();
		}) as FramescaperCaptureSessionActions[Name];
	}

	function deferAsync<Name extends AsyncCaptureAction>(name: Name): FramescaperCaptureSessionActions[Name] {
		return ((...args: Parameters<FramescaperCaptureSessionActions[Name]>) => ensureLoaded().then(
			(binding) => (binding.actions[name] as (...value: typeof args) => Promise<void>)(...args),
		)) as FramescaperCaptureSessionActions[Name];
	}

	function deferWebVcr<Name extends WebVcrAction>(name: Name): FramescaperWebVcrActions[Name] {
		return ((...args: Parameters<FramescaperWebVcrActions[Name]>) => ensureLoaded().then(
			(binding) => (binding.webVcrActions[name] as (...value: typeof args) => Promise<void>)(...args),
		)) as FramescaperWebVcrActions[Name];
	}

	const actions: Readonly<FramescaperCaptureSessionActions> = Object.freeze({
		openSetup: deferSync('openSetup'),
		selectDisplaySource: deferSync('selectDisplaySource'),
		configure: deferSync('configure'),
		setSetupDefaults: deferSync('setSetupDefaults'),
		arm: deferSync('arm'),
		resetFailure: deferSync('resetFailure'),
		requestPreview: deferAsync('requestPreview'),
		listDisplaySources: deferAsync('listDisplaySources'),
		selectDevice: deferAsync('selectDevice'),
		configureSource: deferAsync('configureSource'),
		release: deferAsync('release'),
		start: deferAsync('start'),
		pause: deferAsync('pause'),
		resume: deferAsync('resume'),
		stop: deferAsync('stop'),
		recover: deferAsync('recover'),
		importAsIs: deferAsync('importAsIs'),
		discard: deferAsync('discard'),
		sealForShutdown: deferAsync('sealForShutdown'),
	});

	const webVcrActions: Readonly<FramescaperWebVcrActions> = Object.freeze({
		activate: deferWebVcr('activate'),
		close: deferWebVcr('close'),
		navigate: deferWebVcr('navigate'),
		back: deferWebVcr('back'),
		forward: deferWebVcr('forward'),
		reload: deferWebVcr('reload'),
		setResolution: deferWebVcr('setResolution'),
		setAutoCrop: deferWebVcr('setAutoCrop'),
		setAspect: deferWebVcr('setAspect'),
		setCrop: deferWebVcr('setCrop'),
		setMonitorMuted: deferWebVcr('setMonitorMuted'),
		setAutoStop: deferWebVcr('setAutoStop'),
		sendPointerInput: deferWebVcr('sendPointerInput'),
		sendKeyInput: deferWebVcr('sendKeyInput'),
		record: deferWebVcr('record'),
		stopAndImport: deferWebVcr('stopAndImport'),
		clearBrowserData: deferWebVcr('clearBrowserData'),
	});

	function initialize(): Promise<void> {
		initialized ??= (async () => {
			if (loading || loaded) { await ensureLoaded(); return; }
			if (await shouldLoadAtStartup()) await ensureLoaded();
		})();
		return initialized;
	}

	async function settled(): Promise<void> {
		if (!loading) return;
		const binding = await loading.catch(() => null);
		if (binding) await binding.service.settled();
	}

	async function dispose(): Promise<void> {
		disposed = true;
		if (!loading) return;
		const binding = await loading.catch(() => null);
		if (binding) await binding.dispose();
	}

	function originSnapshot(activeProjectId?: string | null): Readonly<FramescaperCaptureOriginGuardSnapshot> {
		if (loaded) return loaded.originSnapshot(activeProjectId);
		return Object.freeze({
			active: false,
			generation: null,
			origin: null,
			activeProjectId: activeProjectId ?? null,
			activeProjectIsOrigin: false,
			editBlocked: false,
			closeBlocked: false,
			deleteBlocked: false,
			handoffBlocked: false,
		});
	}

	const service: Readonly<FramescaperCaptureSessionService> = Object.freeze({
		get snapshot() { return loaded ? loaded.service.snapshot : FRAMESCAPER_CAPTURE_IDLE_SNAPSHOT; },
		actions,
		setRuntimeAvailability: (value: Parameters<FramescaperCaptureSessionService['setRuntimeAvailability']>[0]) => {
			if (loaded) { loaded.service.setRuntimeAvailability(value); return; }
			journal.push(() => loaded?.service.setRuntimeAvailability(value));
			kick();
		},
		initialize,
		settled,
		dispose,
	});

	return Object.freeze({
		service,
		get snapshot() { return loaded ? loaded.snapshot : FRAMESCAPER_CAPTURE_IDLE_SNAPSHOT; },
		actions,
		get webVcrSnapshot() { return loaded ? loaded.webVcrSnapshot : idleWebVcr; },
		get webVcrActions() { return loaded ? loaded.webVcrActions : webVcrActions; },
		initialize,
		dispose,
		originSnapshot,
		assertOriginEditAllowed: (projectId: string) => { loaded?.assertOriginEditAllowed(projectId); },
		assertOriginCloseAllowed: (projectId: string) => { loaded?.assertOriginCloseAllowed(projectId); },
		assertOriginDeleteAllowed: (projectId: string) => { loaded?.assertOriginDeleteAllowed(projectId); },
		assertOriginHandoffAllowed: (projectId: string) => { loaded?.assertOriginHandoffAllowed(projectId); },
	});
}

/** The capability the Web VCR controller settles on for this environment before any handshake. */
function coldWebVcrCapability(options: FramescaperCaptureAppBindingOptions): Readonly<WebVcrCapability> {
	if (options.webVcrEnabled !== true) return Object.freeze({ status: 'unavailable', reason: 'roadmap-gate', detail: null });
	if (!options.webVcrBridge) return Object.freeze({ status: 'unavailable', reason: 'desktop-bridge-unavailable', detail: null });
	return Object.freeze({ status: 'checking' });
}

function presencePort(store: unknown): FramescaperCaptureRecoveryPresencePort | null {
	const repository = (store as Readonly<{ framescaperCaptureManifestRepository?: unknown }> | null)
		?.framescaperCaptureManifestRepository as Partial<FramescaperCaptureRecoveryPresencePort> | undefined;
	if (typeof repository?.listCreations !== 'function' || typeof repository.listProject !== 'function') return null;
	return repository as FramescaperCaptureRecoveryPresencePort;
}
