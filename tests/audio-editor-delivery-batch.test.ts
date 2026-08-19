/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeEditorExportSettings } from '../src/common/editor/controller/export-settings.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';
import {
	DeliveryBatchError,
	createDeliveryBatch,
	type DeliveryBatchTarget,
} from '../src/common/editor/delivery-batch.ts';
import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import {
	createDeliveryBatchReport,
	deliveryBatchRetryMemberIds,
	summarizeDeliveryBatchReport,
} from '../src/common/editor/delivery-batch-report.ts';

const NOW = '2026-08-18T00:00:00.000Z';

const preset = (id: string, format: string, settings: Record<string, unknown> = {}) => validateDeliveryPreset({
	schemaVersion: 1, id, label: id.toUpperCase(), kind: 'audio', format, settings,
});

function region(id: string, name: string, startFrame: number, endFrame: number, sequenceId: string) {
	return {
		id, sequenceId, name, kind: 'region', anchor: 'sample',
		startFrame, endFrame, color: 'auto', batchId: null, opaqueExtensions: {},
	};
}

function albumProject() {
	const base = createSoundscaperProjectV23({
		id: 'album', title: 'Album', now: NOW, revision: 0,
		tracks: [{ type: 'audio', id: 'a1', name: 'A1' }],
	} as never);
	const sequenceId = base.primarySequenceId;
	return createSoundscaperProjectV23({
		id: 'album', title: 'Album', now: NOW, revision: 0,
		sources: [{
			id: 'source', name: 'Source', storageKey: 'pcm/source', mimeType: 'audio/wav',
			frameCount: 480_000, channelCount: 2, sampleRate: 48_000, sampleFormat: 'float32',
		}],
		clips: [{
			id: 'clip', kind: 'audio', sourceId: 'source',
			timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 480_000,
		}],
		tracks: [{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['clip'] }],
		primarySequenceId: sequenceId,
		sequences: base.sequences,
		timelineAnnotations: [region('r-one', 'Opening', 0, 96_000, sequenceId)],
		masteringSequences: [{
			id: 'album-order', sequenceId, name: 'Album order',
			entries: [{ id: 'e1', annotationId: 'r-one' }],
		}],
	} as never);
}

const TARGETS: readonly DeliveryBatchTarget[] = [
	{ kind: 'project' },
	{ kind: 'region', id: 'r-one' },
	{ kind: 'mastering-sequence', id: 'album-order' },
];

test('alternates are a cross product: every preset against every target', () => {
	const batch = createDeliveryBatch(albumProject(), {
		batchId: 'batch-1',
		presets: [preset('wav24', 'wav'), preset('mp3', 'mp3', { bitRate: 320 })],
		targets: TARGETS,
	});

	assert.equal(batch.members.length, 6);
	assert.deepEqual(batch.members.map(({ target, presetId }) => `${target.kind}:${presetId}`), [
		'project:wav24', 'project:mp3',
		'region:wav24', 'region:mp3',
		'mastering-sequence:wav24', 'mastering-sequence:mp3',
	]);
	assert.deepEqual(
		batch.members.map(({ label }) => label),
		[
			'project — WAV24', 'project — MP3',
			'Opening — WAV24', 'Opening — MP3',
			'Album order — WAV24', 'Album order — MP3',
		],
		'a member names the material and the format it delivers',
	);
	assert.equal(new Set(batch.members.map(({ memberId }) => memberId)).size, 6);
});

test('every member resolves to the settings a single delivery would have used', () => {
	const project = albumProject();
	const batch = createDeliveryBatch(project, {
		batchId: 'batch-1', presets: [preset('wav24', 'wav')], targets: TARGETS,
	});
	const [wholeProject, regionMember, sequenceMember] = batch.members;

	assert.deepEqual(wholeProject.settings, { format: 'wav', range: 'project', mode: 'mix' });
	assert.deepEqual(regionMember.settings, {
		format: 'wav', range: { startFrame: 0, endFrame: 96_000 }, mode: 'mix',
	});
	assert.deepEqual(sequenceMember.settings, {
		format: 'wav', masteringSequenceId: 'album-order', range: 'project', mode: 'mix',
	});

	// The acceptance that matters: no member gets a second render path, so each
	// one builds an ordinary plan.
	for (const member of batch.members) {
		const plan = createExportPlan(project, member.settings);
		assert.equal(plan.format, 'wav');
		assert.equal(plan.outputs.length, 1);
	}
	assert.equal(
		createExportPlan(project, regionMember.settings).outputFrames, 96_000,
		'the region member delivers exactly its region',
	);
	assert.ok(createExportPlan(project, sequenceMember.settings).masteringSequence);
});

test('a queued member keeps the frames it names when the export normalizes its settings', () => {
	// The queue does not hand a member's settings to the plan directly: it goes
	// through the export action, which normalizes them first. That normalizer used
	// to know only the words 'selection' and 'loop', so every resolved range
	// collapsed to 'project' and the member delivered the whole record while the
	// manifest still labelled it with the region it named.
	const project = albumProject();
	const batch = createDeliveryBatch(project, {
		batchId: 'batch-1', presets: [preset('wav24', 'wav')], targets: TARGETS,
	});
	const [wholeProject, regionMember] = batch.members;

	const regionSettings = normalizeEditorExportSettings(regionMember.settings, project.sampleRate);
	assert.deepEqual(regionSettings.range, { startFrame: 0, endFrame: 96_000 });
	assert.equal(createExportPlan(project, regionSettings).outputFrames, 96_000);

	const projectSettings = normalizeEditorExportSettings(wholeProject.settings, project.sampleRate);
	assert.equal(projectSettings.range, 'project');
});

test('a stems batch delivers stems, and refuses the target that cannot be stems', () => {
	const project = albumProject();
	const batch = createDeliveryBatch(project, {
		batchId: 'batch-1', presets: [preset('wav24', 'wav')],
		targets: [{ kind: 'project' }, { kind: 'region', id: 'r-one' }], mode: 'stems',
	});
	assert.deepEqual(batch.members.map(({ mode }) => mode), ['stems', 'stems']);
	assert.equal(createExportPlan(project, batch.members[0].settings).mode, 'stems');

	assert.throws(() => createDeliveryBatch(project, {
		batchId: 'batch-1', presets: [preset('wav24', 'wav')],
		targets: [{ kind: 'mastering-sequence', id: 'album-order' }], mode: 'stems',
	}), /cannot be delivered as stems/u);
});

test('a batch that names something the project does not have is refused when it is built', () => {
	// Not member by member, halfway through a queue.
	const project = albumProject();
	for (const [targets, pattern] of [
		[[{ kind: 'region', id: 'gone' }], /is not a region in this project/u],
		[[{ kind: 'mastering-sequence', id: 'gone' }], /is not in this project/u],
		[[{ kind: 'region' }], /requires its id/u],
		[[{ kind: 'nonsense' }], /Unsupported delivery batch target/u],
	] as const) {
		assert.throws(() => createDeliveryBatch(project, {
			batchId: 'batch-1', presets: [preset('wav24', 'wav')], targets: targets as never,
		}), pattern);
	}
	assert.throws(() => createDeliveryBatch(project, {
		batchId: 'batch-1', presets: [], targets: TARGETS,
	}), DeliveryBatchError);
	assert.throws(() => createDeliveryBatch(project, {
		batchId: 'batch-1',
		presets: [validateDeliveryPreset({
			schemaVersion: 1, id: 'h264', label: 'H264', kind: 'video', format: 'mp4', settings: {},
		})],
		targets: TARGETS,
	}), /is not an audio preset/u);
});

test('a selection target is frozen to the frames it named when the batch was built', () => {
	// The bare word `selection` used to ride through to each member's plan, which
	// resolved it against the live project when that member reached the front of
	// the queue. Editing while a batch ran therefore delivered a different range
	// to every member under one label, and two alternates of the same material
	// contained different audio.
	const project = { ...albumProject(), selection: { startFrame: 1_000, endFrame: 5_000 } };
	const batch = createDeliveryBatch(project as never, {
		batchId: 'batch-1', presets: [preset('wav', 'wav')], targets: [{ kind: 'selection' }],
	});

	assert.deepEqual(batch.members[0].settings.range, { startFrame: 1_000, endFrame: 5_000 },
		'the batch names frames, not a word resolved later');

	// Moving the selection afterwards cannot reach a batch already built.
	const moved = { ...albumProject(), selection: { startFrame: 90_000, endFrame: 96_000 } };
	assert.deepEqual(batch.members[0].settings.range, { startFrame: 1_000, endFrame: 5_000 });
	assert.deepEqual(
		createDeliveryBatch(moved as never, {
			batchId: 'batch-2', presets: [preset('wav', 'wav')], targets: [{ kind: 'selection' }],
		}).members[0].settings.range,
		{ startFrame: 90_000, endFrame: 96_000 },
		'a batch built later names the frames it was built with',
	);
});

test('a batch naming an empty selection or a disabled loop is refused at the door', () => {
	const presets = [preset('wav', 'wav')];
	assert.throws(
		() => createDeliveryBatch(albumProject() as never, {
			batchId: 'b', presets, targets: [{ kind: 'selection' }],
		}),
		/selection is empty/u,
		'rather than failing member by member halfway through a queue',
	);
	assert.throws(
		() => createDeliveryBatch(albumProject() as never, {
			batchId: 'b', presets, targets: [{ kind: 'loop' }],
		}),
		/loop is not enabled/u,
	);
	const looping = {
		...albumProject(), loop: { enabled: true, startFrame: 100, endFrame: 700 },
	};
	assert.deepEqual(
		createDeliveryBatch(looping as never, {
			batchId: 'b', presets, targets: [{ kind: 'loop' }],
		}).members[0].settings.range,
		{ startFrame: 100, endFrame: 700 },
	);
});

test('the batch report itemizes every member, including the ones that never ran', () => {
	// A batch that published four of six and said nothing about the rest would
	// read as a delivery that succeeded.
	const batch = createDeliveryBatch(albumProject(), {
		batchId: 'batch-1', presets: [preset('wav24', 'wav')], targets: TARGETS,
	});
	const report = createDeliveryBatchReport(batch, [
		{ memberId: batch.members[0].memberId, state: 'delivered', fileName: 'album-mix.wav' },
		{ memberId: batch.members[1].memberId, state: 'failed', failureMessage: 'The encoder ran out of memory.' },
	]);

	const items = report.items.filter(({ code }) => code === 'delivery.batch-member');
	assert.equal(items.length, 3);
	assert.deepEqual(items.map(({ data }) => data.state), ['delivered', 'failed', 'not-started']);
	assert.equal(items[0].disposition, 'preserved');
	assert.equal(items[0].data.fileName, 'album-mix.wav');
	assert.equal(items[1].severity, 'error');
	assert.equal(items[1].data.failureMessage, 'The encoder ran out of memory.');
	assert.equal(items[2].disposition, 'missing', 'a member with no outcome never ran');
	assert.deepEqual(summarizeDeliveryBatchReport(report), {
		delivered: 1, failed: 1, cancelled: 0, notStarted: 1,
	});
});

test('retry-from-failure re-runs the failed and unstarted members, never the delivered ones', () => {
	const batch = createDeliveryBatch(albumProject(), {
		batchId: 'batch-1', presets: [preset('wav24', 'wav')], targets: TARGETS,
	});
	const report = createDeliveryBatchReport(batch, [
		{ memberId: batch.members[0].memberId, state: 'delivered' },
		{ memberId: batch.members[1].memberId, state: 'failed' },
		{ memberId: batch.members[2].memberId, state: 'cancelled' },
	]);
	assert.deepEqual(deliveryBatchRetryMemberIds(report), [batch.members[1].memberId]);
});

test('a member report is carried by reference, not flattened into the batch', () => {
	// The batch says what happened to each member; the member's own report says
	// what its delivery did to the material.
	const batch = createDeliveryBatch(albumProject(), {
		batchId: 'batch-1', presets: [preset('mp3', 'mp3')], targets: [{ kind: 'project' }],
	});
	const memberReport = { schemaVersion: 1, format: 'delivery', items: [{ code: 'delivery.lossy-encode' }] };
	const report = createDeliveryBatchReport(batch, [
		{ memberId: batch.members[0].memberId, state: 'delivered', report: memberReport as never },
	]);
	assert.equal(report.items[0].data.report, memberReport);
	assert.equal(
		report.items.some(({ code }) => code === 'delivery.lossy-encode'),
		false,
		'the member conversions stay attributed to their own artifact',
	);
});
