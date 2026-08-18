/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_OWNED_FEATURE_REQUIREMENT_IDS,
} from './project-owned-feature-requirements.ts';

/**
 * Completing what an AUP4 save says it left behind.
 *
 * The project's own feature manifest already enumerates everything the document
 * holds that a product has to offer to open it. Reading the report off that list
 * rather than off the exporter's memory is what makes the reporting *complete*:
 * a feature added later cannot ship without an AUP4 decision, because the table
 * below has to name it or the completeness fixture fails.
 *
 * Three answers, and the difference matters. `carried` means AUP4 expresses the
 * feature and its own exporter reports whatever it converted on the way.
 * `reported` means the feature does not survive and an existing item already
 * says so — naming that item here is what stops this from reporting the same
 * loss twice. `omitted` means nothing else says it, so this does.
 */

export type Aup4FeatureCarriage = 'carried' | 'reported' | 'omitted';

type OwnedFeatureKey = keyof typeof PROJECT_OWNED_FEATURE_REQUIREMENT_IDS;

interface Aup4FeatureDecision {
	readonly carriage: Aup4FeatureCarriage;
	/** The item that reports this loss: emitted here when omitted, named when reported elsewhere. */
	readonly code: string;
	readonly message?: string;
}

export const AUP4_OWNED_FEATURE_CARRIAGE: Readonly<Record<OwnedFeatureKey, Aup4FeatureDecision>> = Object.freeze({
	audioEffects: Object.freeze({ carriage: 'carried', code: 'MISSING_REALTIME_EFFECT' }),
	videoEffects: Object.freeze({ carriage: 'reported', code: 'VIDEO_OMITTED' }),
	musicalTimeline: Object.freeze({ carriage: 'carried', code: 'TEMPO_MAP_FLATTENED' }),
	timelineAnnotations: Object.freeze({
		carriage: 'carried', code: 'TIMELINE_ANNOTATIONS_FLATTENED_TO_AUDACITY_LABEL_TRACK',
	}),
	trackFolders: Object.freeze({
		carriage: 'omitted',
		code: 'TRACK_FOLDER_STRUCTURE_OMITTED',
		message: 'Audacity has no nested track folders. The tracks were exported in order and their folder structure was omitted.',
	}),
	takeComp: Object.freeze({
		carriage: 'omitted',
		code: 'TAKE_LANES_OMITTED',
		message: 'Audacity has no take lanes. The comped result was exported and the alternate takes were omitted.',
	}),
	audioWarp: Object.freeze({
		carriage: 'omitted',
		code: 'AUDIO_WARP_MAPS_OMITTED',
		message: 'Audacity has no warp maps. The warped timing is baked into the exported clips and the maps themselves were omitted.',
	}),
	audioAutomation: Object.freeze({
		carriage: 'omitted',
		code: 'AUTOMATION_LANES_OMITTED',
		message: 'Audacity has no automation lanes. Only the clip and track envelopes AUP4 understands were exported.',
	}),
	audioMixerGraph: Object.freeze({ carriage: 'reported', code: 'MIXER_ROUTES_OMITTED' }),
	masteringSequences: Object.freeze({
		carriage: 'omitted',
		code: 'MASTERING_SEQUENCES_OMITTED',
		message: 'Audacity has no mastering sequences. The regions were exported as labels and the delivery order was omitted.',
	}),
	sequenceTiming: Object.freeze({
		carriage: 'omitted',
		code: 'SEQUENCE_TIMING_OMITTED',
		message: 'Audacity has one flat timeline. Per-sequence timing was omitted from this exported copy.',
	}),
	videoRetime: Object.freeze({ carriage: 'reported', code: 'VIDEO_OMITTED' }),
	videoTimingAssets: Object.freeze({ carriage: 'reported', code: 'VIDEO_OMITTED' }),
	sourceCharacteristics: Object.freeze({
		carriage: 'omitted',
		code: 'SOURCE_CHARACTERISTICS_OMITTED',
		message: 'Probed source characteristics are not part of AUP4 and were omitted; reopening this copy re-probes its media.',
	}),
});

interface CompatibilityReport {
	readonly items: readonly Readonly<{ code?: unknown }>[];
}

type AddItem = (report: CompatibilityReport, item: Readonly<Record<string, unknown>>) => unknown;

/**
 * Report every owned feature this document holds that AUP4 does not carry.
 *
 * Driven by the document's manifest, so a project that holds nothing reports
 * nothing and a project that holds a feature reports it whether or not the
 * exporter happened to walk the part of the document that carries it.
 */
export function reportAup4OwnedFeatureOmissions(
	project: unknown,
	report: CompatibilityReport,
	addItem: AddItem,
): readonly string[] {
	const declared = new Set(requirementIds(project));
	const already = new Set(report.items.map((item) => String(item.code)));
	const reported: string[] = [];
	for (const [key, id] of Object.entries(PROJECT_OWNED_FEATURE_REQUIREMENT_IDS)) {
		if (!declared.has(id)) continue;
		const decision = AUP4_OWNED_FEATURE_CARRIAGE[key as OwnedFeatureKey];
		// A loss somebody else already reported is one loss, not two.
		if (decision.carriage !== 'omitted' || already.has(decision.code)) continue;
		addItem(report, {
			code: decision.code,
			severity: 'warning',
			disposition: 'omitted',
			scope: { kind: 'project' },
			data: { requirementId: id },
			message: decision.message,
		});
		already.add(decision.code);
		reported.push(decision.code);
	}
	return Object.freeze(reported);
}

function requirementIds(project: unknown): readonly string[] {
	const manifest = (project as Readonly<{ featureRequirements?: unknown }>)?.featureRequirements;
	const requirements = (manifest as Readonly<{ requirements?: unknown }>)?.requirements;
	if (!Array.isArray(requirements)) return [];
	return requirements
		.map((requirement) => (requirement as Readonly<{ id?: unknown }>)?.id)
		.filter((id): id is string => typeof id === 'string');
}
