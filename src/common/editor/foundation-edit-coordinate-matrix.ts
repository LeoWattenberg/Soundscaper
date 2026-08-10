/* SPDX-License-Identifier: AGPL-3.0-only */

export const FOUNDATION_EDIT_PRIMITIVES = Object.freeze([
	'move',
	'ripple',
	'roll',
	'slip',
	'slide',
	'split',
	'paste',
	'duplicate',
	'range-delete',
	'insert',
	'overwrite',
	'replace',
] as const);

export type FoundationEditPrimitive = typeof FOUNDATION_EDIT_PRIMITIVES[number];

export interface FoundationEditCoordinateRule {
	readonly primitive: FoundationEditPrimitive;
	readonly audioPlacement: string;
	readonly audioExtent: string;
	readonly audioSourceRange: string;
	readonly videoPlacement: string;
	readonly videoExtent: string;
	readonly videoSourceRange: string;
	readonly operationConformance: string;
	readonly implementation: readonly string[];
}

/**
 * Reviewable authority matrix for the foundation edit protocol.
 *
 * Every command cited below receives resolved-sample projections. The v10
 * reconciliation boundary converts each edited coordinate back into its one
 * persisted authority domain and recomputes an A/V link's shared presentation
 * endpoints from its video member.
 */
export const FOUNDATION_EDIT_COORDINATE_MATRIX: Readonly<
	Record<FoundationEditPrimitive, Readonly<FoundationEditCoordinateRule>>
> = deepFreeze({
	move: {
		primitive: 'move',
		audioPlacement: 'Add the operation resolved-sample delta; convert the anchor to beats only for musical placement.',
		audioExtent: 'Unchanged, except linked audio is recomputed from the conformed video endpoints.',
		audioSourceRange: 'Unchanged.',
		videoPlacement: 'Apply one operation delta as an integer sequence-frame delta.',
		videoExtent: 'Unchanged in sequence frames.',
		videoSourceRange: 'Unchanged in source frames.',
		operationConformance: 'If video participates, conform the requested destination once to its sequence grid; otherwise retain sample resolution.',
		implementation: ['commands/clip-basic-runtime.js', 'commands/clip-transform-runtime.js'],
	},
	ripple: {
		primitive: 'ripple',
		audioPlacement: 'Shift following unlinked audio by the operation resolved-sample delta.',
		audioExtent: 'Preserve surviving extents; linked audio follows conformed video endpoints.',
		audioSourceRange: 'Trimmed survivors map once from their absolute cut boundaries.',
		videoPlacement: 'Shift following video in integer sequence frames.',
		videoExtent: 'Survivors retain integer sequence-frame counts.',
		videoSourceRange: 'Trimmed survivors retain integer source-frame boundaries.',
		operationConformance: 'A video-bearing ripple conforms the deleted span at operation level before shifting all affected lanes.',
		implementation: ['commands/range-runtime.js'],
	},
	roll: {
		primitive: 'roll',
		audioPlacement: 'Move the shared edit point in samples; keep the outer boundaries fixed.',
		audioExtent: 'Recompute both adjacent extents from absolute boundaries.',
		audioSourceRange: 'Move the adjoining source out/in boundaries by the mapped source delta.',
		videoPlacement: 'Move the shared edit point to one integer sequence-frame boundary.',
		videoExtent: 'Recompute adjacent integer sequence-frame counts.',
		videoSourceRange: 'Move adjoining integer source-frame boundaries.',
		operationConformance: 'Conform the shared boundary once, never each neighboring extent independently.',
		implementation: ['commands/clip-transform-runtime.js'],
	},
	slip: {
		primitive: 'slip',
		audioPlacement: 'Unchanged.',
		audioExtent: 'Unchanged.',
		audioSourceRange: 'Apply the source-sample delta within source bounds.',
		videoPlacement: 'Unchanged.',
		videoExtent: 'Unchanged.',
		videoSourceRange: 'Apply the delta in integer source-frame/PTS space, not the sequence grid.',
		operationConformance: 'The source domain owns the delta; no timeline conversion is accumulated.',
		implementation: ['commands/clip-transform-runtime.js'],
	},
	slide: {
		primitive: 'slide',
		audioPlacement: 'Move the center clip by one resolved-sample delta.',
		audioExtent: 'Recompute neighboring extents from fixed outer boundaries.',
		audioSourceRange: 'Move neighbor source boundaries by their mapped deltas.',
		videoPlacement: 'Move the center clip by one integer sequence-frame delta.',
		videoExtent: 'Recompute neighboring integer sequence-frame counts.',
		videoSourceRange: 'Move neighbor integer source-frame boundaries.',
		operationConformance: 'Conform the center move once and reuse its absolute endpoints for both neighboring edits.',
		implementation: ['commands/clip-transform-runtime.js'],
	},
	split: {
		primitive: 'split',
		audioPlacement: 'Resolve one absolute split sample; the right clip begins at that boundary.',
		audioExtent: 'Derive left/right extents by subtracting absolute boundaries.',
		audioSourceRange: 'Map the split once through the clip source ratio.',
		videoPlacement: 'Conform the split once to an integer sequence-frame boundary.',
		videoExtent: 'Derive both sequence-frame counts from the shared boundary.',
		videoSourceRange: 'Map once into integer source-frame/PTS space.',
		operationConformance: 'A linked pair uses the video-conformed boundary for both members.',
		implementation: ['commands/clip-link-runtime.js'],
	},
	paste: {
		primitive: 'paste',
		audioPlacement: 'Scale clipboard-relative offsets once, then add the absolute sample anchor.',
		audioExtent: 'Scale the clipboard extent once at the destination sample rate.',
		audioSourceRange: 'Preserve source authority; source samples are not destination-rate timeline samples.',
		videoPlacement: 'Conform each pasted lane group from its shared destination anchor to sequence frames.',
		videoExtent: 'Convert clipboard absolute endpoints and subtract in sequence-frame space.',
		videoSourceRange: 'Preserve integer source-frame/PTS ranges.',
		operationConformance: 'One destination anchor owns the paste; linked audio is recomputed from the pasted video endpoints.',
		implementation: ['commands/clipboard-runtime.js', 'commands/timeline-annotation-clipboard.ts'],
	},
	duplicate: {
		primitive: 'duplicate',
		audioPlacement: 'Use the selection end as the single paste anchor.',
		audioExtent: 'Identical to paste.',
		audioSourceRange: 'Identical to paste.',
		videoPlacement: 'Use the selection end conformed once to the sequence grid.',
		videoExtent: 'Identical to paste.',
		videoSourceRange: 'Identical to paste.',
		operationConformance: 'Duplicate is descriptor creation plus the paste rule; it has no second delta path.',
		implementation: ['controller/edit-service.ts', 'commands/clipboard-runtime.js', 'commands/timeline-annotation-clipboard.ts'],
	},
	'range-delete': {
		primitive: 'range-delete',
		audioPlacement: 'Lift keeps absolute placement; ripple shifts survivors by the resolved deleted span.',
		audioExtent: 'Derive surviving extents from absolute range boundaries.',
		audioSourceRange: 'Map cut boundaries once into source samples.',
		videoPlacement: 'Lift keeps frame placement; ripple shifts survivors by one conformed sequence-frame span.',
		videoExtent: 'Derive surviving integer sequence-frame counts.',
		videoSourceRange: 'Map cut boundaries once into integer source frames.',
		operationConformance: 'The selected range is conformed once per participating sequence; linked audio follows video endpoints.',
		implementation: ['commands/range-runtime.js'],
	},
	insert: {
		primitive: 'insert',
		audioPlacement: 'Shift audio at or after the insert point by the resolved sample span; a clip the point falls inside is split and its tail moves with the rest.',
		audioExtent: 'Survivors keep their extents; the placed clip takes the resolved span, and linked audio is recomputed from the conformed video endpoints.',
		audioSourceRange: 'The placed clip carries the resolved source range; split survivors map their new boundary once.',
		videoPlacement: 'Shift video at or after the insert point by one conformed sequence-frame span, on every media lane in the sequence.',
		videoExtent: 'The placed clip takes the conformed sequence-frame span; survivors retain their integer counts.',
		videoSourceRange: 'The placed clip carries the resolved integer source-frame range; split survivors retain integer boundaries.',
		operationConformance: 'The span is conformed once per sequence and every lane opens by exactly that span, because shifting only the targeted lanes would desynchronise the rest.',
		implementation: ['commands/three-point-edit-runtime.js'],
	},
	overwrite: {
		primitive: 'overwrite',
		audioPlacement: 'Unchanged for every lane; the targeted lane keeps absolute placement and receives the new clip at the resolved start.',
		audioExtent: 'The lifted range yields surviving extents from its absolute boundaries; the placed clip takes the resolved span.',
		audioSourceRange: 'Lifted survivors map their cut boundaries once; the placed clip carries the resolved source range.',
		videoPlacement: 'The targeted lane keeps frame placement; the placed clip starts at the conformed sequence frame.',
		videoExtent: 'Surviving integer sequence-frame counts derive from the conformed range; the placed clip takes its span.',
		videoSourceRange: 'The placed clip carries the resolved integer source-frame range.',
		operationConformance: 'The range is conformed once per sequence and only the lanes that receive material are disturbed.',
		implementation: ['commands/three-point-edit-runtime.js'],
	},
	replace: {
		primitive: 'replace',
		audioPlacement: 'Unchanged: the replaced clip keeps the absolute placement it already had.',
		audioExtent: 'Unchanged; the replacement takes the extent of the clip it stands in for.',
		audioSourceRange: 'The replacement carries the source range that extent implies from the monitor position.',
		videoPlacement: 'Unchanged: the replaced clip keeps its sequence frame.',
		videoExtent: 'Unchanged in sequence frames; only the media behind those frames changes.',
		videoSourceRange: 'The source in is the source monitor playhead, and the count is the clip extent converted once as a change of basis.',
		operationConformance: 'Replace is overwrite whose range is the replaced clip own resolved range rather than a selection, so it adds no second conforming rule; a source too short to supply that range refuses instead of clamping.',
		implementation: ['controller/video-edit-service.ts', 'commands/three-point-edit-runtime.js'],
	},
});

function deepFreeze<Value>(value: Value): Readonly<Value> {
	if (!value || typeof value !== 'object') return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}
