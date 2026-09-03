/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDACITY_ACTION_ALIASES } from './audacity-action-aliases.js';
import {
	AUDACITY_ACTION_DEFINITIONS,
	AUDACITY_ACTION_STATUS,
} from './audacity-action-inventory.js';
import {
	AUDACITY_SHORTCUT_INVENTORY,
	type AudacityShortcutRecord,
} from './audacity-shortcut-inventory.ts';

export {
	AUDIO_EDITOR_SUPPLEMENTAL_SHORTCUT_BINDINGS_BY_ACTION,
	AUDACITY_SHORTCUT_BINDINGS_BY_ACTION,
	audacityPrimaryShortcut,
	audioEditorPrimaryShortcut,
} from './audacity-shortcut-bindings.ts';

export const AUDACITY_SHORTCUT_DISPOSITION = Object.freeze({
	ACTION: 'action',
	NATIVE: 'native',
	UNAVAILABLE: 'unavailable',
} as const);

export type AudacityShortcutDisposition = (
	typeof AUDACITY_SHORTCUT_DISPOSITION
)[keyof typeof AUDACITY_SHORTCUT_DISPOSITION];

export type AudacityShortcutSourceStatus = 'live' | 'metadata-only' | 'stale';
export type AudacityShortcutBehavior = 'command' | 'tap-hold';
export type AudacityShortcutUnavailableReason = 'platform-policy' | 'retired' | 'unsupported';

export interface AudacityShortcutProfileEntry extends AudacityShortcutRecord {
	readonly disposition: AudacityShortcutDisposition;
	readonly actionId: string | null;
	readonly behavior: AudacityShortcutBehavior | null;
	readonly reason: AudacityShortcutUnavailableReason | 'browser-native' | null;
	readonly sourceStatus: AudacityShortcutSourceStatus;
}

type ActionDefinition = Readonly<{
	id: string;
	status: string;
	handler: string | null;
	shortcut: string | null;
	origin: string;
}>;

const definitions = new Map<string, ActionDefinition>(
	AUDACITY_ACTION_DEFINITIONS.map((definition: ActionDefinition) => [definition.id, definition]),
);

/*
 * Several Audacity source actions share one physical chord and rely on UI
 * context. Soundscaper gives each such chord one canonical command whose
 * runtime delegates to the selected clip, selection, or transport primitive.
 */
const CONTEXTUAL_ACTION_TARGETS: Readonly<Record<string, string>> = Object.freeze({
	'nav-next-section': 'track-view-next-panel',
	'nav-prev-section': 'track-view-prev-panel',
	'nav-next-panel': 'track-view-next-panel',
	'nav-prev-panel': 'track-view-prev-panel',
	'sel-start': 'select-track-start-to-cursor',
	'sel-end': 'select-cursor-to-track-end',
	'curs-project-start': 'action://playback/rewind-start',
	'curs-project-end': 'action://playback/rewind-end',
	'seek-left-short': 'play-position-decrease',
	'seek-right-short': 'play-position-increase',
	'seek-left-long': 'track-view-item-extend-left',
	'seek-right-long': 'track-view-item-extend-right',
	'mix-and-render-to-new-track': 'mix-render',
	'track-close': 'remove-tracks',
	'action://record/stop': 'action://playback/toggle-play-stop',
	'sel-ext-left': 'track-view-item-extend-left',
	'sel-ext-right': 'track-view-item-extend-right',
	'sel-cntr-right': 'track-view-item-reduce-left',
	'sel-cntr-left': 'track-view-item-reduce-right',
	'pitch-up': 'realtime-effect-move-up',
	'pitch-down': 'realtime-effect-move-down',
});

const BROWSER_NATIVE_ACTION_IDS = new Set([
	'nav-next-tab',
	'nav-prev-tab',
	'nav-right',
	'nav-left',
	'nav-up',
	'nav-down',
	'nav-first-control',
	'nav-last-control',
	'nav-nextrow-control',
	'nav-prevrow-control',
	'action://cancel',
	'action://enter',
	'action://trigger',
]);

const PLATFORM_POLICY_ACTION_IDS = new Set([
	'quit',
	'prev-window',
	'next-window',
	'input-device',
	'output-device',
	'audio-host',
	'input-channels',
]);

const RETIRED_ACTION_IDS = new Set([
	'prev-tool',
	'next-tool',
	'keyboard-scrub-backwards',
	'keyboard-scrub-forwards',
]);

const UNSUPPORTED_ACTION_IDS = new Set([
	'sel-sync-lock-tracks',
	'curs-track-start',
	'curs-track-end',
	'track-pan',
	'track-gain',
	'play-stop-select',
	'once-play-stop',
	'play-one-sec',
	'play-to-selection',
	'play-before-selection-start',
	'play-after-selection-start',
	'play-before-selection-end',
	'play-after-selection-end',
	'play-before-and-after-selection-start',
	'play-before-and-after-selection-end',
	'play-cut-preview',
	'move-to-prev-label',
	'move-to-next-label',
	'multi-tool',
	'collapse-all-tracks',
]);

const STALE_ACTION_IDS = new Set([
	'timer-record', 'contrast-analyser', 'sel-prev-clip', 'sel-next-clip', 'trim', 'split-new',
	'preferences', 'add-label-playing', 'prev-frame', 'toggle', 'toggle-alt', 'select-none',
	'sel-sync-lock-tracks', 'sel-start', 'sel-end', 'curs-track-start', 'curs-track-end',
	'curs-project-start', 'curs-project-end', 'cursor-short-jump-left', 'cursor-short-jump-right',
	'cursor-long-jump-left', 'cursor-long-jump-right', 'seek-left-short', 'seek-right-short',
	'seek-left-long', 'seek-right-long', 'mix-and-render-to-new-track', 'mute-all-tracks',
	'unmute-all-tracks', 'mute-tracks', 'unmute-tracks', 'track-pan', 'track-pan-left',
	'track-pan-right', 'track-gain', 'track-gain-inc', 'track-gain-dec', 'track-menu',
	'track-mute', 'track-solo', 'track-close', 'play-stop-select', 'once-play-stop',
	'play-one-sec', 'play-to-selection', 'play-before-selection-start', 'play-after-selection-start',
	'play-before-selection-end', 'play-after-selection-end', 'play-before-and-after-selection-start',
	'play-before-and-after-selection-end', 'play-cut-preview', 'move-to-prev-label',
	'move-to-next-label', 'zoom-normal', 'zoom-sel', 'fit-v', 'skip-sel-start', 'skip-sel-end',
	'input-device', 'output-device', 'audio-host', 'input-channels', 'select-tool', 'draw-tool',
	'multi-tool', 'prev-tool', 'next-tool', 'pitch-up', 'pitch-down', 'keyboard-scrub-backwards',
	'keyboard-scrub-forwards',
]);

const METADATA_ONLY_ACTION_IDS = new Set([
	'prev-window',
	'next-window',
	'collapse-all-tracks',
	'toggle-spectral-selection',
]);

function sourceStatus(upstreamActionId: string): AudacityShortcutSourceStatus {
	if (STALE_ACTION_IDS.has(upstreamActionId)) return 'stale';
	if (METADATA_ONLY_ACTION_IDS.has(upstreamActionId)) return 'metadata-only';
	return 'live';
}

function canonicalActionId(upstreamActionId: string): string {
	return CONTEXTUAL_ACTION_TARGETS[upstreamActionId]
		|| AUDACITY_ACTION_ALIASES[upstreamActionId]
		|| upstreamActionId;
}

function profileEntry(record: AudacityShortcutRecord): AudacityShortcutProfileEntry {
	const { upstreamActionId } = record;
	const common = {
		...record,
		sourceStatus: sourceStatus(upstreamActionId),
	};
	if (BROWSER_NATIVE_ACTION_IDS.has(upstreamActionId)) {
		return Object.freeze({
			...common,
			disposition: AUDACITY_SHORTCUT_DISPOSITION.NATIVE,
			actionId: null,
			behavior: null,
			reason: 'browser-native',
		});
	}
	for (const [ids, reason] of [
		[PLATFORM_POLICY_ACTION_IDS, 'platform-policy'],
		[RETIRED_ACTION_IDS, 'retired'],
		[UNSUPPORTED_ACTION_IDS, 'unsupported'],
	] as const) {
		if (!ids.has(upstreamActionId)) continue;
		return Object.freeze({
			...common,
			disposition: AUDACITY_SHORTCUT_DISPOSITION.UNAVAILABLE,
			actionId: null,
			behavior: null,
			reason,
		});
	}

	const actionId = canonicalActionId(upstreamActionId);
	const definition = definitions.get(actionId);
	if (!definition || definition.status !== AUDACITY_ACTION_STATUS.IMPLEMENTED || !definition.handler) {
		throw new Error(`Audacity shortcut ${upstreamActionId} has no reviewed disposition.`);
	}
	return Object.freeze({
		...common,
		disposition: AUDACITY_SHORTCUT_DISPOSITION.ACTION,
		actionId,
		behavior: upstreamActionId === 'split-tool' ? 'tap-hold' : 'command',
		reason: null,
	});
}

export const AUDACITY_SHORTCUT_PROFILE: readonly AudacityShortcutProfileEntry[] = Object.freeze(
	AUDACITY_SHORTCUT_INVENTORY.map(profileEntry),
);
