/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned composition of the six native-service rows shown by Framescaper. */

import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	createNativeMediaCapabilitySnapshotV1,
	type NativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';
import type { FramescaperNativeServicePreferences } from './native-services-controller.ts';

export interface FramescaperNativeCapabilityRuntimeV1 {
	readonly payloadBuilt: boolean;
	readonly runtimeAvailable: boolean;
	readonly selfTestPassed: boolean;
	/** Exact selected V20 V7/V8 render families and their codecs passed end-to-end. */
	readonly selectedV20RenderSelfTestPassed: boolean;
	/** Exact selected V28 plan-V14 carrier operation passed its separate self-test. */
	readonly selectedV28V14RenderSelfTestPassed: boolean;
	/** Full V25 bit-depth, pixel/chroma, range, colour/HDR, and alpha probe semantics passed. */
	readonly professionalCharacteristicsSelfTestPassed: boolean;
	readonly quarantined: boolean;
	readonly degraded: boolean;
	readonly buildFingerprint: string | null;
	readonly detail: string;
}

export interface FramescaperNativeCapabilityReportOptionsV1 {
	readonly preferences: FramescaperNativeServicePreferences;
	readonly media: FramescaperNativeCapabilityRuntimeV1;
	readonly queueSourceAuthorityMounted: boolean;
	readonly queueCapacityAuthorityMounted: boolean;
	readonly watchProjectMutationMounted: boolean;
	readonly imageSequenceImportMounted: boolean;
	readonly externalDisplay: Readonly<{
		readonly placementSupported: boolean;
		readonly sinkSelfTestPassed: boolean;
		readonly detail: string;
	}>;
	readonly openFx: Readonly<{
		readonly payloadBuilt: boolean;
		readonly runtimeAvailable: boolean;
		readonly selfTestPassed: boolean;
		readonly quarantined: boolean;
		readonly buildFingerprint: string | null;
		readonly detail: string;
	}>;
}

const IMAGE_SEQUENCE_RGBA8_BOUNDARY = 'The selected image-sequence decoder admits only opaque 8-bit sRGB/RGB/full-range pixels; higher-bit-depth, HDR, alpha, or incompatible color is refused before import.';

/**
 * Report software, policy, payload, self-test, and user-switch observations
 * separately. A verified payload digest is the only accepted build fingerprint.
 */
export function createFramescaperNativeCapabilityReportV1(
	options: FramescaperNativeCapabilityReportOptionsV1,
): NativeMediaCapabilitySnapshotV1 {
	const masterEnabled = options.preferences.nativeMediaEnabled;
	const mediaEnabled = masterEnabled;
	const media = options.media;
	const mediaProbe = media.runtimeAvailable || media.quarantined || media.degraded;
	const queueExecutionMounted = options.queueSourceAuthorityMounted
		&& options.queueCapacityAuthorityMounted;
	const renderQueueDetail = !options.queueSourceAuthorityMounted
		? `Queue source authority is not mounted. ${media.detail}`
		: !options.queueCapacityAuthorityMounted
			? `Queue capacity authority is not mounted. ${media.detail}`
			: media.selectedV28V14RenderSelfTestPassed
				? media.detail
				: `Selected V28/V14 carrier render execution is not self-tested. ${media.detail}`;
	const proxyQueueDetail = !options.queueSourceAuthorityMounted
		? `Proxy project/source authority is not mounted. ${media.detail}`
		: !options.queueCapacityAuthorityMounted
			? `Proxy queue capacity authority is not mounted. ${media.detail}`
			: media.detail;
	return createNativeMediaCapabilitySnapshotV1({
		masterEnabled,
		buildFingerprint: null,
		entries: [
			{
				...NATIVE_MEDIA_CAPABILITY_IDS.renderQueue,
				buildSupported: media.payloadBuilt && queueExecutionMounted
					&& media.selectedV28V14RenderSelfTestPassed,
				probeSucceeded: mediaProbe,
				selfTestPassed: media.selfTestPassed && media.selectedV28V14RenderSelfTestPassed,
				quarantined: media.quarantined,
				degraded: media.degraded,
				userEnabled: mediaEnabled,
				buildFingerprint: media.buildFingerprint,
				detail: renderQueueDetail,
			},
			{
				...NATIVE_MEDIA_CAPABILITY_IDS.watchFolders,
				buildSupported: options.watchProjectMutationMounted,
				probeSucceeded: true,
				selfTestPassed: options.watchProjectMutationMounted,
				userEnabled: mediaEnabled,
				detail: options.watchProjectMutationMounted
					? 'Watch reconciliation is mounted for the selected writable project.'
					: 'Watch reconciliation is present, but selected-project mutation is not mounted.',
			},
			{
				...NATIVE_MEDIA_CAPABILITY_IDS.proxyCodec,
				buildSupported: media.payloadBuilt && queueExecutionMounted,
				probeSucceeded: mediaProbe,
				selfTestPassed: media.selfTestPassed,
				quarantined: media.quarantined,
				degraded: media.degraded,
				userEnabled: mediaEnabled,
				buildFingerprint: media.buildFingerprint,
				detail: proxyQueueDetail,
			},
			{
				...NATIVE_MEDIA_CAPABILITY_IDS.imageSequenceImport,
				buildSupported: media.payloadBuilt && options.imageSequenceImportMounted,
				probeSucceeded: mediaProbe && media.professionalCharacteristicsSelfTestPassed,
				selfTestPassed: media.selfTestPassed
					&& media.professionalCharacteristicsSelfTestPassed,
				quarantined: media.quarantined,
				degraded: media.degraded,
				userEnabled: mediaEnabled,
				buildFingerprint: media.buildFingerprint,
				detail: !options.imageSequenceImportMounted
					? `Image-sequence project mutation authority is not routed; the pathless picker alone cannot admit professional source characteristics. ${IMAGE_SEQUENCE_RGBA8_BOUNDARY} ${media.detail}`
					: media.professionalCharacteristicsSelfTestPassed
						? `${IMAGE_SEQUENCE_RGBA8_BOUNDARY} ${media.detail}`
						: `The current native probe has no verified full V25 professional source characteristics result. ${IMAGE_SEQUENCE_RGBA8_BOUNDARY} ${media.detail}`,
			},
			{
				...NATIVE_MEDIA_CAPABILITY_IDS.externalDisplay,
				buildSupported: options.externalDisplay.placementSupported,
				probeSucceeded: options.externalDisplay.placementSupported,
				selfTestPassed: options.externalDisplay.sinkSelfTestPassed,
				userEnabled: mediaEnabled,
				detail: options.externalDisplay.detail,
			},
			{
				...NATIVE_MEDIA_CAPABILITY_IDS.ofxHost,
				buildSupported: options.openFx.payloadBuilt,
				probeSucceeded: options.openFx.runtimeAvailable,
				selfTestPassed: options.openFx.selfTestPassed,
				quarantined: options.openFx.quarantined,
				userEnabled: options.preferences.ofxConsentEnabled,
				buildFingerprint: options.openFx.buildFingerprint,
				detail: options.openFx.detail,
			},
		],
	});
}

export function framescaperClosedNativeCapabilityReportV1(
	preferences: FramescaperNativeServicePreferences,
): NativeMediaCapabilitySnapshotV1 {
	return createFramescaperNativeCapabilityReportV1({
		preferences,
		media: {
			payloadBuilt: false,
			runtimeAvailable: false,
			selfTestPassed: false,
			selectedV20RenderSelfTestPassed: false,
			selectedV28V14RenderSelfTestPassed: false,
			professionalCharacteristicsSelfTestPassed: false,
			quarantined: false,
			degraded: false,
			buildFingerprint: null,
			detail: 'No authenticated native media-host payload is present for this target.',
		},
		queueSourceAuthorityMounted: false,
		queueCapacityAuthorityMounted: false,
		watchProjectMutationMounted: false,
		imageSequenceImportMounted: false,
		externalDisplay: {
			placementSupported: false,
			sinkSelfTestPassed: false,
			detail: 'External-display placement and sink evidence are unavailable.',
		},
		openFx: {
			payloadBuilt: false,
			runtimeAvailable: false,
			selfTestPassed: false,
			quarantined: false,
			buildFingerprint: null,
			detail: 'No authenticated OpenFX host payload is present for this target.',
		},
	});
}
