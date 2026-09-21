/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE,
	FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE,
} from './framescaper-web-vcr-smoke-plan.js';

const PRELOAD_BRIDGE = Object.freeze([
	'dispatch', 'dispose', 'handshake', 'open', 'prepareCapture', 'setCaptureState', 'subscribe',
]);
const CAPTURE_DIMENSIONS = Object.freeze({
	'720p': Object.freeze({ width: 1_280, height: 720 }),
	'1080p': Object.freeze({ width: 1_920, height: 1_080 }),
});
export const FRAMESCAPER_WEB_VCR_SMOKE_STAGE_KEY = '__framescaperWebVcrSmokeStageV1';
export const FRAMESCAPER_WEB_VCR_SMOKE_CAPTURE_GESTURE_KEY =
	'__framescaperWebVcrSmokeCaptureGestureV1';



export function validateFramescaperWebVcrDormantSmokeResult(value, plan) {
	const result = closed(value, [
		'schemaVersion', 'mode', 'productId', 'token', 'diagnosticOnly', 'preloadBridge',
		'capability', 'openAttempted',
	], 'dormant smoke result');
	matchEnvelope(result, plan, FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE);
	exactArray(result.preloadBridge, PRELOAD_BRIDGE, 'dormant preload bridge');
	const capability = closed(result.capability, ['status', 'resolutions'], 'dormant capability');
	exactArray(capability.resolutions, ['720p', '1080p'], 'dormant baseline resolutions');
	if (capability.status !== 'available' || result.openAttempted !== false) {
		throw new Error('Production Web VCR result did not stay guest-lazy.');
	}
	return value;
}

export function validateFramescaperWebVcrPackagedSmokeResult(value, plan) {
	const result = closed(value, [
		'schemaVersion', 'mode', 'productId', 'token', 'diagnosticOnly', 'preloadBridge',
		'capability', 'persistence', 'input', 'captures', 'target', 'lifecycle', 'clearData',
		'teardown', 'audioBoundary', 'displaySecurity',
	], 'packaged smoke result');
	validatePackagedRendererEvidence(result, plan);
	const displaySecurity = closed(result.displaySecurity, ['requests'], 'display security');
	if (!Array.isArray(displaySecurity.requests) || displaySecurity.requests.length !== 2) {
		throw new Error('Packaged smoke requires exact 720p and 1080p display-security witnesses.');
	}
	for (const [index, resolution] of ['720p', '1080p'].entries()) {
		const request = closed(displaySecurity.requests[index], [
			'version', 'stage', 'resolution', 'windowLive', 'focused', 'frameMatches',
			'originMatches', 'editorDocument', 'ownerAvailable', 'userGesture',
			'videoRequested', 'audioRequested', 'pending', 'systemPicker', 'outcome',
		], `${resolution} display security`);
		if (request.version !== 1 || request.stage !== 'display-request'
			|| request.resolution !== resolution || request.windowLive !== true
			|| request.focused !== true || request.frameMatches !== true
			|| request.originMatches !== true || request.editorDocument !== true
			|| request.ownerAvailable !== true || request.userGesture !== true
			|| request.videoRequested !== true || request.audioRequested !== true
			|| request.pending !== true || request.systemPicker !== false
			|| request.outcome !== 'granted-web-vcr') {
			throw new Error(`Packaged smoke ${resolution} display-security evidence is invalid.`);
		}
	}
	return value;
}

export function validateFramescaperWebVcrPackagedRendererSmokeResult(value, plan) {
	const result = closed(value, [
		'schemaVersion', 'mode', 'productId', 'token', 'diagnosticOnly', 'preloadBridge',
		'capability', 'persistence', 'input', 'captures', 'target', 'lifecycle', 'clearData',
		'teardown', 'audioBoundary',
	], 'packaged renderer smoke result');
	validatePackagedRendererEvidence(result, plan);
	return value;
}

function validatePackagedRendererEvidence(result, plan) {
	matchEnvelope(result, plan, FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE);
	exactArray(result.preloadBridge, PRELOAD_BRIDGE, 'packaged preload bridge');
	const capability = closed(result.capability, ['resolutions', 'fourKUnavailable'], 'packaged capability');
	exactArray(capability.resolutions, ['720p', '1080p'], 'packaged resolutions');
	if (capability.fourKUnavailable !== true) throw new Error('Packaged smoke unexpectedly admitted 4K.');
	truthRecord(result.persistence, ['authenticatedBeforeClear', 'anonymousAfterClear'], 'persistence');
	const input = closed(result.input, ['value', 'pointerX', 'pointerY', 'scaled'], 'input');
	if (input.value !== 'smoke' || input.pointerX !== 64 || input.pointerY !== 160 || input.scaled !== true) {
		throw new Error('Packaged smoke input evidence is invalid.');
	}
	if (!Array.isArray(result.captures) || result.captures.length !== 2) {
		throw new Error('Packaged smoke requires exactly two capture results.');
	}
	for (const [index, resolution] of ['720p', '1080p'].entries()) {
		const capture = closed(result.captures[index], [
			'resolution', 'width', 'height', 'videoTracks', 'audioTracks', 'nonSilentAudio', 'peakRms',
			'visualMarker',
		], `${resolution} capture`);
		const dimensions = CAPTURE_DIMENSIONS[resolution];
		if (capture.resolution !== resolution || capture.width !== dimensions.width
			|| capture.height !== dimensions.height || capture.videoTracks !== 1 || capture.audioTracks !== 1) {
			throw new Error(`Packaged smoke ${resolution} track evidence is invalid.`);
		}
		if (resolution === '720p') {
			if (capture.nonSilentAudio !== true || typeof capture.peakRms !== 'number'
				|| capture.peakRms < 0.002 || capture.peakRms > 1) {
				throw new Error('Packaged smoke page-audio energy evidence is invalid.');
			}
		} else if (capture.nonSilentAudio !== null || capture.peakRms !== null) {
			throw new Error('Packaged smoke 1080p energy sentinel is invalid.');
		}
		validateVisualMarker(capture.visualMarker, resolution);
	}
	const target = closed(result.target, [
		'intrinsicWidth', 'intrinsicHeight', 'aperture', 'playing', 'ended',
	], 'target');
	if (target.intrinsicWidth !== 640 || target.intrinsicHeight !== 360
		|| target.playing !== true || target.ended !== true) throw new Error('Packaged target evidence is invalid.');
	const aperture = closed(target.aperture, ['x', 'y', 'width', 'height'], 'target aperture');
	if (![aperture.x, aperture.y, aperture.width, aperture.height].every(Number.isFinite)
		|| aperture.x < 0 || aperture.y < 0 || aperture.width <= 0 || aperture.height <= 0
		|| aperture.x + aperture.width > 1.000001 || aperture.y + aperture.height > 1.000001) {
		throw new Error('Packaged target aperture is invalid.');
	}
	truthRecord(result.lifecycle, ['preparing', 'recording', 'finalizing', 'ready'], 'lifecycle');
	truthRecord(result.clearData, ['freshSession', 'generationAdvanced'], 'clear data');
	truthRecord(result.teardown, ['tracksStopped', 'guestDisposed'], 'teardown');
	truthRecord(result.audioBoundary, [
		'guestNativeAudioMuted', 'capturedPageAudioNonSilent', 'enableLocalEchoFalseAuthorityPath',
	], 'audio boundary');
}

function validateVisualMarker(value, resolution) {
	const marker = closed(value, [
		'sampledRgb', 'maxChannelDelta', 'tolerance', 'matched',
	], `${resolution} visual marker`);
	const expected = [[23, 197, 89], [211, 43, 173]];
	if (!Array.isArray(marker.sampledRgb) || marker.sampledRgb.length !== 2
		|| marker.sampledRgb.some((sample) => !Array.isArray(sample) || sample.length !== 3
			|| sample.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255))) {
		throw new Error(`Packaged smoke ${resolution} visual marker pixels are invalid.`);
	}
	const delta = Math.max(...marker.sampledRgb.flatMap((sample, index) => sample.map(
		(channel, channelIndex) => Math.abs(channel - expected[index][channelIndex]),
	)));
	if (marker.tolerance !== 32 || marker.matched !== true
		|| marker.maxChannelDelta !== delta || delta > marker.tolerance) {
		throw new Error(`Packaged smoke ${resolution} visual marker evidence is invalid.`);
	}
}

function matchEnvelope(value, plan, mode) {
	if (value.schemaVersion !== 1 || value.mode !== mode || value.productId !== 'framescaper'
		|| value.token !== plan?.token || value.diagnosticOnly !== true) {
		throw new Error('Framescaper Web VCR smoke result does not match its diagnostic-only plan.');
	}
}

function truthRecord(value, fields, label) {
	const record = closed(value, fields, label);
	if (fields.some((field) => record[field] !== true)) {
		throw new Error(`Framescaper Web VCR ${label} evidence is incomplete.`);
	}
	return record;
}

function exactArray(value, expected, label) {
	if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
		throw new Error(`Framescaper Web VCR ${label} drifted.`);
	}
}

function closed(value, fields, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== fields.length
		|| Reflect.ownKeys(value).some((field) => typeof field !== 'string' || !fields.includes(field))) {
		throw new TypeError(`Framescaper Web VCR ${label} must be closed.`);
	}
	return value;
}
