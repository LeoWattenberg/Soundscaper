import {
	AUDACITY_ACTION_STATUS,
	audacityActionDefinition,
	audacityActionReason,
	resolveAudacityActionId,
} from './audacity-action-parity.js';
import { normalizeBcp47Locale } from '../../../i18n/locale.js';

export const AUDACITY_TRACK_CONTEXT_ACTION_IDS = Object.freeze({
	showArmControls: 'local://show-arm-controls',
	duplicate: 'duplicate-track',
	moveTop: 'track-move-top',
	moveUp: 'track-move-up',
	moveDown: 'track-move-down',
	moveBottom: 'track-move-bottom',
	waveform: 'action://trackedit/track-view-waveform',
	spectrogram: 'action://trackedit/track-view-spectrogram',
	multiview: 'action://trackedit/track-view-multi',
	changeColor: 'action://trackedit/track/change-color?colorindex=%1',
	toggleCollapsed: 'local://toggle-track-collapsed',
	remove: 'remove-tracks',
});

export const AUDACITY_CLIP_CONTEXT_ACTION_IDS = Object.freeze({
	properties: 'clip-properties',
	useTrackColor: 'action://trackedit/clip/change-color-auto',
	changeColor: 'action://trackedit/clip/change-color?colorindex=%1',
	split: 'split',
	reverse: 'local://reverse-clip',
	normalizePeak: 'local://normalize-clip-peak',
	renderPitchSpeed: 'clip-render-pitch-speed',
	resetPitchSpeed: 'clip-reset-pitch-speed',
	stretchToTempo: 'stretch-clip-to-match-tempo',
	export: 'clip-export',
	remove: 'action://delete',
});

/**
 * Resolve the manifest contract consumed by a context-menu control. Existing
 * browser-only controls retain stable local IDs and are marked supplemental;
 * they are not misrepresented as pinned Audacity commands.
 */
export function audacityContextMenuAction(actionId, options = {}) {
	const canonicalId = resolveAudacityActionId(String(actionId || ''));
	const definition = audacityActionDefinition(canonicalId);
	if (!definition && !canonicalId.startsWith('local://')) {
		throw new RangeError(`Unknown Audacity context-menu action: ${canonicalId || '(empty)'}.`);
	}
	const locale = normalizeBcp47Locale(options.locale);
	const parityStatus = definition?.status || 'supplemental';
	const manifestDisabled = parityStatus === AUDACITY_ACTION_STATUS.DISABLED_UPSTREAM;
	const hidden = parityStatus === AUDACITY_ACTION_STATUS.EXCLUDED;
	const disabled = hidden || manifestDisabled || Boolean(options.disabled);
	const disabledReason = hidden || manifestDisabled
		? audacityActionReason(canonicalId, locale)
		: disabled ? options.disabledReason || null : null;
	return Object.freeze({
		actionId: definition?.id || canonicalId,
		label: options.label || definition?.label || canonicalId,
		shortcut: options.shortcut ?? definition?.shortcut ?? null,
		parityStatus,
		enableWhen: definition?.enableWhen || null,
		origin: definition?.origin || 'local',
		upstreamAction: definition?.upstreamAction || null,
		disabled,
		disabledReason,
		hidden,
	});
}
