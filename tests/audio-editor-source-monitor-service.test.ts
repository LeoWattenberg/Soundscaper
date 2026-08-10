/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { createSourceMonitorService } from '../src/common/editor/controller/source-monitor-service.ts';

const RATE = Object.freeze({ num: 25, den: 1 });
const COUNT = 250;

function harness(overrides: Record<string, unknown> = {}) {
	let published = 0;
	let project: Record<string, unknown> = {
		id: 'monitor-project',
		sampleRate: 48_000,
		primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: RATE }],
		tracks: [],
		clips: [],
		sources: [
			{ id: 'take-1-video', kind: 'video', name: 'Take 1', frameRate: RATE, sourceFrameCount: COUNT },
			{ id: 'take-2-video', kind: 'video', name: 'Take 2', frameRate: RATE, sourceFrameCount: 100 },
			{ id: 'take-1-audio', kind: 'audio', frameCount: 480_000, sampleRate: 48_000 },
		],
		projectBin: {
			clips: [
				{ id: 'bin-video', kind: 'video', binItemId: 'take-1', sourceId: 'take-1-video' },
				{ id: 'bin-audio', kind: 'audio', binItemId: 'take-1', sourceId: 'take-1-audio' },
				{ id: 'bin-video-2', kind: 'video', binItemId: 'take-2', sourceId: 'take-2-video' },
			],
		},
		...overrides,
	};
	const service = createSourceMonitorService({
		lifetime: new EditorControllerLifetime(),
		getProject: () => project,
		publishProjectState: () => { published += 1; },
	});
	return {
		service,
		publishedCount: () => published,
		setProject: (next: Record<string, unknown>) => { project = next; },
		project: () => project,
	};
}

test('a closed monitor answers empty rather than describing nothing', () => {
	const { service } = harness();
	assert.deepEqual(service.view(), {
		binItemId: null,
		sourceId: null,
		sourceName: null,
		frameRate: null,
		sourceFrameCount: 0,
		positionFrame: 0,
		markIn: null,
		markOut: null,
		timecodeLabel: null,
		mediaSeconds: 0,
	});
});

test('opening a bin item opens its video source at the head', () => {
	const { service, publishedCount } = harness();
	const view = service.open('take-1');
	assert.equal(view.binItemId, 'take-1');
	assert.equal(view.sourceId, 'take-1-video');
	assert.equal(view.sourceName, 'Take 1');
	assert.equal(view.sourceFrameCount, COUNT);
	assert.equal(view.positionFrame, 0);
	assert.equal(view.timecodeLabel, '00:00:00:00');
	assert.equal(publishedCount(), 1);
	assert.throws(() => service.open('missing'), ReferenceError);
});

test('the playhead moves in whole frames and stops at the media', () => {
	const { service } = harness();
	service.open('take-1');
	assert.equal(service.seek(100).positionFrame, 100);
	assert.equal(service.step(-1).positionFrame, 99);
	assert.equal(service.seek(-20).positionFrame, 0);
	assert.equal(service.step(-1).positionFrame, 0);
	assert.equal(service.seek(9_999).positionFrame, COUNT - 1);
	assert.equal(service.view().timecodeLabel, '00:00:09:24');
	// A media clock is derived from the frame, never the other way round.
	assert.equal(service.seek(25).mediaSeconds, 1.02);
});

test('marking uses the playhead and reports the pair the media can hold', () => {
	const { service } = harness();
	service.open('take-1');
	service.seek(40);
	assert.deepEqual(marks(service.markIn()), { markIn: 40, markOut: null });
	service.seek(89);
	assert.deepEqual(marks(service.markOut()), { markIn: 40, markOut: 90 });
	assert.deepEqual(service.points('take-1', 1), { sourceIn: 40, sourceOut: 90 });
	assert.deepEqual(marks(service.clearMarks()), { markIn: null, markOut: null });
	assert.deepEqual(service.points('take-1', 1), { sourceIn: 0, sourceOut: COUNT });
});

test('marks belong to the item they were set on', () => {
	const { service } = harness();
	service.open('take-1');
	service.seek(40);
	service.markIn();
	// Another item reads no marks at all rather than borrowing this range.
	assert.equal(service.points('take-2', 1), null);
	assert.equal(service.points(null, 1), null);
	assert.deepEqual(service.points('take-1', 2), { sourceIn: 40, sourceOut: null });
});

test('nothing is done to a monitor that is not open', () => {
	const { service, publishedCount } = harness();
	assert.equal(service.seek(10).sourceId, null);
	assert.equal(service.step(1).sourceId, null);
	assert.equal(service.markIn().sourceId, null);
	assert.equal(service.markOut().sourceId, null);
	assert.equal(service.clearMarks().sourceId, null);
	assert.equal(service.points('take-1', 1), null);
	assert.equal(publishedCount(), 0);
});

test('a source that leaves the document leaves the monitor empty', () => {
	const harnessed = harness();
	harnessed.service.open('take-1');
	harnessed.service.seek(40);
	harnessed.service.markIn();
	const project = harnessed.project();
	harnessed.setProject({
		...project,
		sources: (project.sources as Record<string, unknown>[]).filter((source) => source.id !== 'take-1-video'),
	});
	assert.equal(harnessed.service.view().sourceId, null);
	assert.equal(harnessed.service.points('take-1', 1), null);
});

test('a shortened source drops the marks it can no longer hold', () => {
	const harnessed = harness();
	harnessed.service.open('take-1');
	harnessed.service.seek(200);
	harnessed.service.markIn();
	const project = harnessed.project();
	// A re-read that corrected the frame count leaves the mark past the end.
	harnessed.setProject({
		...project,
		sources: (project.sources as Record<string, unknown>[]).map((source) => (
			source.id === 'take-1-video' ? { ...source, sourceFrameCount: 100 } : source
		)),
	});
	const view = harnessed.service.view();
	assert.equal(view.sourceFrameCount, 100);
	assert.equal(view.positionFrame, 99, 'the playhead follows the media it can still show');
	assert.equal(view.markIn, null, 'the mark is dropped rather than moved to a frame nobody chose');
});

test('a source can be opened directly and still finds the item that carries it', () => {
	const { service } = harness();
	const view = service.openSource('take-2-video', { positionFrame: 10, markIn: 10, markOut: 40 });
	assert.equal(view.binItemId, 'take-2');
	assert.equal(view.positionFrame, 10);
	assert.deepEqual(marks(view), { markIn: 10, markOut: 40 });
	assert.deepEqual(service.points('take-2', 1), { sourceIn: 10, sourceOut: 40 });
	assert.throws(() => service.openSource('take-1-audio'), ReferenceError);
});

test('closing forgets the position and the marks', () => {
	const { service } = harness();
	service.open('take-1');
	service.seek(40);
	service.markIn();
	assert.equal(service.close().sourceId, null);
	assert.equal(service.open('take-1').positionFrame, 0);
	assert.deepEqual(marks(service.view()), { markIn: null, markOut: null });
});

function marks(view: { markIn: number | null; markOut: number | null }) {
	return { markIn: view.markIn, markOut: view.markOut };
}
