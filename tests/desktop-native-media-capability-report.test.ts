/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperNativeCapabilityReportV1,
	framescaperClosedNativeCapabilityReportV1,
} from '../desktop/native-media-capability-report.ts';
import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	assertNativeMediaCapabilitySnapshotV1,
} from '../src/common/editor/native-media-capability-snapshot.ts';

const DISABLED = Object.freeze({
	nativeMediaEnabled: false,
	hardwareDecodeEnabled: false,
	hardwareEncodeEnabled: false,
	ofxConsentEnabled: false,
});

test('the closed production report always names all six menu capability rows', () => {
	const report = framescaperClosedNativeCapabilityReportV1(DISABLED);
	assert.doesNotThrow(() => assertNativeMediaCapabilitySnapshotV1(report));
	assert.deepEqual(report.entries.map(({ domain, id }) => ({ domain, id })),
		Object.values(NATIVE_MEDIA_CAPABILITY_IDS));
	assert.equal(report.buildFingerprint, null);
	assert.equal(report.entries.every((entry) => entry.detail !== null), true);
	assert.equal(report.entries.every((entry) => entry.buildFingerprint === null), true);
	assert.equal(report.entries.filter((entry) => entry.state === 'blocked-policy').length, 4);
	assert.match(
		report.entries.find(({ id }) => id === 'image-sequence-import')?.detail ?? '',
		/only opaque 8-bit sRGB\/RGB\/full-range.*higher-bit-depth, HDR, alpha, or incompatible color/iu,
	);
});

test('only an authenticated payload digest becomes a media build fingerprint', () => {
	const fingerprint = 'ab'.repeat(32);
	const report = createFramescaperNativeCapabilityReportV1({
		preferences: { ...DISABLED, nativeMediaEnabled: true, ofxConsentEnabled: true },
		media: {
			payloadBuilt: true, runtimeAvailable: true, selfTestPassed: true,
			selectedV20RenderSelfTestPassed: false,
			selectedV28V14RenderSelfTestPassed: false,
			professionalCharacteristicsSelfTestPassed: false,
			quarantined: false, degraded: false, buildFingerprint: fingerprint,
			detail: 'Authenticated current-target media host passed its supervised self-test.',
		},
		policy: {
			nativeCodecsCleared: true, proxyCodecCleared: true,
			imageSequencesCleared: true, openFxCleared: false,
		},
		queueSourceAuthorityMounted: false,
		queueCapacityAuthorityMounted: false,
		watchProjectMutationMounted: false,
		imageSequenceImportMounted: false,
		externalDisplay: {
			placementSupported: true, sinkSelfTestPassed: true,
			detail: 'Dedicated sandboxed SDR sink passed admission.',
		},
		openFx: {
			payloadBuilt: false, runtimeAvailable: false, selfTestPassed: false,
			quarantined: false, buildFingerprint: null,
			detail: 'OpenFX remains pending external payload evidence.',
		},
	});
	assert.equal(report.buildFingerprint, null, 'unrelated rows do not inherit a media payload identity');
	for (const id of ['persistent-render-queue', 'encode-mov-prores-proxy', 'image-sequence-import']) {
		assert.equal(report.entries.find((entry) => entry.id === id)?.buildFingerprint, fingerprint);
		assert.equal(report.entries.find((entry) => entry.id === id)?.state, 'unavailable');
	}
	assert.equal(report.entries.find((entry) => entry.id === 'external-display')?.state, 'available');
	assert.equal(report.entries.find((entry) => entry.id === 'isolated-host')?.state, 'blocked-policy');
});

test('the render queue requires its separate selected V28/V14 carrier self-test', () => {
	const report = createFramescaperNativeCapabilityReportV1({
		preferences: { ...DISABLED, nativeMediaEnabled: true },
		media: {
			payloadBuilt: true, runtimeAvailable: true, selfTestPassed: true,
			selectedV20RenderSelfTestPassed: true,
			selectedV28V14RenderSelfTestPassed: false,
			professionalCharacteristicsSelfTestPassed: false,
			quarantined: false, degraded: false, buildFingerprint: 'cd'.repeat(32),
			detail: 'The host passed its general FFmpeg and proxy self-test only.',
		},
		policy: {
			nativeCodecsCleared: true, proxyCodecCleared: true,
			imageSequencesCleared: false, openFxCleared: false,
		},
		queueSourceAuthorityMounted: true,
		queueCapacityAuthorityMounted: true,
		watchProjectMutationMounted: false,
		imageSequenceImportMounted: false,
		externalDisplay: {
			placementSupported: false, sinkSelfTestPassed: false, detail: 'Unavailable.',
		},
		openFx: {
			payloadBuilt: false, runtimeAvailable: false, selfTestPassed: false,
			quarantined: false, buildFingerprint: null, detail: 'Unavailable.',
		},
	});
	assert.equal(report.entries.find((entry) => entry.id === 'persistent-render-queue')?.state, 'unavailable');
	assert.equal(report.entries.find((entry) => entry.id === 'encode-mov-prores-proxy')?.state, 'available');
});

test('queue and proxy execution require a mounted capacity authority', () => {
	const report = createFramescaperNativeCapabilityReportV1({
		preferences: { ...DISABLED, nativeMediaEnabled: true },
		media: {
			payloadBuilt: true, runtimeAvailable: true, selfTestPassed: true,
			selectedV20RenderSelfTestPassed: true,
			selectedV28V14RenderSelfTestPassed: true,
			professionalCharacteristicsSelfTestPassed: false,
			quarantined: false, degraded: false, buildFingerprint: 'de'.repeat(32),
			detail: 'Authenticated media runtime is available.',
		},
		policy: {
			nativeCodecsCleared: true, proxyCodecCleared: true,
			imageSequencesCleared: false, openFxCleared: false,
		},
		queueSourceAuthorityMounted: true,
		queueCapacityAuthorityMounted: false,
		watchProjectMutationMounted: false,
		imageSequenceImportMounted: false,
		externalDisplay: {
			placementSupported: false, sinkSelfTestPassed: false, detail: 'Unavailable.',
		},
		openFx: {
			payloadBuilt: false, runtimeAvailable: false, selfTestPassed: false,
			quarantined: false, buildFingerprint: null, detail: 'Unavailable.',
		},
	});
	for (const id of ['persistent-render-queue', 'encode-mov-prores-proxy']) {
		const entry = report.entries.find((candidate) => candidate.id === id);
		assert.equal(entry?.state, 'unavailable');
		assert.match(entry?.detail ?? '', /capacity authority/iu);
	}
});

test('a generic media-host self-test cannot claim V25 professional image-sequence admission', () => {
	const report = createFramescaperNativeCapabilityReportV1({
		preferences: { ...DISABLED, nativeMediaEnabled: true },
		media: {
			payloadBuilt: true, runtimeAvailable: true, selfTestPassed: true,
			selectedV20RenderSelfTestPassed: false,
			selectedV28V14RenderSelfTestPassed: false,
			professionalCharacteristicsSelfTestPassed: false,
			quarantined: false, degraded: false, buildFingerprint: 'ef'.repeat(32),
			detail: 'The generic FFmpeg, retime, and proxy self-test passed.',
		},
		policy: {
			nativeCodecsCleared: true, proxyCodecCleared: true,
			imageSequencesCleared: true, openFxCleared: false,
		},
		queueSourceAuthorityMounted: false,
		queueCapacityAuthorityMounted: false,
		watchProjectMutationMounted: false,
		imageSequenceImportMounted: true,
		externalDisplay: {
			placementSupported: false, sinkSelfTestPassed: false, detail: 'Unavailable.',
		},
		openFx: {
			payloadBuilt: false, runtimeAvailable: false, selfTestPassed: false,
			quarantined: false, buildFingerprint: null, detail: 'Unavailable.',
		},
	});
	const imageSequence = report.entries.find((entry) => entry.id === 'image-sequence-import');
	assert.equal(imageSequence?.state, 'unavailable');
	assert.match(imageSequence?.detail ?? '', /full V25 professional source characteristics/iu);
});
