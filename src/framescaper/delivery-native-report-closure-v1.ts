/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact artifact and conformance closure for one native delivery receipt. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { assertNativeMediaRelativeDestination } from '../common/editor/native-media-atomic-publication.ts';
import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import {
	assertNativeMediaPlanEnvelopeV2,
	type NativeMediaPlanEnvelopeV2,
} from '../common/editor/native-media-plan-envelope-v2.ts';
import {
	assertNativeMediaPlanEnvelopeV3,
	type NativeMediaPlanEnvelopeV3,
} from '../common/editor/native-media-plan-envelope-v3.ts';
import {
	nativeMediaV14EncodeDispatch,
	type NativeMediaV14EncodeProfileId,
} from '../common/editor/native-media-v14-native-dispatch.ts';
import {
	findPlatformDeliveryPreset,
	type PlatformNativeMediaV15Execution,
} from '../common/editor/platform-delivery-presets.ts';
import type { DeliveryReportItem } from '../common/editor/delivery-report.ts';
import type { UnifiedExactRenderCaptionDeliveryV15 } from '../common/editor/unified-exact-render-delivery-v15.ts';
import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-plan.ts';
import {
	videoBurnInCuesOverlap,
	videoBurnInUndrawableCharacters,
} from '../common/editor/video-caption-burn-in.ts';
import type { VideoBurnInStage } from '../common/editor/video-caption-burn-in.ts';

interface FramescaperCaptionDeliveryDocument {
	readonly text: string;
	readonly sha256: string;
}

interface FramescaperCaptionDeliveryAdapter {
	readonly delivery: UnifiedExactRenderCaptionDeliveryV15;
	readonly muxDocument: FramescaperCaptionDeliveryDocument | null;
	readonly sidecarDocument: FramescaperCaptionDeliveryDocument | null;
	readonly burnInPlan: unknown | null;
	readonly burnInStage: VideoBurnInStage | null;
	readonly track: Readonly<{ readonly id: string }>;
}

interface FramescaperCompanionAudioPlanBundle {
	readonly authority: unknown;
	readonly authorityPayload: string;
	readonly plan: unknown;
	readonly planPayload: string;
}

interface FramescaperProjectUnifiedRenderDeliveryBundleV15 {
	readonly envelope: NativeMediaPlanEnvelopeV3;
	readonly plan: NativeMediaPlanEnvelopeV3['plan'];
	readonly timingSidecars: UnifiedExactRenderTimingSidecars;
	readonly captionAdapter: FramescaperCaptionDeliveryAdapter | null;
	readonly companionAudioBundle: FramescaperCompanionAudioPlanBundle | null;
}

export type FramescaperNativeCaptionDispositionV1 =
	| 'none' | 'sidecar' | 'mux' | 'burn-in'
	| 'mux-and-burn-in' | 'mux-and-sidecar' | 'burn-in-and-sidecar'
	| 'mux-and-burn-in-and-sidecar';

export interface FramescaperNativeDeliveryArtifactManifestEntryV1 {
	readonly artifactId: string;
	readonly kind: 'file' | 'directory';
	readonly relativePath: string;
	/** Known only for immutable authored artifacts such as a caption sidecar. */
	readonly expectedByteLength: number | null;
	readonly expectedSha256: string | null;
}

export interface FramescaperNativeDeliveryClosureV1 {
	readonly planFingerprint: string;
	readonly profileId: NativeMediaV14EncodeProfileId;
	readonly hardwarePolicy: PlatformNativeMediaV15Execution['hardwarePolicy'];
	readonly captionDisposition: FramescaperNativeCaptionDispositionV1;
	readonly requiredArtifactManifest: readonly FramescaperNativeDeliveryArtifactManifestEntryV1[];
	readonly requiredConformanceCheckIds: readonly string[];
	/**
	 * Disclosures the planned report must already carry: what the burn-in stage
	 * knows it cannot draw or keeps on screen at once. The web delivery
	 * inventory names both; a native delivery that stayed silent about them
	 * would be exactly the hidden conversion the delivery gate forbids.
	 */
	readonly requiredReportItems: readonly DeliveryReportItem[];
}

export function deriveFramescaperNativeDeliveryClosureV1(input: Readonly<{
	readonly targetId: string;
	readonly envelope: unknown;
	readonly timingSidecars?: UnifiedExactRenderTimingSidecars;
	readonly deliveryBundle?: unknown;
}>): FramescaperNativeDeliveryClosureV1 {
	const targetId = stableId(input.targetId, 'native delivery report target ID');
	const envelopeVersion = ownDataValue(input.envelope, 'envelopeVersion', 'native delivery plan envelope');
	let envelope: NativeMediaPlanEnvelopeV2 | NativeMediaPlanEnvelopeV3;
	let bundle: FramescaperProjectUnifiedRenderDeliveryBundleV15 | null = null;
	if (envelopeVersion === 2) {
		if (input.deliveryBundle !== undefined) {
			throw new TypeError('A V14 native delivery report cannot carry a V15 delivery bundle.');
		}
		assertNativeMediaPlanEnvelopeV2(input.envelope, input.timingSidecars);
		if (input.envelope.planVersion !== 14 || input.envelope.plan.version !== 14) {
			throw new RangeError('A V2 native delivery report requires an exact V14 plan envelope.');
		}
		envelope = input.envelope;
	} else if (envelopeVersion === 3) {
		const version = ownDataValue(input.envelope, 'planVersion', 'native delivery plan envelope');
		if (version === 15) {
			bundle = coherentV15Bundle(input.envelope, input.deliveryBundle, input.timingSidecars);
			assertNativeMediaPlanEnvelopeV3(input.envelope, bundle.timingSidecars);
		} else {
			if (input.deliveryBundle !== undefined) {
				throw new TypeError('A V14 native delivery report cannot carry a V15 delivery bundle.');
			}
			assertNativeMediaPlanEnvelopeV3(input.envelope, input.timingSidecars);
		}
		if ((input.envelope.planVersion !== 14 && input.envelope.planVersion !== 15)
			|| input.envelope.plan.version !== input.envelope.planVersion) {
			throw new RangeError('A V3 native delivery report requires an exact V14 or V15 plan envelope.');
		}
		envelope = input.envelope;
	} else {
		throw new RangeError('A native delivery report requires a V2 or V3 plan envelope.');
	}

	const profileValue = envelope.plan.deliveryProfile;
	if (typeof profileValue !== 'string') {
		throw new TypeError('A native delivery report plan has no exact encode profile.');
	}
	const profileId = profileValue as NativeMediaV14EncodeProfileId;
	const dispatch = nativeMediaV14EncodeDispatch(profileId);
	const execution = nativeTargetExecution(targetId, profileId);
	const caption = envelope.plan.version === 15 ? envelope.plan.captionDelivery : null;
	const companion = envelope.plan.version === 15 ? envelope.plan.companionAudio : null;
	const adapter = bundle === null ? null : validateCaptionBundle(bundle, caption);
	validateCompanionBundle(bundle, companion);
	const manifest: FramescaperNativeDeliveryArtifactManifestEntryV1[] = [];
	manifest.push(Object.freeze({
		artifactId: dispatch.imageSequence ? 'picture-sequence' : 'picture-master',
		kind: dispatch.imageSequence ? 'directory' : 'file',
		relativePath: assertNativeMediaRelativeDestination(
			dispatch.imageSequence ? 'frames' : `master.${envelope.plan.format.extension}`,
		),
		expectedByteLength: null,
		expectedSha256: null,
	}));
	if (caption?.sidecar !== null && caption?.sidecar !== undefined) {
		const document = adapter!.sidecarDocument!;
		manifest.push(Object.freeze({
			artifactId: 'caption-sidecar', kind: 'file' as const,
			relativePath: assertNativeMediaRelativeDestination(
				`captions.${caption.sidecar.format === 'imsc1' ? 'ttml' : caption.sidecar.format}`,
			),
			expectedByteLength: new TextEncoder().encode(document.text).byteLength,
			expectedSha256: caption.sidecar.documentSha256,
		}));
	}
	if (companion !== null && companion !== undefined) {
		manifest.push(Object.freeze({
			artifactId: 'companion-audio', kind: 'file' as const,
			relativePath: assertNativeMediaRelativeDestination(companion.fileName),
			expectedByteLength: null,
			expectedSha256: null,
		}));
	}
	const checks = [
		...manifest.map(({ artifactId }) => `artifact-integrity:${artifactId}`),
		'target-profile',
		'picture-codec',
		'picture-duration',
		'picture-frame-count',
		'picture-geometry',
		'picture-pixel-format',
		dispatch.imageSequence ? 'image-sequence-tree' : 'container-reopen',
		'publication-atomic',
		...(envelope.plan.output.includeAudio ? ['embedded-audio'] : []),
		...(caption?.mux === null || caption?.mux === undefined ? [] : ['caption-mux-document']),
		...(caption?.burnIn === null || caption?.burnIn === undefined ? [] : ['caption-burn-plan']),
		...(caption?.sidecar === null || caption?.sidecar === undefined ? [] : ['caption-sidecar-document']),
		...(companion === null || companion === undefined ? [] : ['companion-audio-plan']),
	// Code-unit order: the check inventory is validated cross-process, and an
	// exact contract must not change meaning with the validator's ICU locale.
	].sort();
	return Object.freeze({
		planFingerprint: envelope.fingerprint,
		profileId,
		hardwarePolicy: execution.hardwarePolicy,
		captionDisposition: captionDisposition(caption ?? null),
		requiredArtifactManifest: Object.freeze(manifest),
		requiredConformanceCheckIds: Object.freeze(checks),
		requiredReportItems: burnInDisclosureItems(adapter),
	});
}

/**
 * The disclosures a burn-in stage owes the report, in the web inventory's
 * exact vocabulary: overlapping cues render stacked, and characters no staged
 * font subset can draw are blanks in the picture. Naming them is the
 * difference between a stated omission and a delivery quietly missing words.
 */
function burnInDisclosureItems(
	adapter: FramescaperProjectUnifiedRenderDeliveryBundleV15['captionAdapter'],
): readonly DeliveryReportItem[] {
	const stage = adapter?.burnInStage ?? null;
	if (stage === null) return Object.freeze([]);
	const trackId = adapter!.track.id;
	const items: DeliveryReportItem[] = [];
	if (videoBurnInCuesOverlap(stage)) {
		items.push(Object.freeze({
			code: 'delivery.captions-overlapping',
			severity: 'warning' as const,
			disposition: 'converted' as const,
			scope: Object.freeze({ kind: 'track', id: trackId }),
			data: Object.freeze({ trackId }),
		}));
	}
	const undrawable = videoBurnInUndrawableCharacters(stage);
	if (undrawable.length > 0) {
		items.push(Object.freeze({
			code: 'delivery.captions-undrawable',
			severity: 'warning' as const,
			disposition: 'omitted' as const,
			scope: Object.freeze({ kind: 'track', id: trackId }),
			data: Object.freeze({ trackId, characters: undrawable.join('') }),
		}));
	}
	return Object.freeze(items);
}

function coherentV15Bundle(
	envelopeValue: unknown,
	bundleValue: unknown,
	timingSidecars: UnifiedExactRenderTimingSidecars | undefined,
): FramescaperProjectUnifiedRenderDeliveryBundleV15 {
	const row = closedRecord(bundleValue, [
		'envelope', 'plan', 'timingSidecars', 'captionAdapter', 'companionAudioBundle',
	], 'native delivery V15 bundle');
	if (!Object.isFrozen(bundleValue) || row.envelope !== envelopeValue) {
		throw new Error('A V15 native delivery report requires its exact sealed envelope bundle.');
	}
	const envelope = envelopeValue as NativeMediaPlanEnvelopeV3;
	if (row.plan !== envelope.plan) {
		throw new Error('The V15 delivery bundle plan is not its envelope plan.');
	}
	if (timingSidecars !== undefined && row.timingSidecars !== timingSidecars) {
		throw new Error('The V15 delivery bundle changed its timing-sidecar authority.');
	}
	return bundleValue as FramescaperProjectUnifiedRenderDeliveryBundleV15;
}

function validateCaptionBundle(
	bundle: FramescaperProjectUnifiedRenderDeliveryBundleV15,
	delivery: UnifiedExactRenderCaptionDeliveryV15 | null,
): FramescaperProjectUnifiedRenderDeliveryBundleV15['captionAdapter'] {
	const adapter = bundle.captionAdapter;
	if (delivery === null) {
		if (adapter !== null) throw new Error('The V15 bundle carries an unplanned caption adapter.');
		return null;
	}
	if (adapter === null || !Object.isFrozen(adapter)
		|| semantic(adapter.delivery) !== semantic(delivery)) {
		throw new Error('The V15 caption adapter is not bound to its exact delivery plan.');
	}
	assertCaptionDocument(adapter.muxDocument, delivery.mux?.documentSha256 ?? null, 'mux');
	assertCaptionDocument(adapter.sidecarDocument, delivery.sidecar?.documentSha256 ?? null, 'sidecar');
	if (delivery.burnIn === null) {
		if (adapter.burnInPlan !== null) throw new Error('The V15 bundle carries an unplanned caption burn plan.');
	} else if (adapter.burnInPlan === null
		|| digestText(JSON.stringify(adapter.burnInPlan)) !== delivery.burnIn.planSha256) {
		throw new Error('The V15 caption burn plan digest changed.');
	}
	return adapter;
}

function assertCaptionDocument(
	document: FramescaperCaptionDeliveryDocument | null,
	expectedSha256: string | null,
	label: string,
): void {
	if (expectedSha256 === null) {
		if (document !== null) throw new Error(`The V15 bundle carries an unplanned caption ${label} document.`);
		return;
	}
	if (document === null || document.sha256 !== expectedSha256
		|| digestText(document.text) !== expectedSha256) {
		throw new Error(`The V15 caption ${label} document digest changed.`);
	}
}

function validateCompanionBundle(
	bundle: FramescaperProjectUnifiedRenderDeliveryBundleV15 | null,
	companion: NativeMediaPlanEnvelopeV3['summary']['companionAudio'],
): void {
	const audio = bundle?.companionAudioBundle ?? null;
	if (companion === null || companion === undefined) {
		if (audio !== null) throw new Error('The V15 bundle carries unplanned companion audio.');
		return;
	}
	if (audio === null || !Object.isFrozen(audio) || semantic(audio.authority) !== semantic(companion)) {
		throw new Error('The V15 companion-audio bundle is not bound to its exact delivery plan.');
	}
	let payload: unknown;
	try { payload = JSON.parse(audio.authorityPayload) as unknown; } catch {
		throw new TypeError('The V15 companion-audio authority payload is not JSON.');
	}
	const authorityFingerprint = fingerprintNativeMediaPlan(payload);
	const planFingerprint = fingerprintNativeMediaPlan(audio.plan);
	if (authorityFingerprint.canonical !== audio.authorityPayload
		|| authorityFingerprint.sha256 !== companion.authorityFingerprint
		|| planFingerprint.canonical !== audio.planPayload
		|| planFingerprint.sha256 !== companion.planFingerprint
		|| semantic((payload as { readonly plan?: unknown }).plan) !== semantic(audio.plan)) {
		throw new Error('The V15 companion-audio authority payload changed.');
	}
}

function nativeTargetExecution(
	targetId: string,
	profileId: NativeMediaV14EncodeProfileId,
): PlatformNativeMediaV15Execution {
	const preset = findPlatformDeliveryPreset(targetId);
	if (!preset) throw new RangeError(`Native delivery report target ${targetId} is not in the platform catalog.`);
	if (preset.execution.kind !== 'native-media-v15') {
		throw new RangeError(`Platform delivery target ${targetId} is not a native-media-v15 target.`);
	}
	if (preset.execution.profileId !== profileId) {
		throw new RangeError(
			`Platform delivery target ${targetId} does not select exact profile ${profileId}.`,
		);
	}
	return preset.execution;
}

function captionDisposition(
	delivery: UnifiedExactRenderCaptionDeliveryV15 | null,
): FramescaperNativeCaptionDispositionV1 {
	if (delivery === null) return 'none';
	const mux = delivery.mux !== null;
	const burn = delivery.burnIn !== null;
	const sidecar = delivery.sidecar !== null;
	if (mux && burn && sidecar) return 'mux-and-burn-in-and-sidecar';
	if (mux && burn) return 'mux-and-burn-in';
	if (mux && sidecar) return 'mux-and-sidecar';
	if (burn && sidecar) return 'burn-in-and-sidecar';
	if (mux) return 'mux';
	if (burn) return 'burn-in';
	if (sidecar) return 'sidecar';
	throw new Error('An exact V15 caption delivery has no selected artifact.');
}

function semantic(value: unknown): string { return fingerprintNativeMediaPlan(value).canonical; }

function digestText(value: string): string {
	return bytesToHex(sha256(new TextEncoder().encode(value)));
}

function ownDataValue(value: unknown, field: string, name: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function closedRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} has missing or unsupported fields.`);
	}
	for (const field of fields) ownDataValue(value, field, name);
	return value as Record<string, unknown>;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u.test(value)) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}
