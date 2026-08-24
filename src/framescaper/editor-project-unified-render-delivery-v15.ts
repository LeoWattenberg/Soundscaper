/* SPDX-License-Identifier: AGPL-3.0-only */

/** Selected V15 delivery projection over the validated Framescaper V28 render graph. */

import {
	readClosedDomainField,
	readClosedDomainRecord,
} from '../common/editor/closed-domain-value.ts';
import {
	createNativeMediaPlanEnvelopeV3,
	type NativeMediaPlanEnvelopeV3,
} from '../common/editor/native-media-plan-envelope-v3.ts';
import { createExportPlan } from '../common/editor/export.js';
import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import type { NativeMediaV14EncodeProfileId } from '../common/editor/native-media-v14-native-dispatch.ts';
import {
	framescaperImageSequenceCompanionAudioFileNameV15,
	type UnifiedExactRenderCompanionAudioV15,
} from '../common/editor/unified-exact-render-delivery-v15.ts';
import {
	snapshotPlatformImageSequenceCompanionAudioChoiceV1,
	type PlatformImageSequenceCompanionAudioChoiceV1,
} from '../common/editor/platform-image-sequence-companion-audio.ts';
import {
	type UnifiedExactRenderPlanV15,
	type UnifiedExactRenderTimingSidecars,
} from '../common/editor/unified-exact-render-plan.ts';
import { normalizeUnifiedExactRenderDeliveryProfile } from '../common/editor/unified-exact-render-plan-format.ts';
import {
	snapshotFramescaperUnifiedExactVisualRenderAuthority,
	type FramescaperUnifiedExactVisualRenderAuthority,
} from './editor-project-unified-render-authority.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
	snapshotFramescaperUnifiedRenderTimingSidecars,
} from './editor-project-unified-render-core.ts';
import { createFramescaperUnifiedOpenFxRenderNodes } from './editor-project-unified-render-openfx.ts';
import {
	createFramescaperUnifiedRenderFinishingNodeV28,
} from './editor-project-unified-render-plan-v28.ts';
import { createFramescaperUnifiedProfessionalRenderNodes } from './editor-project-unified-render-professional.ts';
import { createFramescaperUnifiedVisualRenderNodes } from './editor-project-unified-render-visual.ts';
import { validateFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';
import {
	createFramescaperCaptionDeliveryAdapterV28,
	snapshotFramescaperCaptionDeliveryRequestV28,
	type FramescaperCaptionDeliveryAdapterV28,
	type FramescaperCaptionDeliveryRequestV28,
} from './video-caption-delivery-v28.ts';

export interface FramescaperProjectDeliveryAuthorityV15 {
	readonly deliveryProfile: NativeMediaV14EncodeProfileId;
	/** Intent only; every digest and artifact is derived from the exact project track. */
	readonly captionRequest?: FramescaperCaptionDeliveryRequestV28 | null;
	/** Closed choice only; the ordinary audio plan is derived from the project snapshot. */
	readonly companionAudio?: PlatformImageSequenceCompanionAudioChoiceV1 | null;
}

export type FramescaperCompanionAudioExportPlanV15 = ReturnType<typeof createExportPlan>;

export interface FramescaperCompanionAudioPlanBundleV15 {
	readonly authority: UnifiedExactRenderCompanionAudioV15;
	readonly choice: PlatformImageSequenceCompanionAudioChoiceV1;
	/** Canonical project/sequence/range/choice/plan authority hashed by planFingerprint. */
	readonly authorityPayload: string;
	readonly planPayload: string;
	readonly plan: Readonly<FramescaperCompanionAudioExportPlanV15>;
}

interface SnapshotDeliveryAuthorityV15 {
	readonly deliveryProfile: NativeMediaV14EncodeProfileId;
	readonly captionRequest: FramescaperCaptionDeliveryRequestV28 | null;
	readonly companionAudioChoice: PlatformImageSequenceCompanionAudioChoiceV1 | null;
}

const DELIVERY_FIELDS = Object.freeze([
	'deliveryProfile', 'captionRequest', 'companionAudio',
]);

export type FramescaperNativeMediaPlanEnvelopeV15 = NativeMediaPlanEnvelopeV3 & Readonly<{
	readonly planVersion: 15;
	readonly plan: UnifiedExactRenderPlanV15;
}>;

export interface FramescaperProjectUnifiedRenderDeliveryBundleV15 {
	/** The one envelope admitted by a future executor; plan is the same frozen object. */
	readonly envelope: FramescaperNativeMediaPlanEnvelopeV15;
	readonly plan: UnifiedExactRenderPlanV15;
	/** Process-local timing tokens required to validate VFR source authority. */
	readonly timingSidecars: UnifiedExactRenderTimingSidecars;
	/** Authenticated documents/stage plans that a future V15 publisher must bind as grants. */
	readonly captionAdapter: FramescaperCaptionDeliveryAdapterV28 | null;
	/** Exact ordinary audio plan from which companion authority was derived. */
	readonly companionAudioBundle: FramescaperCompanionAudioPlanBundleV15 | null;
}

export type { FramescaperUnifiedExactVisualRenderAuthority };

/**
 * Build the selected V28 graph, validate it once as V14, then add only V15's
 * caption and companion-audio authority through the canonical normalizer.
 */
export function createFramescaperProjectUnifiedExactRenderPlanV15(
	profile: unknown,
	projectValue: unknown,
	authorityValue: unknown,
	deliveryValue: FramescaperProjectDeliveryAuthorityV15,
): UnifiedExactRenderPlanV15 {
	return createFramescaperProjectUnifiedRenderDeliveryBundleV15(
		profile, projectValue, authorityValue, deliveryValue,
	).plan;
}

/** Seal one coherent handoff containing the envelope and every artifact it authenticates. */
export function createFramescaperProjectUnifiedRenderDeliveryBundleV15(
	profile: unknown,
	projectValue: unknown,
	authorityValue: unknown,
	deliveryValue: FramescaperProjectDeliveryAuthorityV15,
): FramescaperProjectUnifiedRenderDeliveryBundleV15 {
	const built = buildDelivery(profile, projectValue, authorityValue, deliveryValue);
	const envelope = exactV15Envelope(createNativeMediaPlanEnvelopeV3(
		built.plan, built.timingSidecars,
	));
	return Object.freeze({
		envelope,
		plan: envelope.plan,
		timingSidecars: built.timingSidecars,
		captionAdapter: built.captionAdapter,
		companionAudioBundle: built.companionAudioBundle,
	});
}

/** Build the canonical V15 plan and immediately seal its durable V3 envelope. */
export function createFramescaperProjectNativeMediaPlanEnvelopeV15(
	profile: unknown,
	projectValue: unknown,
	authorityValue: unknown,
	deliveryValue: FramescaperProjectDeliveryAuthorityV15,
): NativeMediaPlanEnvelopeV3 & Readonly<{ readonly planVersion: 15; readonly plan: UnifiedExactRenderPlanV15 }> {
	return createFramescaperProjectUnifiedRenderDeliveryBundleV15(
		profile, projectValue, authorityValue, deliveryValue,
	).envelope;
}

function buildDelivery(
	profile: unknown,
	projectValue: unknown,
	authorityValue: unknown,
	deliveryValue: FramescaperProjectDeliveryAuthorityV15,
): Readonly<{
	readonly plan: UnifiedExactRenderPlanV15;
	readonly timingSidecars: UnifiedExactRenderTimingSidecars;
	readonly captionAdapter: FramescaperCaptionDeliveryAdapterV28 | null;
	readonly companionAudioBundle: FramescaperCompanionAudioPlanBundleV15 | null;
}> {
	validateFramescaperProjectV28(profile, projectValue);
	const project = projectValue as FramescaperProjectV28;
	const authority = snapshotFramescaperUnifiedExactVisualRenderAuthority(authorityValue);
	const delivery = snapshotDeliveryAuthority(deliveryValue);
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority, 14);
	const visual = createFramescaperUnifiedVisualRenderNodes(foundation, authority);
	const professional = createFramescaperUnifiedProfessionalRenderNodes(foundation);
	const openFx = createFramescaperUnifiedOpenFxRenderNodes(foundation, visual.representedIdentities);
	const finishing = createFramescaperUnifiedRenderFinishingNodeV28(
		project, foundation.projectIdentities, authority.sequenceId,
	);
	const nodes = [...visual.nodes, ...professional, ...openFx, finishing];

	// Preserve the established V14 semantic boundary before selecting V15 delivery.
	const v14 = finalizeFramescaperUnifiedRenderPlan(
		foundation, 14, nodes, delivery.deliveryProfile,
	);
	const captionAdapter = delivery.captionRequest === null ? null
		: createCaptionAdapter(v14, delivery.deliveryProfile, delivery.captionRequest);
	const companionAudioBundle = delivery.companionAudioChoice === null ? null
		: createCompanionAudioBundle(project, v14, delivery.companionAudioChoice);
	const plan = finalizeFramescaperUnifiedRenderPlan(
		foundation, 15, nodes, delivery.deliveryProfile, {
			captionDelivery: captionAdapter?.delivery ?? null,
			companionAudio: companionAudioBundle?.authority ?? null,
		},
	);
	if (plan.version !== 15) throw new Error('Selected V15 delivery changed generation during normalization.');
	return Object.freeze({
		plan: plan as UnifiedExactRenderPlanV15,
		timingSidecars: snapshotFramescaperUnifiedRenderTimingSidecars(foundation),
		captionAdapter,
		companionAudioBundle,
	});
}

function createCaptionAdapter(
	plan: ReturnType<typeof finalizeFramescaperUnifiedRenderPlan>,
	deliveryProfile: NativeMediaV14EncodeProfileId,
	request: FramescaperCaptionDeliveryRequestV28,
): FramescaperCaptionDeliveryAdapterV28 {
	const finishing = plan.nodes.find((node) => node.kind === 'finishing');
	if (!finishing) throw new Error('Selected V15 caption delivery has no finishing authority.');
	const track = finishing.captionTracks.find(({ id }) => id === request.trackId);
	if (!track) throw new ReferenceError(`V15 caption delivery track ${request.trackId} is missing.`);
	const endFrame = plan.timebase.sampleStart + plan.timebase.sampleDuration;
	if (!Number.isSafeInteger(endFrame)) throw new RangeError('Selected V15 caption range overflows.');
	return createFramescaperCaptionDeliveryAdapterV28(track, request, {
		profileId: deliveryProfile,
		sampleRate: plan.timebase.sampleRate,
		range: Object.freeze({ startFrame: plan.timebase.sampleStart, endFrame }),
		canvas: Object.freeze({
			width: plan.output.canvas.width, height: plan.output.canvas.height,
		}),
	});
}

function snapshotDeliveryAuthority(value: unknown): SnapshotDeliveryAuthorityV15 {
	const name = 'selected Framescaper V15 delivery authority';
	const row = readClosedDomainRecord(value, name, DELIVERY_FIELDS, ['deliveryProfile']);
	return Object.freeze({
		deliveryProfile: normalizeUnifiedExactRenderDeliveryProfile(
			readClosedDomainField(row, 'deliveryProfile', name),
		),
		captionRequest: optionalCaptionRequest(row, name),
		companionAudioChoice: optionalCompanionAudioChoice(row, name),
	});
}

function optionalCaptionRequest(
	record: Readonly<Record<string, unknown>>,
	name: string,
): FramescaperCaptionDeliveryRequestV28 | null {
	if (!Object.hasOwn(record, 'captionRequest')) return null;
	const value = readClosedDomainField(record, 'captionRequest', name);
	return value === null ? null : snapshotFramescaperCaptionDeliveryRequestV28(value);
}

function optionalCompanionAudioChoice(
	record: Readonly<Record<string, unknown>>,
	name: string,
): PlatformImageSequenceCompanionAudioChoiceV1 | null {
	if (!Object.hasOwn(record, 'companionAudio')) return null;
	const value = readClosedDomainField(record, 'companionAudio', name);
	if (value === null) return null;
	if (value === undefined) {
		throw new TypeError('Selected Framescaper V15 companion audio must be a closed plain object.');
	}
	return snapshotPlatformImageSequenceCompanionAudioChoiceV1(value);
}

function createCompanionAudioBundle(
	project: FramescaperProjectV28,
	plan: ReturnType<typeof finalizeFramescaperUnifiedRenderPlan>,
	choice: PlatformImageSequenceCompanionAudioChoiceV1,
): FramescaperCompanionAudioPlanBundleV15 {
	const endFrame = plan.timebase.sampleStart + plan.timebase.sampleDuration;
	if (!Number.isSafeInteger(endFrame)) throw new RangeError('Selected V15 companion audio range overflows.');
	const audioPlan = createExportPlan(project, {
		mode: 'mix', format: choice.formatId,
		range: { startFrame: plan.timebase.sampleStart, endFrame },
		includeTail: false, sampleRate: plan.timebase.sampleRate,
		...(choice.sampleFormat === null ? {} : { sampleFormat: choice.sampleFormat }),
		// The package owns the public audio.ext name; keep the planner's incidental name deterministic.
		date: '2000-01-01T00:00:00.000Z',
	});
	assertDerivedCompanionAudioPlan(audioPlan, plan, choice, endFrame);
	const fileName = framescaperImageSequenceCompanionAudioFileNameV15(choice.formatId);
	const fingerprint = fingerprintNativeMediaPlan({
		schemaVersion: 1,
		kind: 'framescaper-image-sequence-companion-audio-plan-v1',
		project: { id: plan.project.id, revision: plan.project.revision },
		sequenceId: plan.timebase.sequenceId,
		range: {
			sampleStart: plan.timebase.sampleStart,
			sampleDuration: plan.timebase.sampleDuration,
			sampleRate: plan.timebase.sampleRate,
		},
		choice,
		packageFileName: fileName,
		plan: audioPlan,
	});
	const snapshot = deepFreeze(JSON.parse(fingerprint.canonical)) as Readonly<{
		readonly plan: FramescaperCompanionAudioExportPlanV15;
	}>;
	const planFingerprint = fingerprintNativeMediaPlan(snapshot.plan);
	const authority = Object.freeze({
		formatId: choice.formatId,
		fileName,
		planFingerprint: fingerprint.sha256,
		recoveryClass: 'atomic-restart' as const,
	});
	return Object.freeze({
		authority, choice, authorityPayload: fingerprint.canonical,
		planPayload: planFingerprint.canonical, plan: snapshot.plan,
	});
}

function assertDerivedCompanionAudioPlan(
	audioPlan: FramescaperCompanionAudioExportPlanV15,
	videoPlan: ReturnType<typeof finalizeFramescaperUnifiedRenderPlan>,
	choice: PlatformImageSequenceCompanionAudioChoiceV1,
	endFrame: number,
): void {
	const range = audioPlan.range;
	if (audioPlan.mode !== 'mix' || audioPlan.format !== choice.formatId
		|| audioPlan.archive !== null || audioPlan.outputs.length !== 1
		|| audioPlan.outputs[0]?.kind !== 'mix') {
		throw new Error('Derived V15 companion audio must be one ordinary unarchived mix.');
	}
	if (audioPlan.sampleRate !== videoPlan.timebase.sampleRate
		|| range.startFrame !== videoPlan.timebase.sampleStart
		|| range.endFrame !== endFrame
		|| range.durationFrames !== videoPlan.timebase.sampleDuration
		|| audioPlan.tailFrames !== 0
		|| audioPlan.outputFrames !== videoPlan.timebase.sampleDuration) {
		throw new Error('Derived V15 companion audio does not cover the exact picture delivery range.');
	}
	if (audioPlan.encoding.sampleFormat !== choice.sampleFormat) {
		throw new Error('Derived V15 companion audio does not match its selected sample format.');
	}
}

function exactV15Envelope(value: NativeMediaPlanEnvelopeV3): FramescaperNativeMediaPlanEnvelopeV15 {
	if (value.planVersion !== 15 || value.plan.version !== 15) {
		throw new Error('Selected V15 delivery did not create an exact V15 envelope.');
	}
	return value as FramescaperNativeMediaPlanEnvelopeV15;
}

function deepFreeze(value: unknown): unknown {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Array.isArray(value)
		? value : Object.values(value as Record<string, unknown>)) deepFreeze(child);
	return Object.freeze(value);
}
