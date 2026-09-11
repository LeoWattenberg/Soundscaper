/* SPDX-License-Identifier: AGPL-3.0-only */

import { EFFECT_MENU_GROUPS } from './application-menu-model.js';
import { audioSelectionEffectAppliesToAllAudio } from '../effects.js';

/** Resolve the explicit or preference-provided audio target used by Effect-menu entries. */
export function resolveEffectMenuTargeting({
	project, preferences, selectedTrack, selectedAudioTrack, selectionActive, clipSelectionActive,
}) {
	const defaultEffectTrack = project?.tracks.find((track) => (
		track.type === 'audio' && track.clipIds?.length
	)) || null;
	const selectionNamesTracks = Boolean(project?.selection?.trackIds?.length);
	const selectionAudioTrack = selectionNamesTracks
		? project.tracks.find((track) => (
			track.type === 'audio' && project.selection.trackIds.includes(track.id)
		)) || null
		: selectedAudioTrack;
	const nonAudioEffectFocus = selectionNamesTracks
		? !selectionAudioTrack
		: Boolean(selectedTrack && selectedTrack.type !== 'audio');
	const effectPreferenceTargetsAll = preferences?.editing?.applyEffectsToAllAudio === true
		&& !clipSelectionActive
		&& !nonAudioEffectFocus
		&& (!selectionActive || !selectionNamesTracks)
		&& Boolean(defaultEffectTrack);
	const explicitEffectSelectionActive = clipSelectionActive
		|| (selectionActive && Boolean(selectionAudioTrack));
	return {
		selectionNamesTracks,
		selectionAudioTrack,
		effectPreferenceTargetsAll,
		explicitEffectSelectionActive,
		effectSelectionActive: explicitEffectSelectionActive || effectPreferenceTargetsAll,
		effectAudioTrack: selectionNamesTracks
			? selectionAudioTrack
			: selectionAudioTrack || (effectPreferenceTargetsAll ? defaultEffectTrack : null),
	};
}

/**
 * The Effect menu's effect entries, either as category submenus or as one
 * alphabetical list.
 *
 * @param {{organization?: string, copy: Record<string, string>, effectLabels: Map<string, string>, productId: string, disabled: boolean, selectionActive?: boolean, allAudioTarget?: boolean, locale?: string}} context
 * @param {(type: string) => unknown} openSelectionEffect
 * @returns {object[]} menu entries to splice into the Effect menu
 */
export function createEffectMenuEntries(context, openSelectionEffect) {
	const { organization, copy, effectLabels, productId, disabled, selectionActive, allAudioTarget, locale } = context;
	const admitted = (type) => effectLabels.has(type)
		&& (type !== 'reviewed-utility-gain' || productId === 'soundscaper');
	const entry = (type) => ({
		id: type,
		label: effectLabels.get(type),
		disabled: disabled || (!selectionActive
			&& !(allAudioTarget && audioSelectionEffectAppliesToAllAudio(type))),
		onClick: () => openSelectionEffect(type),
	});
	if (organization === 'sortby:name') {
		return EFFECT_MENU_GROUPS
			.flatMap(([, types]) => types)
			.filter(admitted)
			.map(entry)
			.sort((left, right) => left.label.localeCompare(right.label, locale || 'en'));
	}
	return EFFECT_MENU_GROUPS.map(([labelKey, types]) => ({
		id: labelKey,
		label: copy[labelKey],
		items: types.filter(admitted).map(entry),
	})).filter((group) => group.items.length);
}
