/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	isCurrentProjectSchemaIdentity,
} from '../project-schema-identity.ts';

export const FRAMESCAPER_FINISHING_SURFACES = Object.freeze([
	'visual-inspector', 'color-management', 'grading-presets', 'motion-tracking', 'stabilization',
	'denoise', 'captions', 'automation', 'mixer', 'dialogue-chain',
] as const);

export type FramescaperFinishingSurface =
	(typeof FRAMESCAPER_FINISHING_SURFACES)[number];

const SURFACE_PREFIX = 'framescaper-finishing:';

export function framescaperFinishingSurfaceId(surface: FramescaperFinishingSurface): string {
	if (!FRAMESCAPER_FINISHING_SURFACES.includes(surface)) {
		throw new RangeError('The Framescaper finishing surface is unsupported.');
	}
	return `${SURFACE_PREFIX}${surface}`;
}

export function framescaperFinishingSurface(value: unknown): FramescaperFinishingSurface | null {
	if (typeof value !== 'string' || !value.startsWith(SURFACE_PREFIX)) return null;
	const surface = value.slice(SURFACE_PREFIX.length);
	return (FRAMESCAPER_FINISHING_SURFACES as readonly string[]).includes(surface)
		? surface as FramescaperFinishingSurface : null;
}

export interface FramescaperFinishingMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly items?: readonly FramescaperFinishingMenuItem[];
	onClick?(): unknown;
}

export interface FramescaperFinishingMenuItems {
	readonly tracks: readonly FramescaperFinishingMenuItem[];
	readonly effect: readonly FramescaperFinishingMenuItem[];
	readonly analyze: readonly FramescaperFinishingMenuItem[];
	readonly mixer: readonly FramescaperFinishingMenuItem[];
	readonly tools: readonly FramescaperFinishingMenuItem[];
}

export interface FramescaperFinishingMenuInput {
	readonly productId: string;
	readonly project: unknown;
	readonly capabilities: Readonly<Record<string, unknown>>;
	readonly editingBlocked: boolean;
	readonly readOnly?: boolean;
	readonly copy?: Readonly<Record<string, string | undefined>>;
}

const EMPTY: FramescaperFinishingMenuItems = Object.freeze({
	tracks: Object.freeze([]), effect: Object.freeze([]), analyze: Object.freeze([]),
	mixer: Object.freeze([]), tools: Object.freeze([]),
});

/** Current Framescaper's menu-only, lazy finishing entry points. */
export function createFramescaperFinishingMenuItems(
	input: FramescaperFinishingMenuInput,
	actions: Readonly<{ open(surface: FramescaperFinishingSurface): unknown }>,
): FramescaperFinishingMenuItems {
	if (input.productId !== 'framescaper'
		|| !isCurrentProjectSchemaIdentity(input.project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY)) return EMPTY;
	const mutable = !input.editingBlocked && input.readOnly !== true;
	const copy = input.copy ?? {};
	const leaf = (
		id: string,
		labelKey: string,
		fallback: string,
		surface: FramescaperFinishingSurface,
		capability: string,
	): FramescaperFinishingMenuItem => {
		const enabled = mutable && input.capabilities[capability] === true;
		return Object.freeze({
			id, label: copy[labelKey] ?? fallback, disabled: !enabled,
			onClick: () => enabled ? actions.open(surface) : undefined,
		});
	};
	const selectedLeaf = (
		id: string,
		labelKey: string,
		fallback: string,
		surface: FramescaperFinishingSurface,
	): FramescaperFinishingMenuItem => Object.freeze({
		id, label: copy[labelKey] ?? fallback, disabled: !mutable,
		onClick: () => mutable ? actions.open(surface) : undefined,
	});
	const videoFinishing = branch(
		'framescaper-video-finishing', copy.framescaperVideoFinishing ?? 'Video Finishing', [
			leaf('framescaper-visual-inspector', 'videoVisualInspector',
				'Selected Visual Inspector…', 'visual-inspector', 'videoGenerators'),
			leaf('framescaper-color-management', 'videoColorManagement',
				'Managed Color & Source Interpretation…', 'color-management', 'videoColorManagement'),
			leaf('framescaper-grading-presets', 'videoGradingPresets',
				'Grading & Finishing Presets…', 'grading-presets', 'videoGrading'),
			leaf('framescaper-stabilization', 'videoStabilization',
				'Similarity Stabilization…', 'stabilization', 'videoStabilization'),
			leaf('framescaper-denoise', 'videoDenoise',
				'Spatial & Temporal Denoise…', 'denoise', 'videoDenoise'),
		],
	);
	return Object.freeze({
		tracks: Object.freeze([
			leaf('framescaper-caption-tracks', 'videoCaptionTracks',
				'Caption Tracks…', 'captions', 'videoCaptions'),
			leaf('framescaper-audio-automation', 'automation',
				'Automation Lanes…', 'automation', 'audioAutomation'),
		]),
		effect: Object.freeze([videoFinishing]),
		analyze: Object.freeze([
			leaf('framescaper-motion-tracking', 'videoMotionTracking',
				'Motion Tracking…', 'motion-tracking', 'videoMotionTracking'),
		]),
		mixer: Object.freeze([
			leaf('framescaper-mixer', 'routingGraph', 'Mixer & Routing…', 'mixer', 'audioMixerGraph'),
			selectedLeaf('framescaper-dialogue-chain', 'dialogueChain',
				'Dialogue Chain…', 'dialogue-chain'),
		]),
		tools: Object.freeze([]),
	});
}

function branch(
	id: string,
	label: string,
	items: readonly FramescaperFinishingMenuItem[],
): FramescaperFinishingMenuItem {
	return Object.freeze({ id, label, disabled: items.every(({ disabled }) => disabled),
		items: Object.freeze([...items]) });
}
