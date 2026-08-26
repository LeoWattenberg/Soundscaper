/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	reviewAssistanceOcrResultV1,
	reviewAssistanceReframePathResultV1,
	reviewAssistanceSaliencyResultV1,
	reviewAssistanceSubjectResultV1,
	type AssistanceVisualFrameAuthorityV1,
} from '../src/common/editor/assistance/visual-semantic-results-v1.ts';

const AUTHORITY: AssistanceVisualFrameAuthorityV1 = Object.freeze({
	width: 1_920,
	height: 1_080,
	timescale: 90_000,
	frames: Object.freeze([
		Object.freeze({ sourceFrame: 10, presentationTick: '0' }),
		Object.freeze({ sourceFrame: 20, presentationTick: '3003' }),
	]),
});

test('OCR review binds bounded regions to every exact VFR frame', () => {
	const reviewed = reviewAssistanceOcrResultV1({
		schemaVersion: 1, width: 1_920, height: 1_080, timescale: 90_000,
		frames: [{ sourceFrame: 10, presentationTick: '0', regions: [{
			text: 'ON AIR', confidence: 0.95,
			box: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
		}] }, { sourceFrame: 20, presentationTick: '3003', regions: [] }],
	}, AUTHORITY);
	assert.deepEqual(reviewed.frames[0]?.regions[0], {
		text: 'ON AIR', confidence: 0.95,
		box: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
	});
	assert.ok(Object.isFrozen(reviewed.frames[0]?.regions));
});

test('subject and saliency review preserve non-biometric detections and exact samples', () => {
	const subjects = reviewAssistanceSubjectResultV1({
		schemaVersion: 1, width: 1_920, height: 1_080, timescale: 90_000,
		frames: [{ sourceFrame: 10, presentationTick: '0', subjects: [{
			kind: 'face', classId: null, label: 'face', confidence: 0.8,
			box: { x: 0.2, y: 0.1, width: 0.2, height: 0.4 },
		}] }, { sourceFrame: 20, presentationTick: '3003', subjects: [{
			kind: 'person', classId: 0, label: 'person', confidence: 0.7,
			box: { x: 0.4, y: 0.1, width: 0.4, height: 0.8 },
		}] }],
	}, AUTHORITY);
	assert.equal(subjects.frames[0]?.subjects[0]?.kind, 'face');
	assert.equal(subjects.frames[1]?.subjects[0]?.classId, 0);

	const saliency = reviewAssistanceSaliencyResultV1({
		schemaVersion: 1, width: 1_920, height: 1_080, timescale: 90_000,
		frames: [{ sourceFrame: 10, presentationTick: '0', saliency: {
			x: 0.25, y: 0.75, score: 0.6,
		} }, { sourceFrame: 20, presentationTick: '3003', saliency: null }],
	}, AUTHORITY);
	assert.deepEqual(saliency.frames.map(({ saliency: value }) => value), [
		{ x: 0.25, y: 0.75, score: 0.6 }, null,
	]);
});

test('visual semantic review rejects invented timing, unsafe text, NaN, and escaped boxes', () => {
	const emptyOcr = {
		schemaVersion: 1, width: 1_920, height: 1_080, timescale: 90_000,
		frames: [{ sourceFrame: 10, presentationTick: '0', regions: [] },
			{ sourceFrame: 20, presentationTick: '3003', regions: [] }],
	};
	assert.throws(() => reviewAssistanceOcrResultV1({
		...emptyOcr, frames: emptyOcr.frames.slice(0, 1),
	}, AUTHORITY), /every|authority|inventory/iu);
	assert.throws(() => reviewAssistanceOcrResultV1({
		...emptyOcr, frames: [{ ...emptyOcr.frames[0], presentationTick: '1' }, emptyOcr.frames[1]],
	}, AUTHORITY), /authority|timing/iu);
	assert.throws(() => reviewAssistanceOcrResultV1({
		...emptyOcr, frames: [{ ...emptyOcr.frames[0], regions: [{
			text: 'bad\u0000text', confidence: 1,
			box: { x: 0, y: 0, width: 1, height: 1 },
		}] }, emptyOcr.frames[1]],
	}, AUTHORITY), /text/iu);
	assert.throws(() => reviewAssistanceSubjectResultV1({
		...emptyOcr, frames: [{ sourceFrame: 10, presentationTick: '0', subjects: [{
			kind: 'object', classId: 1, label: 'thing', confidence: Number.NaN,
			box: { x: 0.9, y: 0, width: 0.2, height: 1 },
		}] }, { sourceFrame: 20, presentationTick: '3003', subjects: [] }],
	}, AUTHORITY), /confidence|box/iu);
	assert.throws(() => reviewAssistanceSaliencyResultV1({
		...emptyOcr, frames: [{ sourceFrame: 10, presentationTick: '0', saliency: {
			x: Number.NaN, y: 0, score: 1,
		} }, { sourceFrame: 20, presentationTick: '3003', saliency: null }],
	}, AUTHORITY), /saliency|finite|between/iu);
});

test('reframe-path review admits only ordered crop keyframes bound to sampled authority', () => {
	const reviewed = reviewAssistanceReframePathResultV1({
		schemaVersion: 1,
		targetAspect: { width: 9, height: 16 },
		keyframes: [{ sourceFrame: 10, authority: 'subject', trackIds: ['track-1'],
			crop: { left: 0.2, top: 0, right: 0.2375, bottom: 0 } },
		{ sourceFrame: 20, authority: 'center', trackIds: [],
			crop: { left: 0.21875, top: 0, right: 0.21875, bottom: 0 } }],
	}, AUTHORITY);
	assert.equal(reviewed.targetAspect.width, 9);
	assert.equal(reviewed.keyframes[0]?.trackIds[0], 'track-1');

	assert.throws(() => reviewAssistanceReframePathResultV1({
		...reviewed, keyframes: [{ ...reviewed.keyframes[0], trackIds: [] }, reviewed.keyframes[1]],
	}, AUTHORITY), /subject.*track/iu);
	assert.throws(() => reviewAssistanceReframePathResultV1({
		...reviewed, keyframes: [reviewed.keyframes[0], {
			...reviewed.keyframes[1], crop: { left: 0.6, top: 0, right: 0.5, bottom: 0 },
		}],
	}, AUTHORITY), /positive|crop/iu);
});
