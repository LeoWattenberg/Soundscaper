/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The workspace's end of the milestone-5A native tier: the runtime the
 * application menu asks for, and the menu-opened host that renders the surface.
 *
 * Resolution is synchronous and hook-free because the menu model is built by a
 * plain function, so the tier reports what it already knows and refreshes in the
 * background. Until the first probe answers, the two surfaces that exist to turn
 * the tier on and to repair it are reachable and the rest say they are not ready
 * — the surface itself always re-reads the tier when it opens, so nothing a user
 * acts on is ever drawn from a stale menu.
 *
 * The host is created on the first menu activation and never before, so a
 * Soundscaper window that nobody sends to the native menus mounts nothing at
 * all, and the editor surface itself gains no chrome from the tier existing.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

import {
	resolveSoundscaperNativeServicesBridge,
	soundscaperNativeServicesStoreFor,
	type SoundscaperNativeServicesBridge,
} from '../soundscaper-native-services-bridge.ts';
import type {
	SoundscaperNativeServiceSurface,
	SoundscaperNativeServicesSnapshot,
} from '../soundscaper-native-services-menu.ts';

const SoundscaperNativeServicesDialog = React.lazy(() => (
	import('../dialogs/SoundscaperNativeServicesDialog.tsx')
));

/**
 * What an unanswered tier looks like. Nothing here claims a capability: no
 * backend, no enabled format, so every capability-gated entry stays disabled and
 * says which capability it is missing.
 */
export const PENDING_SOUNDSCAPER_NATIVE_SERVICES_SNAPSHOT: SoundscaperNativeServicesSnapshot =
	Object.freeze({
		enabled: true,
		quarantined: false,
		payloadAvailable: true,
		payloadDetail: '',
		usableAudioBackends: Object.freeze([]),
		enabledPluginFormats: Object.freeze([]),
	});

export interface SoundscaperNativeServicesWorkspaceRuntime {
	readonly snapshot: SoundscaperNativeServicesSnapshot;
	open(surface: SoundscaperNativeServiceSurface): void;
}

export interface SoundscaperNativeServicesSurfaceHost {
	open(surface: SoundscaperNativeServiceSurface): void;
	close(): void;
	dispose(): void;
}

interface SoundscaperNativeServicesHostRoot {
	render(node: React.ReactNode): void;
	unmount(): void;
}

export interface SoundscaperNativeServicesSurfaceHostOptions {
	readonly bridge: SoundscaperNativeServicesBridge;
	readonly copy?: Readonly<Record<string, string | undefined>>;
	readonly documentValue?: Document | null;
	readonly createHostRoot?: (container: HTMLElement) => SoundscaperNativeServicesHostRoot;
}

export function createSoundscaperNativeServicesSurfaceHost(
	options: SoundscaperNativeServicesSurfaceHostOptions,
): SoundscaperNativeServicesSurfaceHost {
	const documentValue = options.documentValue
		?? (typeof document === 'undefined' ? null : document);
	let container: HTMLElement | null = null;
	let root: SoundscaperNativeServicesHostRoot | null = null;
	const close = (): void => { root?.render(null); };
	return Object.freeze({
		open: (surface: SoundscaperNativeServiceSurface) => {
			if (!documentValue) return;
			if (!container) {
				container = documentValue.createElement('div');
				container.dataset.editorSurface = 'soundscaper-native-services';
				// Inside the editor when there is one, so the surface inherits the
				// theme variables the workspace root carries rather than the bare page.
				(documentValue.querySelector('[data-audio-editor]') ?? documentValue.body).append(container);
			}
			root ??= (options.createHostRoot ?? ((element: HTMLElement) => createRoot(element)))(container);
			root.render(<React.Suspense fallback={null}>
				<SoundscaperNativeServicesDialog
					bridge={options.bridge}
					initialSurface={surface}
					copy={options.copy}
					onClose={close}
				/>
			</React.Suspense>);
		},
		close,
		dispose: () => {
			root?.unmount();
			root = null;
			container?.remove();
			container = null;
		},
	});
}

const HOSTS = new WeakMap<SoundscaperNativeServicesBridge, SoundscaperNativeServicesSurfaceHost>();

/**
 * Only Soundscaper, and only where the desktop bridge answers for the whole
 * tier. Anywhere else this resolves to null, and the menu module drops every
 * native entry rather than showing a row that could never do anything.
 */
export function resolveSoundscaperNativeServicesWorkspaceRuntime(input: Readonly<{
	productId: string;
	bridge?: SoundscaperNativeServicesBridge | null;
	copy?: Readonly<Record<string, string | undefined>>;
}>): Readonly<SoundscaperNativeServicesWorkspaceRuntime> | null {
	const bridge = input.productId === 'soundscaper'
		? input.bridge ?? resolveSoundscaperNativeServicesBridge()
		: null;
	if (bridge === null) return null;
	const store = soundscaperNativeServicesStoreFor(bridge);
	store.refreshIfStale();
	return Object.freeze({
		snapshot: store.getSnapshot() ?? PENDING_SOUNDSCAPER_NATIVE_SERVICES_SNAPSHOT,
		open: (surface: SoundscaperNativeServiceSurface) => {
			let host = HOSTS.get(bridge);
			if (!host) {
				host = createSoundscaperNativeServicesSurfaceHost({ bridge, copy: input.copy });
				HOSTS.set(bridge, host);
			}
			host.open(surface);
		},
	});
}
