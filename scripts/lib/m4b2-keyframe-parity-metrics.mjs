/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	compareM4ParityVideo,
	decodeM4ParityRgba,
	validateM4ParityRenderReport,
} from './m4-production-parity-metrics.mjs';

const OUTCOMES = Object.freeze(['rendered', 'substituted', 'fallback', 'omitted']);

export { compareM4ParityVideo as compareM4B2KeyframeParityVideo };

/** Build the independent local semantic oracle for one opaque source/keyed-opacity frame. */
export function createM4B2KeyframeParityExpectedRgba(
	source,
	drawableSourceFrame,
	opacity,
	width,
	height,
) {
	const frameWidth = positiveInteger(width, 'expected RGBA width');
	const frameHeight = positiveInteger(height, 'expected RGBA height');
	const frameByteLength = frameWidth * frameHeight * 4;
	if (!(source instanceof Uint8Array) || source.byteLength < frameByteLength
		|| source.byteLength % frameByteLength !== 0) {
		throw new Error('Expected RGBA source must contain complete frames.');
	}
	const sourceFrameCount = source.byteLength / frameByteLength;
	if (!Number.isSafeInteger(drawableSourceFrame) || drawableSourceFrame < 0
		|| drawableSourceFrame >= sourceFrameCount) {
		throw new RangeError('Expected drawable source frame is outside the source fixture.');
	}
	if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
		throw new RangeError('Expected keyed opacity must be finite and inside [0, 1].');
	}
	const sourceStart = drawableSourceFrame * frameByteLength;
	const expected = new Uint8Array(frameByteLength);
	for (let offset = 0; offset < frameByteLength; offset += 4) {
		const sourceOffset = sourceStart + offset;
		if (source[sourceOffset + 3] !== 255) throw new Error('Expected RGBA source must be opaque.');
		expected[offset] = Math.round(source[sourceOffset] * opacity);
		expected[offset + 1] = Math.round(source[sourceOffset + 1] * opacity);
		expected[offset + 2] = Math.round(source[sourceOffset + 2] * opacity);
		expected[offset + 3] = 255;
	}
	return expected;
}

/** Decode one complete canonical RGBA frame. */
export function decodeM4B2KeyframeParityRgba(value, width, height, label) {
	return decodeM4ParityRgba(value, positiveInteger(width, 'width')
		* positiveInteger(height, 'height') * 4, label);
}

/** Decode the complete canonical frame-major source media. */
export function decodeM4B2KeyframeParitySourceRgba(value, width, height, frameCount, label) {
	return decodeM4ParityRgba(value, positiveInteger(width, 'source width')
		* positiveInteger(height, 'source height') * 4
		* positiveInteger(frameCount, 'source frame count'), label);
}

/** Validate one consumer's exact keyed-operation partition and compositor ledger. */
export function validateM4B2KeyframeConsumerLedger(value, expected, path) {
	const ledger = exactRecord(
		value,
		['operationId', 'outcomes', 'renderReport', 'stateValue'],
		path,
	);
	const operationId = boundedString(expected.operationId, `${path} expected operation ID`);
	const clipId = boundedString(expected.clipId, `${path} expected clip ID`);
	if (ledger.operationId !== operationId) throw new Error(`${path}.operationId is not canonical.`);
	const outcomes = exactRecord(
		ledger.outcomes,
		['fallback', 'omitted', 'rendered', 'requested', 'substituted'],
		`${path}.outcomes`,
	);
	const requested = operationIds(outcomes.requested, `${path}.outcomes.requested`);
	if (requested.length !== 1 || requested[0] !== operationId) {
		throw new Error(`${path} must request its one exact keyed operation.`);
	}
	const partitions = new Map(OUTCOMES.map((name) => [
		name,
		operationIds(outcomes[name], `${path}.outcomes.${name}`),
	]));
	const combined = OUTCOMES.flatMap((name) => partitions.get(name));
	if (combined.length !== 1 || combined[0] !== operationId) {
		throw new Error(`${path} outcomes must exactly partition its requested keyed operation.`);
	}
	const outcome = OUTCOMES.find((name) => partitions.get(name).length === 1);
	if (outcome === undefined) throw new Error(`${path} has no keyed operation outcome.`);
	const stateValue = ledger.stateValue;
	if (outcome === 'rendered' || outcome === 'substituted') {
		if (typeof stateValue !== 'number' || !Number.isFinite(stateValue)) {
			throw new Error(`${path}.stateValue must be finite for a consumed keyed operation.`);
		}
	} else if (stateValue !== null) {
		throw new Error(`${path}.stateValue must be null when no keyed state was consumed.`);
	}
	const report = validateM4ParityRenderReport(ledger.renderReport, `${path}.renderReport`);
	if (report.requestedEffects.length !== 0
		|| report.requestedCompositions.length !== 1
		|| report.requestedCompositions[0] !== `composition:${clipId}`) {
		throw new Error(`${path} compositor report does not request its exact clip.`);
	}
	if (ledger.renderReport.composition?.requested[0]?.blendMode !== 'normal') {
		throw new Error(`${path} compositor report requires canonical normal composition.`);
	}
	const compositorOmitted = report.unrendered.includes(`composition:${clipId}`);
	if ((outcome === 'rendered' || outcome === 'substituted') && compositorOmitted) {
		throw new Error(`${path} claims consumption while its compositor omitted the clip.`);
	}
	if (outcome === 'rendered' && (
		ledger.renderReport.status !== 'rendered'
		|| ledger.renderReport.rendererStatus !== 'available'
	)) throw new Error(`${path} direct keyed consumption requires a rendered compositor report.`);
	const expectedRenderedEntryCount = outcome === 'rendered' || outcome === 'substituted' ? 1 : 0;
	if (ledger.renderReport.renderedEntryCount !== expectedRenderedEntryCount) {
		throw new Error(
			`${path}.renderReport.renderedEntryCount must be exactly ${String(expectedRenderedEntryCount)} for its keyed outcome.`,
		);
	}
	if (outcome === 'fallback' && ledger.renderReport.status !== 'fallback') {
		throw new Error(`${path} fallback must agree with its compositor report.`);
	}
	if (outcome === 'omitted' && !compositorOmitted) {
		throw new Error(`${path} omission must agree with its compositor report.`);
	}
	return Object.freeze({
		outcome,
		stateValue,
		counts: Object.freeze({
			omitted: outcome === 'omitted' ? 1 : 0,
			substituted: outcome === 'substituted' ? 1 : 0,
			fallback: outcome === 'fallback' ? 1 : 0,
		}),
	});
}

function operationIds(value, path) {
	if (!Array.isArray(value) || value.length > 1) throw new Error(`${path} must be a bounded array.`);
	const ids = value.map((candidate) => boundedString(candidate, path));
	if (new Set(ids).size !== ids.length) throw new Error(`${path} contains duplicate IDs.`);
	return ids;
}

function boundedString(value, path) {
	if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
		throw new Error(`${path} must be a bounded string.`);
	}
	return value;
}

function exactRecord(value, fields, path) {
	if (!isRecord(value)) throw new Error(`${path} must be a plain record.`);
	const actual = Object.keys(value).sort();
	const expected = [...fields].sort();
	if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
		throw new Error(`${path} must contain the exact fields.`);
	}
	return value;
}

function positiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${path} must be a positive integer.`);
	return value;
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
