/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Every milestone-5B native surface, reached through an existing menu family
 * and opened lazily.
 *
 * Nothing here adds always-visible chrome: no toolbar control, no panel, no
 * side rail, no badge. Soundscaper receives none of it at all, because a native
 * video and OFX tier is not part of that product.
 *
 * Two entries stay reachable even while the native tier is switched off or
 * unavailable — the preferences pane and the OFX manage surface. They are how a
 * user turns the tier on and how they clear a quarantine, so gating them on the
 * capability they exist to change would be a trap the user cannot escape from
 * inside the application. Everything else is disabled with the capability it
 * needs.
 */

import {
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	type NativeMediaCapabilitySnapshotV1,
} from '../native-media-capability-snapshot.ts';
import type {
	ExternalDisplayDescriptorV1,
} from '../native-external-display.ts';
import {
	resolveFramescaperNativeServicesCopy,
} from './framescaper-native-services-copy.ts';

export const FRAMESCAPER_NATIVE_SERVICE_SURFACES = Object.freeze([
	'image-sequence-import',
	'render-queue-enqueue',
	'background-jobs',
	'watch-folders',
	'proxy-generate',
	'proxy-attach',
	'proxy-detach',
	'proxy-relink',
	'native-media-preferences',
	'ofx-add',
	'ofx-manage',
] as const);

export type FramescaperNativeServiceSurface =
	(typeof FRAMESCAPER_NATIVE_SERVICE_SURFACES)[number];

/** Surfaces that must stay reachable so the user can enable or repair the tier. */
export const FRAMESCAPER_ALWAYS_REACHABLE_SURFACES: readonly FramescaperNativeServiceSurface[] =
	Object.freeze(['native-media-preferences', 'ofx-manage']);

export interface FramescaperNativeServicesMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly checked?: boolean;
	readonly items?: readonly FramescaperNativeServicesMenuItem[];
	onClick?(): unknown;
}

export interface FramescaperNativeServicesMenuItems {
	readonly fileImport: readonly FramescaperNativeServicesMenuItem[];
	readonly fileExport: readonly FramescaperNativeServicesMenuItem[];
	readonly view: readonly FramescaperNativeServicesMenuItem[];
	readonly tools: readonly FramescaperNativeServicesMenuItem[];
	readonly effect: readonly FramescaperNativeServicesMenuItem[];
}

export interface FramescaperNativeServicesMenuInput {
	readonly productId: string;
	readonly snapshot: NativeMediaCapabilitySnapshotV1 | null;
	readonly project: unknown;
	readonly editingBlocked: boolean;
	readonly readOnly?: boolean;
	readonly externalDisplays?: readonly ExternalDisplayDescriptorV1[];
	readonly activeExternalDisplayId?: string | null;
	readonly copy?: Readonly<Record<string, string | undefined>>;
}

export interface FramescaperNativeServicesMenuActions {
	open(surface: FramescaperNativeServiceSurface): unknown;
	openExternalDisplay(displayId: string | null): unknown;
}

const EMPTY: FramescaperNativeServicesMenuItems = Object.freeze({
	fileImport: Object.freeze([]),
	fileExport: Object.freeze([]),
	view: Object.freeze([]),
	tools: Object.freeze([]),
	effect: Object.freeze([]),
});

export function createFramescaperNativeServicesMenuItems(
	input: FramescaperNativeServicesMenuInput,
	actions: FramescaperNativeServicesMenuActions,
): FramescaperNativeServicesMenuItems {
	if (input.productId !== 'framescaper') return EMPTY;
	const copy = resolveFramescaperNativeServicesCopy(input.copy);
	const snapshot = input.snapshot;
	const hasProject = input.project != null;
	const mutable = hasProject && !input.editingBlocked && input.readOnly !== true;
	const usable = (domain: 'codec' | 'queue' | 'watch' | 'scratch' | 'ofx', id: string): boolean => (
		snapshot !== null && isNativeMediaCapabilityUsable(nativeMediaCapabilityEntry(snapshot, domain, id))
	);
	const queueUsable = usable('queue', 'persistent-render-queue');
	const watchUsable = usable('watch', 'watch-folders');
	const proxyUsable = usable('codec', 'prores-proxy');
	const ofxUsable = usable('ofx', 'isolated-host');
	const leaf = (
		id: string,
		label: string,
		surface: FramescaperNativeServiceSurface,
		enabled: boolean,
	): FramescaperNativeServicesMenuItem => Object.freeze({
		id,
		label,
		disabled: !enabled,
		onClick: () => (enabled ? actions.open(surface) : undefined),
	});

	return Object.freeze({
		fileImport: Object.freeze([leaf(
			'framescaper-import-image-sequence', copy.importImageSequence,
			'image-sequence-import', mutable,
		)]),
		fileExport: Object.freeze([leaf(
			'framescaper-add-to-render-queue', copy.addToRenderQueue,
			'render-queue-enqueue', hasProject && queueUsable,
		)]),
		view: Object.freeze([externalDisplayMenu(input, copy, actions)]),
		tools: Object.freeze([
			leaf('framescaper-background-jobs', copy.backgroundJobs, 'background-jobs', queueUsable),
			leaf('framescaper-watch-folders', copy.watchFolders, 'watch-folders', watchUsable),
			branch('framescaper-proxies', copy.proxies, [
				leaf('framescaper-proxy-generate', copy.proxyGenerate, 'proxy-generate', mutable && proxyUsable),
				leaf('framescaper-proxy-attach', copy.proxyAttach, 'proxy-attach', mutable && proxyUsable),
				leaf('framescaper-proxy-detach', copy.proxyDetach, 'proxy-detach', mutable),
				leaf('framescaper-proxy-relink', copy.proxyRelink, 'proxy-relink', mutable),
			]),
			// Always reachable: this is where the tier is switched on.
			leaf(
				'framescaper-native-media-preferences', copy.nativeMediaPreferences,
				'native-media-preferences', true,
			),
		]),
		effect: Object.freeze([branch('framescaper-video-effects', copy.videoEffects, [
			leaf('framescaper-ofx-add', copy.ofxAdd, 'ofx-add', mutable && ofxUsable),
			// Always reachable: this is where consent is granted and quarantine cleared.
			leaf('framescaper-ofx-manage', copy.ofxManage, 'ofx-manage', true),
		])]),
	});
}

function externalDisplayMenu(
	input: FramescaperNativeServicesMenuInput,
	copy: ReturnType<typeof resolveFramescaperNativeServicesCopy>,
	actions: FramescaperNativeServicesMenuActions,
): FramescaperNativeServicesMenuItem {
	const displays = input.externalDisplays ?? [];
	const active = input.activeExternalDisplayId ?? null;
	if (displays.length === 0) {
		return Object.freeze({
			id: 'framescaper-external-display',
			label: copy.externalDisplay,
			disabled: true,
			items: Object.freeze([Object.freeze({
				id: 'framescaper-external-display-unavailable',
				label: copy.externalDisplayUnavailable,
				disabled: true,
			})]),
		});
	}
	const items: FramescaperNativeServicesMenuItem[] = [Object.freeze({
		id: 'framescaper-external-display-none',
		label: copy.externalDisplayNone,
		disabled: active === null,
		checked: active === null,
		onClick: () => actions.openExternalDisplay(null),
	})];
	for (const display of displays) {
		items.push(Object.freeze({
			id: `framescaper-external-display-${display.displayId}`,
			label: display.label,
			disabled: false,
			checked: active === display.displayId,
			onClick: () => actions.openExternalDisplay(display.displayId),
		}));
	}
	return Object.freeze({
		id: 'framescaper-external-display',
		label: copy.externalDisplay,
		disabled: false,
		items: Object.freeze(items),
	});
}

function branch(
	id: string,
	label: string,
	items: readonly FramescaperNativeServicesMenuItem[],
): FramescaperNativeServicesMenuItem {
	return Object.freeze({
		id,
		label,
		disabled: items.every((item) => item.disabled),
		items: Object.freeze([...items]),
	});
}
