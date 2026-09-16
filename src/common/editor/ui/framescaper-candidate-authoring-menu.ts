/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_MENUS_ADDITIONAL_COPY } from '../../i18n/editor-framescaper-menus-additional-copy.ts';

import type {
	FramescaperCandidateAuthoringSurface,
} from './framescaper-candidate-authoring-actions.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from '../project-schema-identity.ts';

export interface FramescaperCandidateAuthoringMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly items?: readonly FramescaperCandidateAuthoringMenuItem[];
	onClick?(): unknown;
}

export interface FramescaperCandidateAuthoringMenuItems {
	readonly tracks: readonly FramescaperCandidateAuthoringMenuItem[];
	readonly generate: readonly FramescaperCandidateAuthoringMenuItem[];
	readonly effect: readonly FramescaperCandidateAuthoringMenuItem[];
}

export interface FramescaperCandidateAuthoringMenuInput {
	readonly productId: string;
	readonly project: unknown;
	readonly projectCapabilities?: Readonly<Record<string, unknown>>;
	readonly actionSurfaces?: readonly FramescaperCandidateAuthoringSurface[];
	readonly editingBlocked: boolean;
	readonly readOnly?: boolean;
	readonly copy?: Readonly<Record<string, string | undefined>>;
}

const EMPTY: FramescaperCandidateAuthoringMenuItems = Object.freeze({
	tracks: Object.freeze([]), generate: Object.freeze([]), effect: Object.freeze([]),
});

/** Current-family Framescaper authoring entries; Soundscaper returns no rows. */
export function createFramescaperCandidateAuthoringMenuItems(
	input: FramescaperCandidateAuthoringMenuInput,
	actions: Readonly<{ open(surface: FramescaperCandidateAuthoringSurface): unknown }>,
): FramescaperCandidateAuthoringMenuItems {
	if (input.productId !== 'framescaper'
		|| !isCurrentProjectSchemaIdentity(input.project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY)) return EMPTY;
	const mutable = !input.editingBlocked && input.readOnly !== true;
	const copy = input.copy ?? {};
	const leaf = (
		id: string,
		labelKey: string,
		fallback: string,
		surface: FramescaperCandidateAuthoringSurface,
		capability: string,
	): FramescaperCandidateAuthoringMenuItem => {
		const enabled = mutable && input.projectCapabilities?.[capability] === true
			&& input.actionSurfaces?.includes(surface) === true;
		return Object.freeze({
			id, label: copy[`ui.framescaperMenus.${labelKey}`] ?? copy[labelKey] ?? fallback, disabled: !enabled,
			onClick: () => enabled ? actions.open(surface) : undefined,
		});
	};
	const transitions = branch(
		'framescaper-video-transitions', copy['ui.framescaperMenus.videoTransitions'] ?? copy.videoTransitions ?? FRAMESCAPER_MENUS_ADDITIONAL_COPY.videoTransitions, [
			leaf('framescaper-add-video-transition', 'addVideoTransition', FRAMESCAPER_MENUS_ADDITIONAL_COPY.addVideoTransition,
				'video-transition', 'videoTransitions'),
			leaf('framescaper-add-dissolve-transition', 'addDissolveTransition', FRAMESCAPER_MENUS_ADDITIONAL_COPY.addDissolveTransition,
				'video-transition-dissolve', 'videoTransitionDissolve'),
		],
	);
	const generators = branch(
		'framescaper-video-generators', copy['ui.framescaperMenus.videoGenerators'] ?? copy.videoGenerators ?? FRAMESCAPER_MENUS_ADDITIONAL_COPY.videoGenerators, [
			leaf('framescaper-add-video-title', 'addVideoTitle', FRAMESCAPER_MENUS_ADDITIONAL_COPY.addVideoTitle,
				'video-title', 'videoGenerators'),
			leaf('framescaper-add-video-text', 'addVideoText', FRAMESCAPER_MENUS_ADDITIONAL_COPY.addVideoText,
				'video-text', 'videoGenerators'),
			leaf('framescaper-add-video-shape', 'addVideoShape', FRAMESCAPER_MENUS_ADDITIONAL_COPY.addVideoShape,
				'video-shape', 'videoGenerators'),
			leaf('framescaper-add-video-solid', 'addVideoSolid', FRAMESCAPER_MENUS_ADDITIONAL_COPY.addVideoSolid,
				'video-solid', 'videoGenerators'),
			leaf('framescaper-save-video-visual-preset', 'saveVideoVisualPreset',
				FRAMESCAPER_MENUS_ADDITIONAL_COPY.saveVideoVisualPreset, 'video-visual-preset', 'videoGenerators'),
		],
	);
	return Object.freeze({
		tracks: Object.freeze([
			leaf('framescaper-add-video-adjustment-layer', 'addVideoAdjustmentLayer',
				FRAMESCAPER_MENUS_ADDITIONAL_COPY.addVideoAdjustmentLayer, 'video-adjustment-layer', 'videoAdjustmentLayers'),
		]),
		generate: Object.freeze([
			leaf('framescaper-add-video-still', 'addVideoStill', FRAMESCAPER_MENUS_ADDITIONAL_COPY.addVideoStill,
				'video-still', 'videoStills'),
			generators,
		]),
		effect: Object.freeze([
			transitions,
			leaf('framescaper-edit-video-mask-matte', 'editVideoMaskMatte', FRAMESCAPER_MENUS_ADDITIONAL_COPY.editVideoMaskMatte,
				'video-mask-matte', 'videoMasksMattes'),
			leaf('framescaper-freeze-video', 'freezeVideo', FRAMESCAPER_MENUS_ADDITIONAL_COPY.freezeVideo,
				'video-freeze', 'videoFreeze'),
		]),
	});
}

function branch(
	id: string,
	label: string,
	items: readonly FramescaperCandidateAuthoringMenuItem[],
): FramescaperCandidateAuthoringMenuItem {
	return Object.freeze({ id, label, disabled: items.every(({ disabled }) => disabled),
		items: Object.freeze([...items]) });
}
