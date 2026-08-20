/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRegularIntervalAnnotationCommand } from '../src/common/editor/controller/regular-interval-annotation-service.ts';
import { createRegularIntervalAnnotationController } from '../src/common/editor/controller/regular-interval-annotation-controller.ts';
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand } from '../src/common/editor/history.js';
import {
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import type { TimelineAnnotationV11 } from '../src/common/editor/timeline-annotation.ts';

const NOW = new Date('2026-08-09T14:00:00.000Z');

test('plans sample markers and regions as one stable batch', () => {
	const project = createCurrentAudioEditorProject({ id: 'regular-sample', now: NOW });
	const markerPlan = createRegularIntervalAnnotationCommand(project, {
		kind: 'marker',
		anchor: 'sample',
		sequenceId: project.primarySequenceId,
		startFrame: 0,
		endFrame: 10,
		intervalFrames: 4,
		namePrefix: 'Cue',
		color: 'orange',
	}, sequentialIds());
	assert.deepEqual(markerPlan.annotationIds, [
		'timeline-annotation-1',
		'timeline-annotation-2',
		'timeline-annotation-3',
	]);
	assert.equal(markerPlan.batchId, 'timeline-annotation-batch-0');
	assert.deepEqual(annotations(markerPlan.command).map((annotation) => ({
		name: annotation.name,
		batchId: annotation.batchId,
		positionFrame: 'positionFrame' in annotation ? annotation.positionFrame : null,
	})), [
		{ name: 'Cue 1', batchId: markerPlan.batchId, positionFrame: 0 },
		{ name: 'Cue 2', batchId: markerPlan.batchId, positionFrame: 4 },
		{ name: 'Cue 3', batchId: markerPlan.batchId, positionFrame: 8 },
	]);

	const regionPlan = createRegularIntervalAnnotationCommand(project, {
		kind: 'region',
		anchor: 'sample',
		sequenceId: project.primarySequenceId,
		startFrame: 0,
		endFrame: 10,
		intervalFrames: 4,
		namePrefix: 'Section',
		color: 'auto',
	}, sequentialIds());
	assert.deepEqual(annotations(regionPlan.command).map((annotation) => (
		'startFrame' in annotation ? [annotation.startFrame, annotation.endFrame] : null
	)), [[0, 4], [4, 8], [8, 10]]);
});

test('plans exact musical intervals and can include the terminal marker', () => {
	const project = createCurrentAudioEditorProject({ id: 'regular-musical', now: NOW });
	const plan = createRegularIntervalAnnotationCommand(project, {
		kind: 'marker',
		anchor: 'musical',
		sequenceId: project.primarySequenceId,
		startBeat: { num: 0, den: 1 },
		endBeat: { num: 3, den: 2 },
		intervalBeats: { num: 1, den: 2 },
		includeEnd: true,
		namePrefix: '',
		color: 'violet',
	}, sequentialIds());
	assert.deepEqual(annotations(plan.command).map((annotation) => (
		'positionBeat' in annotation ? annotation.positionBeat : null
	)), [
		{ num: 0, den: 1 },
		{ num: 1, den: 2 },
		{ num: 1, den: 1 },
		{ num: 3, den: 2 },
	]);
	assert.deepEqual(annotations(plan.command).map(({ name }) => name), ['1', '2', '3', '4']);
});

test('one command creates, undoes, and redoes the complete interval batch', () => {
	const project = createCurrentAudioEditorProject({ id: 'regular-history', now: NOW });
	const plan = createRegularIntervalAnnotationCommand(project, {
		kind: 'region',
		anchor: 'musical',
		sequenceId: project.primarySequenceId,
		startBeat: { num: 0, den: 1 },
		endBeat: { num: 5, den: 4 },
		intervalBeats: { num: 1, den: 2 },
		namePrefix: 'Phrase',
		color: 'teal',
	}, sequentialIds());
	let history = executeEditorCommand(createEditorHistory(project), plan.command, { now: NOW });
	assert.equal(history.undoStack.length, 1);
	assert.equal(history.present.timelineAnnotations.length, 3);
	assert.deepEqual(new Set((history.present.timelineAnnotations as TimelineAnnotationV11[])
		.map(({ batchId }) => batchId)), new Set([plan.batchId]));
	const edited = structuredClone(history.present.timelineAnnotations);
	history = undoEditorCommand(history, { now: NOW });
	assert.deepEqual(history.present.timelineAnnotations, []);
	history = redoEditorCommand(history, { now: NOW });
	assert.deepEqual(history.present.timelineAnnotations, edited);
});

test('controller composes the planner into exactly one project commit', () => {
	const project = createCurrentAudioEditorProject({ id: 'regular-controller', now: NOW });
	const commands: unknown[] = [];
	const controller = createRegularIntervalAnnotationController({
		getProject: () => project,
		editingBlocked: () => false,
		createId: sequentialIds(),
		commit: (command) => { commands.push(command); },
	});
	assert.deepEqual(controller.create({
		kind: 'marker', anchor: 'sample', sequenceId: project.primarySequenceId,
		startFrame: 0, endFrame: 5, intervalFrames: 2, namePrefix: 'Cue', color: 'auto',
	}), ['timeline-annotation-1', 'timeline-annotation-2', 'timeline-annotation-3']);
	assert.equal(commands.length, 1);
	assert.equal((commands[0] as { readonly type: string }).type, 'batch');
});

test('rejects unsafe ranges, capacity overflow, schema mismatches, and unstable identities before mutation', () => {
	const project = createCurrentAudioEditorProject({ id: 'regular-invalid', now: NOW });
	const base = {
		kind: 'marker' as const,
		anchor: 'sample' as const,
		sequenceId: project.primarySequenceId,
		startFrame: 0,
		endFrame: 10,
		intervalFrames: 2,
		namePrefix: 'Cue',
		color: 'auto' as const,
	};
	assert.throws(() => createRegularIntervalAnnotationCommand(project, {
		...base, intervalFrames: 0,
	}, sequentialIds()), /interval/iu);
	assert.throws(() => createRegularIntervalAnnotationCommand(project, {
		...base, startFrame: 10, endFrame: 10,
	}, sequentialIds()), /range/iu);
	assert.throws(() => createRegularIntervalAnnotationCommand(project, {
		...base, kind: 'region', includeEnd: true,
	}, sequentialIds()), /includeEnd.*marker/iu);
	assert.throws(() => createRegularIntervalAnnotationCommand({
		...project,
		schemaVersion: 10,
	} as never, base, sequentialIds()), /schema 11/iu);
	assert.throws(() => createRegularIntervalAnnotationCommand({
		...project,
		timelineAnnotations: Array.from({ length: 4_095 }, () => null),
	} as never, base, sequentialIds()), /4,?096|capacity/iu);
	assert.throws(() => createRegularIntervalAnnotationCommand(project, base, () => 'duplicate'), /duplicate|batch/iu);
});

function annotations(command: Readonly<{ readonly commands: readonly unknown[] }>): TimelineAnnotationV11[] {
	return command.commands.map((child) => (
		child as Readonly<{ readonly annotation: TimelineAnnotationV11 }>
	).annotation);
}

function sequentialIds(): (prefix: string) => string {
	let index = 0;
	return (prefix) => `${prefix}-${String(index++)}`;
}
