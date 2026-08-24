/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Every milestone-5B native surface, reached through an existing menu family
 * and opened lazily.
 *
 * Nothing here adds always-visible chrome: no toolbar control, no panel, no
 * side rail, no badge. Soundscaper receives none of it at all, because a native
 * video and OFX tier is not part of that product.
 *
 * Candidate V25/V26 custody keeps two entries reachable even while the native
 * tier is switched off or unavailable: preferences and OFX management. The
 * historical V27 route is Milestone 1–4 only and exposes none of this surface.
 * Selected V28 exposes each operation only when its capability and action port
 * are both authenticated. Everything else is disabled with the capability it needs.
 */

import {
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	NATIVE_MEDIA_CAPABILITY_IDS,
	type NativeMediaCapabilityRefV1,
	type NativeMediaCapabilitySnapshotV1,
} from '../native-media-capability-snapshot.ts';
import type {
	ExternalDisplayDescriptorV1,
} from '../native-external-display.ts';
import {
	resolveFramescaperNativeServicesCopy,
} from './framescaper-native-services-copy.ts';
import {
	FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES,
	type FramescaperNativeProjectActionSurface,
} from './framescaper-native-project-actions.ts';
import type {
	FramescaperNativeServicesLifecycleMethod,
} from './framescaper-native-services-lifecycle-bridge.ts';

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
	'ofx-interact',
] as const);

export type FramescaperNativeServiceSurface =
	(typeof FRAMESCAPER_NATIVE_SERVICE_SURFACES)[number];

export { FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES };

/** Candidate-only surfaces that stay reachable so the user can enable or repair the tier. */
export const FRAMESCAPER_ALWAYS_REACHABLE_SURFACES: readonly FramescaperNativeServiceSurface[] =
	Object.freeze(['native-media-preferences', 'ofx-manage']);

/** Surfaces with a real selected-runtime renderer action, not a placeholder panel. */
export const FRAMESCAPER_ACTIONABLE_NATIVE_SERVICE_SURFACES:
	readonly FramescaperNativeServiceSurface[] = Object.freeze([
		...FRAMESCAPER_NATIVE_PROJECT_ACTION_SURFACES,
		'background-jobs', 'watch-folders', 'native-media-preferences', 'ofx-manage',
		'ofx-interact',
	]);

const ACTIONABLE_SURFACES = new Set(FRAMESCAPER_ACTIONABLE_NATIVE_SERVICE_SURFACES);

export interface FramescaperNativeServicesMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly disabledReason?: string;
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
	/**
	 * Whether this build has a native-services controller at all. A build
	 * without one shows no entries: a menu item that opens nothing is worse
	 * than an absent one, because the user cannot tell the difference between
	 * "not built" and "broken".
	 */
	readonly runtimeAvailable: boolean;
	readonly snapshot: NativeMediaCapabilitySnapshotV1 | null;
	readonly project: unknown;
	readonly projectCapabilities?: Readonly<Record<string, unknown>>;
	readonly editingBlocked: boolean;
	readonly readOnly?: boolean;
	readonly externalDisplays?: readonly ExternalDisplayDescriptorV1[];
	readonly activeExternalDisplayId?: string | null;
	readonly lifecycleMethods?: readonly FramescaperNativeServicesLifecycleMethod[];
	/** Exact project mutations installed only by a candidate project runtime. */
	readonly projectActionSurfaces?: readonly FramescaperNativeProjectActionSurface[];
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
	if (input.productId !== 'framescaper' || !input.runtimeAvailable) return EMPTY;
	if (projectSchemaVersion(input.project) === 27) return EMPTY;
	const copy = resolveFramescaperNativeServicesCopy(input.copy);
	const snapshot = input.snapshot;
	const hasProject = input.project != null;
	const mutable = hasProject && !input.editingBlocked && input.readOnly !== true;
	const usable = (ref: NativeMediaCapabilityRefV1): boolean => (
		snapshot !== null
		&& isNativeMediaCapabilityUsable(nativeMediaCapabilityEntry(snapshot, ref.domain, ref.id))
	);
	const queueUsable = usable(NATIVE_MEDIA_CAPABILITY_IDS.renderQueue);
	const watchUsable = usable(NATIVE_MEDIA_CAPABILITY_IDS.watchFolders);
	const proxyUsable = usable(NATIVE_MEDIA_CAPABILITY_IDS.proxyCodec);
	const imageSequenceUsable = usable(NATIVE_MEDIA_CAPABILITY_IDS.imageSequenceImport);
	const displayUsable = usable(NATIVE_MEDIA_CAPABILITY_IDS.externalDisplay);
	const ofxUsable = usable(NATIVE_MEDIA_CAPABILITY_IDS.ofxHost);
	const watchCrudAvailable = [
		'createWatch', 'setWatchEnabled', 'removeWatch', 'reconcileWatch',
	].every((method) => input.lifecycleMethods?.includes(
		method as FramescaperNativeServicesLifecycleMethod,
	) === true);
	const projectCapability = (key: string): boolean => input.projectCapabilities?.[key] === true;
	const projectAction = (surface: FramescaperNativeProjectActionSurface): boolean => (
		input.projectActionSurfaces?.includes(surface) === true
	);
	const schemaVersion = projectSchemaVersion(input.project);
	const professionalMediaProject = schemaVersion === 25 || schemaVersion === 26
		|| schemaVersion === 28;
	const openFxProject = schemaVersion === 26 || schemaVersion === 28;
	const leaf = (
		id: string,
		label: string,
		surface: FramescaperNativeServiceSurface,
		enabled: boolean,
	): FramescaperNativeServicesMenuItem => Object.freeze({
		id,
		label,
		disabled: !enabled || !ACTIONABLE_SURFACES.has(surface),
		disabledReason: enabled && ACTIONABLE_SURFACES.has(surface) ? '' : copy.capabilityUnavailable,
		onClick: () => (enabled && ACTIONABLE_SURFACES.has(surface) ? actions.open(surface) : undefined),
	});

	return Object.freeze({
		fileImport: Object.freeze([leaf(
			'framescaper-import-image-sequence', copy.importImageSequence,
			'image-sequence-import', mutable && professionalMediaProject
				&& projectCapability('sourceCharacteristics')
				&& imageSequenceUsable && projectAction('image-sequence-import'),
		)]),
		fileExport: Object.freeze([leaf(
			'framescaper-add-to-render-queue', copy.addToRenderQueue,
			'render-queue-enqueue', hasProject && projectCapability('videoExport') && queueUsable
				&& projectAction('render-queue-enqueue'),
		)]),
		view: Object.freeze([externalDisplayMenu(
			input, copy, actions,
			displayUsable && hasProject && projectCapability('videoPlayback'),
		)]),
		tools: Object.freeze([
			leaf('framescaper-background-jobs', copy.backgroundJobs, 'background-jobs', queueUsable),
			leaf('framescaper-watch-folders', copy.watchFolders, 'watch-folders',
				mutable && projectCapability('videoImport') && watchUsable && watchCrudAvailable),
			branch('framescaper-proxies', copy.proxies, [
				leaf('framescaper-proxy-generate', copy.proxyGenerate, 'proxy-generate',
					mutable && professionalMediaProject
						&& projectCapability('sourceCharacteristics') && proxyUsable
						&& projectAction('proxy-generate')),
				leaf('framescaper-proxy-attach', copy.proxyAttach, 'proxy-attach',
					mutable && professionalMediaProject
						&& projectCapability('sourceCharacteristics') && proxyUsable
						&& projectAction('proxy-attach')),
				leaf('framescaper-proxy-detach', copy.proxyDetach, 'proxy-detach',
					mutable && professionalMediaProject
						&& projectCapability('sourceCharacteristics') && snapshot?.masterEnabled === true
						&& projectAction('proxy-detach')),
				leaf('framescaper-proxy-relink', copy.proxyRelink, 'proxy-relink',
					mutable && professionalMediaProject
						&& projectCapability('sourceCharacteristics') && snapshot?.masterEnabled === true
						&& projectAction('proxy-relink')),
			]),
			// Always reachable: this is where the tier is switched on.
			leaf(
				'framescaper-native-media-preferences', copy.nativeMediaPreferences,
				'native-media-preferences', true,
			),
		]),
		effect: Object.freeze([branch('framescaper-video-effects', copy.videoEffects, [
			leaf('framescaper-ofx-add', copy.ofxAdd, 'ofx-add',
				mutable && openFxProject && projectCapability('ofxEffects') && ofxUsable
					&& projectAction('ofx-add')),
			// Always reachable: this is where consent is granted and quarantine cleared.
			leaf('framescaper-ofx-manage', copy.ofxManage, 'ofx-manage', true),
			leaf('framescaper-ofx-interact', copy.ofxInteract, 'ofx-interact',
				openFxProject && projectCapability('ofxEffects') && ofxUsable),
		])]),
	});
}

function externalDisplayMenu(
	input: FramescaperNativeServicesMenuInput,
	copy: ReturnType<typeof resolveFramescaperNativeServicesCopy>,
	actions: FramescaperNativeServicesMenuActions,
	usable: boolean,
): FramescaperNativeServicesMenuItem {
	const displays = (input.externalDisplays ?? []).filter(({ primary }) => !primary);
	const active = input.activeExternalDisplayId ?? null;
	if (!usable || displays.length === 0) {
		return Object.freeze({
			id: 'framescaper-external-display',
			label: copy.externalDisplay,
			disabled: true,
			disabledReason: usable ? copy.externalDisplayUnavailable : copy.capabilityUnavailable,
			items: Object.freeze([Object.freeze({
				id: 'framescaper-external-display-unavailable',
				label: usable ? copy.externalDisplayUnavailable : copy.capabilityUnavailable,
				disabled: true,
				disabledReason: usable ? copy.externalDisplayUnavailable : copy.capabilityUnavailable,
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

function projectSchemaVersion(value: unknown): number | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& Number.isSafeInteger(descriptor.value)
		? Number(descriptor.value)
		: null;
}
