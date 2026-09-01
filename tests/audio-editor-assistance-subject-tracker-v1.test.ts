/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_DETECTIONS_PER_FRAME,
	ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_FRAMES,
	trackAssistanceSubjectsV1,
} from '../src/common/editor/assistance/subject-tracker-v1.ts';
import { planAssistanceReframePathV1 } from '../src/common/editor/assistance/reframe-planner-v1.ts';

const face = (
	x: number,
	confidence = 0.9,
): Readonly<Record<string, unknown>> => ({
	kind: 'face', classId: null, label: 'face', confidence,
	box: { x, y: 0.1, width: 0.2, height: 0.4 },
});

const person = (
	x: number,
	confidence = 0.8,
): Readonly<Record<string, unknown>> => ({
	kind: 'person', classId: 0, label: 'person', confidence,
	box: { x, y: 0.1, width: 0.3, height: 0.8 },
});

const request = (
	frames: readonly Readonly<Record<string, unknown>>[],
	shotAnchorFrames: readonly number[] = [],
): Readonly<Record<string, unknown>> => ({
	schemaVersion: 1,
	width: 1_920,
	height: 1_080,
	timescale: 90_000,
	shotAnchorFrames,
	frames,
});

test('subject tracking deterministically associates anonymous face and object tracks', () => {
	const tracked = trackAssistanceSubjectsV1(request([
		{ sourceFrame: 10, presentationTick: '0', subjects: [person(0.6), face(0.1)] },
		{ sourceFrame: 20, presentationTick: '45000', subjects: [face(0.12), person(0.58)] },
	]));

	assert.deepEqual(tracked.frames.map(({ subjects }) => subjects.map((subject) => ({
		trackId: subject.trackId,
		kind: subject.kind,
		x: subject.box.x,
	}))), [[
		{ trackId: 'subject-000001', kind: 'face', x: 0.1 },
		{ trackId: 'subject-000002', kind: 'object', x: 0.6 },
	], [
		{ trackId: 'subject-000001', kind: 'face', x: 0.12 },
		{ trackId: 'subject-000002', kind: 'object', x: 0.58 },
	]]);
	assert.deepEqual(
		trackAssistanceSubjectsV1(request([
			{ sourceFrame: 10, presentationTick: '0', subjects: [person(0.6), face(0.1)] },
			{ sourceFrame: 20, presentationTick: '45000', subjects: [face(0.12), person(0.58)] },
		])),
		tracked,
	);
	assert.ok(Object.isFrozen(tracked));
	assert.ok(Object.isFrozen(tracked.frames[0]?.subjects[0]?.box));

	const path = planAssistanceReframePathV1({
		sourceSize: { width: 1_920, height: 1_080 },
		targetAspect: { width: 9, height: 16 },
		samples: tracked.frames.map(({ sourceFrame, subjects }) => ({
			sourceFrame, subjects, saliency: null,
		})),
	});
	assert.deepEqual(path[0]?.trackIds, ['subject-000001', 'subject-000002']);
});

test('ByteTrack-style low-confidence recovery interpolates only a bounded observed gap', () => {
	const tracked = trackAssistanceSubjectsV1(request([
		{ sourceFrame: 0, presentationTick: '0', subjects: [face(0, 0.9)] },
		{ sourceFrame: 15, presentationTick: '45000', subjects: [] },
		{ sourceFrame: 30, presentationTick: '90000', subjects: [face(0.1, 0.3)] },
	]));

	assert.deepEqual(tracked.frames.map(({ subjects }) => subjects.map((subject) => ({
		trackId: subject.trackId,
		x: subject.box.x,
		confidence: subject.confidence,
	}))), [[
		{ trackId: 'subject-000001', x: 0, confidence: 0.9 },
	], [
		{ trackId: 'subject-000001', x: 0.05, confidence: 0.6 },
	], [
		{ trackId: 'subject-000001', x: 0.1, confidence: 0.3 },
	]]);

	const lowOnly = trackAssistanceSubjectsV1(request([
		{ sourceFrame: 0, presentationTick: '0', subjects: [face(0, 0.2)] },
	]));
	assert.deepEqual(lowOnly.frames[0]?.subjects, []);
});

test('interpolated boxes stay inside normalized geometry after canonical rounding', () => {
	const x = 0.1234567890125;
	const width = 1 - x;
	const detection = { ...face(x), box: { x, y: 0.1, width, height: 0.4 } };
	const tracked = trackAssistanceSubjectsV1(request([
		{ sourceFrame: 0, presentationTick: '0', subjects: [detection] },
		{ sourceFrame: 15, presentationTick: '45000', subjects: [] },
		{ sourceFrame: 30, presentationTick: '90000', subjects: [detection] },
	]));
	const box = tracked.frames[1]?.subjects[0]?.box;
	assert.ok(box);
	assert.ok(box.x + box.width <= 1);
	assert.doesNotThrow(() => planAssistanceReframePathV1({
		sourceSize: { width: 1_920, height: 1_080 },
		targetAspect: { width: 9, height: 16 },
		samples: tracked.frames.map(({ sourceFrame, subjects }) => ({
			sourceFrame, subjects, saliency: null,
		})),
	}));
});

test('tracking expires long gaps and resets exact shot anchors without interpolation', () => {
	const expired = trackAssistanceSubjectsV1(request([
		{ sourceFrame: 0, presentationTick: '0', subjects: [face(0)] },
		{ sourceFrame: 15, presentationTick: '45000', subjects: [] },
		{ sourceFrame: 30, presentationTick: '90000', subjects: [] },
		{ sourceFrame: 45, presentationTick: '135001', subjects: [face(0.02)] },
	]));
	assert.deepEqual(expired.frames.map(({ subjects }) => subjects.map(({ trackId }) => trackId)), [
		['subject-000001'], [], [], ['subject-000002'],
	]);

	const cut = trackAssistanceSubjectsV1(request([
		{ sourceFrame: 0, presentationTick: '0', subjects: [face(0)] },
		{ sourceFrame: 10, presentationTick: '30000', subjects: [] },
		{ sourceFrame: 20, presentationTick: '60000', subjects: [face(0.01)] },
	], [20]));
	assert.deepEqual(cut.frames.map(({ subjects }) => subjects.map(({ trackId }) => trackId)), [
		['subject-000001'], [], ['subject-000002'],
	]);
});

test('association ties resolve by stable track ID and normalized spatial order', () => {
	const tracked = trackAssistanceSubjectsV1(request([
		{ sourceFrame: 0, presentationTick: '0', subjects: [person(0.4), person(0.4)] },
		{ sourceFrame: 15, presentationTick: '45000', subjects: [person(0.45), person(0.35)] },
	]));
	assert.deepEqual(tracked.frames[1]?.subjects.map(({ trackId, box }) => ({ trackId, x: box.x })), [
		{ trackId: 'subject-000001', x: 0.35 },
		{ trackId: 'subject-000002', x: 0.45 },
	]);
});

test('tracking refuses biometric identity, unknown fields, non-finite geometry, and bad timing', () => {
	assert.throws(() => trackAssistanceSubjectsV1(request([{
		sourceFrame: 0, presentationTick: '0', subjects: [{
			...face(0), label: 'Alice',
		}],
	}])), /biometric|face|identity/iu);
	assert.throws(() => trackAssistanceSubjectsV1(request([{
		sourceFrame: 0, presentationTick: '0', subjects: [{
			...face(0), embedding: [0.1, 0.2],
		}],
	}])), /fields|unsupported/iu);
	assert.throws(() => trackAssistanceSubjectsV1(request([{
		sourceFrame: 0, presentationTick: '0', subjects: [{
			...face(0), box: { x: Number.NaN, y: 0, width: 0.2, height: 0.2 },
		}],
	}])), /box|finite|geometry/iu);
	assert.throws(() => trackAssistanceSubjectsV1(request([
		{ sourceFrame: 1, presentationTick: '10', subjects: [] },
		{ sourceFrame: 2, presentationTick: '10', subjects: [] },
	])), /ordered|timing|tick/iu);
	assert.throws(() => trackAssistanceSubjectsV1(request([
		{ sourceFrame: 1, presentationTick: '10', subjects: [] },
	], [2])), /anchor|sample/iu);
});

test('tracking rejects oversized inventories before visiting their entries', () => {
	assert.throws(() => trackAssistanceSubjectsV1(request(
		new Array(ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_FRAMES + 1),
	)), /frame.*bound|inventory/iu);
	assert.throws(() => trackAssistanceSubjectsV1(request([{
		sourceFrame: 0,
		presentationTick: '0',
		subjects: new Array(ASSISTANCE_SUBJECT_TRACKING_MAXIMUM_DETECTIONS_PER_FRAME + 1),
	}])), /detection|subject.*bound|inventory/iu);
});
