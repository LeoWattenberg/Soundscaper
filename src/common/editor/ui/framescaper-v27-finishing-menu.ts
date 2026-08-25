/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_V27_FINISHING_SURFACES = Object.freeze([
	'visual-inspector', 'color-management', 'grading-presets', 'motion-tracking', 'stabilization',
	'denoise', 'captions', 'automation', 'mixer', 'dialogue-chain',
] as const);

export type FramescaperV27FinishingSurface =
	(typeof FRAMESCAPER_V27_FINISHING_SURFACES)[number];

const SURFACE_PREFIX = 'framescaper-v27-finishing:';

export function framescaperV27FinishingSurfaceId(surface: FramescaperV27FinishingSurface): string {
	if (!FRAMESCAPER_V27_FINISHING_SURFACES.includes(surface)) {
		throw new RangeError('The Framescaper V27 finishing surface is unsupported.');
	}
	return `${SURFACE_PREFIX}${surface}`;
}

export function framescaperV27FinishingSurface(value: unknown): FramescaperV27FinishingSurface | null {
	if (typeof value !== 'string' || !value.startsWith(SURFACE_PREFIX)) return null;
	const surface = value.slice(SURFACE_PREFIX.length);
	return (FRAMESCAPER_V27_FINISHING_SURFACES as readonly string[]).includes(surface)
		? surface as FramescaperV27FinishingSurface : null;
}

export interface FramescaperV27FinishingMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
	readonly items?: readonly FramescaperV27FinishingMenuItem[];
	onClick?(): unknown;
}

export interface FramescaperV27FinishingMenuItems {
	readonly tracks: readonly FramescaperV27FinishingMenuItem[];
	readonly effect: readonly FramescaperV27FinishingMenuItem[];
	readonly analyze: readonly FramescaperV27FinishingMenuItem[];
	readonly mixer: readonly FramescaperV27FinishingMenuItem[];
	readonly tools: readonly FramescaperV27FinishingMenuItem[];
}

export interface FramescaperV27FinishingMenuInput {
	readonly productId: string;
	readonly project: unknown;
	readonly capabilities: Readonly<Record<string, unknown>>;
	readonly editingBlocked: boolean;
	readonly readOnly?: boolean;
	readonly copy?: Readonly<Record<string, string | undefined>>;
}

const EMPTY: FramescaperV27FinishingMenuItems = Object.freeze({
	tracks: Object.freeze([]), effect: Object.freeze([]), analyze: Object.freeze([]),
	mixer: Object.freeze([]), tools: Object.freeze([]),
});

/** Selected V27's menu-only, lazy finishing entry points. */
export function createFramescaperV27FinishingMenuItems(
	input: FramescaperV27FinishingMenuInput,
	actions: Readonly<{ open(surface: FramescaperV27FinishingSurface): unknown }>,
): FramescaperV27FinishingMenuItems {
	const projectSchema = schema(input.project);
	if (input.productId !== 'framescaper'
		|| (projectSchema !== 27 && projectSchema !== 28 && projectSchema !== 31)) return EMPTY;
	const mutable = !input.editingBlocked && input.readOnly !== true;
	const copy = input.copy ?? {};
	const leaf = (
		id: string,
		labelKey: string,
		fallback: string,
		surface: FramescaperV27FinishingSurface,
		capability: string,
	): FramescaperV27FinishingMenuItem => {
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
		surface: FramescaperV27FinishingSurface,
	): FramescaperV27FinishingMenuItem => Object.freeze({
		id, label: copy[labelKey] ?? fallback, disabled: !mutable,
		onClick: () => mutable ? actions.open(surface) : undefined,
	});
	const videoFinishing = branch(
		'framescaper-v27-video-finishing', copy.framescaperVideoFinishing ?? 'Video Finishing', [
			leaf('framescaper-v27-visual-inspector', 'videoVisualInspector',
				'Selected Visual Inspector…', 'visual-inspector', 'videoGenerators'),
			leaf('framescaper-v27-color-management', 'videoColorManagement',
				'Managed Color & Source Interpretation…', 'color-management', 'videoColorManagement'),
			leaf('framescaper-v27-grading-presets', 'videoGradingPresets',
				'Grading & Finishing Presets…', 'grading-presets', 'videoGrading'),
			leaf('framescaper-v27-stabilization', 'videoStabilization',
				'Similarity Stabilization…', 'stabilization', 'videoStabilization'),
			leaf('framescaper-v27-denoise', 'videoDenoise',
				'Spatial & Temporal Denoise…', 'denoise', 'videoDenoise'),
		],
	);
	return Object.freeze({
		tracks: Object.freeze([
			leaf('framescaper-v27-caption-tracks', 'videoCaptionTracks',
				'Caption Tracks…', 'captions', 'videoCaptions'),
			leaf('framescaper-v27-audio-automation', 'automation',
				'Automation Lanes…', 'automation', 'audioAutomation'),
		]),
		effect: Object.freeze([videoFinishing]),
		analyze: Object.freeze([
			leaf('framescaper-v27-motion-tracking', 'videoMotionTracking',
				'Motion Tracking…', 'motion-tracking', 'videoMotionTracking'),
		]),
		mixer: Object.freeze([
			leaf('framescaper-v27-mixer', 'routingGraph', 'Mixer & Routing…', 'mixer', 'audioMixerGraph'),
			selectedLeaf('framescaper-v27-dialogue-chain', 'dialogueChain',
				'Dialogue Chain…', 'dialogue-chain'),
		]),
		tools: Object.freeze([]),
	});
}

function branch(
	id: string,
	label: string,
	items: readonly FramescaperV27FinishingMenuItem[],
): FramescaperV27FinishingMenuItem {
	return Object.freeze({ id, label, disabled: items.every(({ disabled }) => disabled),
		items: Object.freeze([...items]) });
}

function schema(value: unknown): number | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
		&& Number.isSafeInteger(descriptor.value) ? Number(descriptor.value) : null;
}
