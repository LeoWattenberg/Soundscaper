/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperCandidateAuthoringSurface,
} from './framescaper-candidate-authoring-actions.ts';

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

const TRANSITION_SCHEMAS = new Set([22, 24, 25, 26, 27, 28, 31]);
const VISUAL_SCHEMAS = new Set([24, 25, 26, 27, 28, 31]);

/** Generation-owned menu entries. V20 and every Soundscaper generation return no rows. */
export function createFramescaperCandidateAuthoringMenuItems(
	input: FramescaperCandidateAuthoringMenuInput,
	actions: Readonly<{ open(surface: FramescaperCandidateAuthoringSurface): unknown }>,
): FramescaperCandidateAuthoringMenuItems {
	const schemaVersion = projectSchemaVersion(input.project);
	if (input.productId !== 'framescaper' || schemaVersion === null
		|| !TRANSITION_SCHEMAS.has(schemaVersion)) return EMPTY;
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
			id, label: copy[labelKey] ?? fallback, disabled: !enabled,
			onClick: () => enabled ? actions.open(surface) : undefined,
		});
	};
	const transitions = branch(
		'framescaper-video-transitions', copy.videoTransitions ?? 'Video Transitions', [
			leaf('framescaper-add-video-transition', 'addVideoTransition', 'Add Video Transition…',
				'video-transition', 'videoTransitions'),
			leaf('framescaper-add-dissolve-transition', 'addDissolveTransition', 'Add Dissolve Transition',
				'video-transition-dissolve', 'videoTransitionDissolve'),
		],
	);
	if (!VISUAL_SCHEMAS.has(schemaVersion)) {
		return Object.freeze({ tracks: Object.freeze([]), generate: Object.freeze([]),
			effect: Object.freeze([transitions]) });
	}
	const selectedV27 = schemaVersion === 27 || schemaVersion === 28 || schemaVersion === 31;
	const generators = branch(
		'framescaper-video-generators', copy.videoGenerators ?? 'Video Generators', [
			leaf('framescaper-add-video-title', 'addVideoTitle', 'Add Title/Text…',
				'video-title', 'videoGenerators'),
			...(selectedV27 ? [leaf('framescaper-add-video-text', 'addVideoText', 'Add Text…',
				'video-text', 'videoGenerators')] : []),
			leaf('framescaper-add-video-shape', 'addVideoShape', 'Add Shape…',
				'video-shape', 'videoGenerators'),
			leaf('framescaper-add-video-solid', 'addVideoSolid', 'Add Solid…',
				'video-solid', 'videoGenerators'),
			...(selectedV27 ? [leaf('framescaper-save-video-visual-preset', 'saveVideoVisualPreset',
				'Save Visual Preset…', 'video-visual-preset', 'videoGenerators')] : [
				leaf('framescaper-add-external-video-generator', 'addExternalVideoGenerator',
					'Add External Generator…', 'video-external-generator', 'videoGenerators'),
			]),
		],
	);
	return Object.freeze({
		tracks: Object.freeze([
			leaf('framescaper-add-video-adjustment-layer', 'addVideoAdjustmentLayer',
				'Add Video Adjustment Layer…', 'video-adjustment-layer', 'videoAdjustmentLayers'),
		]),
		generate: Object.freeze([
			leaf('framescaper-add-video-still', 'addVideoStill', 'Add Images…',
				'video-still', 'videoStills'),
			generators,
		]),
		effect: Object.freeze([
			transitions,
			leaf('framescaper-edit-video-mask-matte', 'editVideoMaskMatte', 'Edit Video Mask/Matte…',
				'video-mask-matte', 'videoMasksMattes'),
			leaf('framescaper-freeze-video', 'freezeVideo', 'Freeze Video…',
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

function projectSchemaVersion(value: unknown): number | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& Number.isSafeInteger(descriptor.value) ? Number(descriptor.value) : null;
}
