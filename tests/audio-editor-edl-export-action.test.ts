/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { exportProjectEdl } from '../src/common/editor/controller/edl-export-action.ts';

const SAMPLE_RATE = 48_000;

function project() {
	return {
		id: 'p', title: 'Reel one', sampleRate: SAMPLE_RATE, primarySequenceId: 'seq',
		sequences: [{
			id: 'seq', name: 'Sequence', rate: { num: 25, den: 1 }, dropFrame: false,
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
		}],
		sources: [{ kind: 'video', id: 'src', name: 'CAM A' }],
		clips: [{
			kind: 'video', id: 'c1', sourceId: 'src', title: 'Wide',
			timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
		}],
		tracks: [
			{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c1'], hidden: false },
			{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['c1'], hidden: false },
		],
	};
}

function harness(overrides: Record<string, unknown> = {}) {
	const saved: Record<string, unknown>[] = [];
	const state: Record<string, unknown> = {};
	let published = 0;
	return {
		saved, state, published: () => published,
		runtime: {
			getProject: () => project(),
			state,
			fileService: { saveFile: (request: Record<string, unknown>) => { saved.push(request); } },
			publishDocumentSnapshot: () => { published += 1; },
			...overrides,
		},
	};
}

test('the action saves an EDL through the interchange purpose', async () => {
	const { saved, runtime } = harness();
	const result = await exportProjectEdl(runtime);
	assert.ok(result);
	assert.equal(saved.length, 1);
	assert.equal(saved[0].purpose, 'interchange', 'the 6C-1 profiles share one save purpose');
	assert.equal(saved[0].suggestedName, 'Reel-one.edl');
	assert.equal(saved[0].mimeType, 'text/plain');
	assert.match(result.text, /^TITLE: Reel one\nFCM: NON-DROP FRAME\n/u);
});

test('the report reaches session state so the File menu entry can show it', async () => {
	const { state, runtime } = harness();
	await exportProjectEdl(runtime);
	const report = state.deliveryReport as { format?: string; subject?: { format?: string } };
	assert.equal(report?.format, 'delivery');
	assert.equal(report?.subject?.format, 'edl', 'the report names the interchange format, not an encode format');
});

test('a cancelled save still leaves the omissions readable', async () => {
	// The report is what tells the user their audio track is not in the list.
	// Publishing it only on a successful save would hide exactly that.
	const { state, runtime } = harness({
		fileService: { saveFile: () => { throw new Error('user cancelled'); } },
	});
	await assert.rejects(() => exportProjectEdl(runtime), /cancelled/u);
	const report = state.deliveryReport as { items?: { code: string }[] };
	assert.ok(
		report?.items?.some((item) => item.code === 'edl.audio-track-omitted'),
		'the omissions survive a cancelled save',
	);
});

test('the snapshot is republished so the disabled menu entry becomes enabled', async () => {
	const state = harness();
	await exportProjectEdl(state.runtime);
	assert.equal(state.published(), 1, 'a report nothing repaints is a report nobody can open');
});

test('no project means no file and no invented report', async () => {
	const { saved, state, runtime } = harness({ getProject: () => null });
	assert.equal(await exportProjectEdl(runtime), null);
	assert.equal(saved.length, 0);
	assert.equal(state.deliveryReport, undefined);
});

test('a host with no file service still returns the document rather than silently doing nothing', async () => {
	const { runtime } = harness({ fileService: null });
	const result = await exportProjectEdl(runtime);
	assert.ok(result?.text.includes('CAM_A'), 'the caller can still write the bytes itself');
});
