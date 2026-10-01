/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import {
	addTrackAutomation,
	addTrackRackEffect,
	authorClipGainPoint,
	clipContentState,
	clipCount,
	clipEditingState,
	clipProcessingState,
	copyClipAndPaste,
	deleteClipRange,
	duplicateClip,
	editClipProperties,
	expectContiguousSourceClips,
	persistedClipsByName,
	persistedProject,
	selectClipRange,
	selectClipHeader,
	setTrackMuteSolo,
	splitClip,
	trackCount,
	trackRow,
	waitForSaved,
} from './helpers/complex-editing-workflows.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

const sessions = [
	{
		name: 'builds a podcast pickup from trimmed dialogue, an inserted sting, clip gain, and a volume ride',
		run: podcastPickupSession,
	},
	{
		name: 'tightens two-track dialogue with a ripple delete before inserting copied room tone',
		run: dialogueRippleSession,
	},
	{
		name: 'duplicates a faded chorus safety track and auditions it beside a processed split verse',
		run: chorusSafetySession,
	},
	{
		name: 'reassembles a radio montage beside a gained ident and processed split bed',
		run: radioMontageSession,
	},
	{
		name: 'inserts a copied beat while preserving synchronisation across three edited tracks',
		run: synchronizedBeatInsertSession,
	},
	{
		name: 'edits an audiobook chapter into clips, removes a breath, and duplicates a pickup',
		run: audiobookPickupSession,
	},
	{
		name: 'layers copied ambience under a split cue with fades, gain points, mute, and reverb',
		run: ambienceLayerSession,
	},
	{
		name: 'keeps a cut sound-design layer pasteable through undo and redo after both sources are split',
		run: soundDesignClipboardSession,
	},
	{
		name: 'performs an all-track ripple cleanup before auditioning and processing a live multitrack take',
		run: liveMultitrackCleanupSession,
	},
	{
		name: 'keeps a muted safety duplicate while replacing part of a three-track edit and automating the bed',
		run: safetyDuplicateReplacementSession,
	},
];

test.describe('realistic multitrack arrangement sessions', () => {
	registerAudioEditorHooks();

	for (const session of sessions) {
		test(session.name, async ({ page }) => {
			test.setTimeout(120_000);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			await session.run(page, editor);
			await waitForSaved(editor);
			expect(errors).toEqual([]);
		});
	}
});

async function podcastPickupSession(page, editor) {
	await importFiles(editor, [longTone, toneA]);
	const dialogue = clipByName(editor, longTone.name);
	const sting = clipByName(editor, toneA.name);
	await editClipProperties(page, editor, dialogue, {
		sourceInFrame: 4_800,
		durationFrame: 326_400,
		fadeInFrame: 2_400,
		fadeOutFrame: 4_800,
		gain: -2,
	});
	await authorClipGainPoint(page, editor, dialogue, 0.26);
	const dialogueTrackId = await trackRow(dialogue).getAttribute('data-track-id');
	expect(dialogueTrackId).toBeTruthy();
	const dialogueRow = editor.locator(`[data-track-row][data-track-id="${dialogueTrackId}"]`);
	await splitClip(page, editor, dialogue, 0.58);
	await expect(dialogueRow.locator('[data-clip-id]')).toHaveCount(2);
	const clipCountBeforeInsert = await clipCount(editor);
	await copyClipAndPaste(page, editor, sting, 'Insert');
	await expect.poll(() => clipCount(editor)).toBeGreaterThan(clipCountBeforeInsert);
	const automation = await addTrackAutomation(page, editor, dialogueRow, { nudge: 2 });
	await expect(automation.overlay.locator('[data-automation-point-id]')).toHaveCount(2);
}

async function dialogueRippleSession(page, editor) {
	await importFiles(editor, [longTone, toneA]);
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();
	const dialogue = clipByName(editor, longTone.name);
	const roomTone = clipByName(editor, toneA.name);
	await editClipProperties(page, editor, dialogue, {
		sourceInFrame: 9_600,
		durationFrame: 307_200,
		fadeInFrame: 1_200,
		fadeOutFrame: 2_400,
	});
	const dialogueTrackId = await trackRow(dialogue).getAttribute('data-track-id');
	expect(dialogueTrackId).toBeTruthy();
	const dialogueRow = editor.locator(`[data-track-row][data-track-id="${dialogueTrackId}"]`);
	const automation = await addTrackAutomation(page, editor, dialogueRow, { parameter: 'Pan', nudge: -1 });
	const pointIds = await automation.overlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	await deleteClipRange(page, editor, dialogue, {
		start: 0.3,
		end: 0.45,
		mode: 'Delete and close gap per track',
	});
	await expect(dialogueRow.locator('[data-clip-id]')).toHaveCount(2);
	await expectContiguousSourceClips(page, projectId, longTone.name, 2);
	const [persistedRoomTone] = await persistedClipsByName(page, projectId, toneA.name);
	expect(persistedRoomTone.timelineStartFrame).toBe(0);
	const firstSurvivor = dialogueRow.locator('[data-clip-id]').first();
	await authorClipGainPoint(page, editor, firstSurvivor, 0.4);
	const beforeInsert = await clipCount(editor);
	await copyClipAndPaste(page, editor, roomTone, 'Insert');
	await expect.poll(() => clipCount(editor)).toBeGreaterThan(beforeInsert);
	await chooseTrackMenuAction(page, editor, dialogueRow, 'Add automation');
	const reopenedControls = dialogueRow.locator('[data-track-automation-controls]');
	await expect(reopenedControls).toBeVisible();
	const parameter = reopenedControls.getByRole('combobox', {
		name: 'Automation parameter', exact: true,
	});
	await parameter.selectOption({ label: 'Pan' });
	await expect(parameter.locator('option:checked')).toHaveText('Pan');
	const reopenedOverlay = dialogueRow.locator('[data-track-automation-overlay]');
	await expect(reopenedOverlay.locator('[data-automation-point-id]')).not.toHaveCount(0);
	const remainingPointIds = await reopenedOverlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	expect(remainingPointIds).toEqual(expect.arrayContaining(pointIds));
}

async function chorusSafetySession(page, editor) {
	await importFiles(editor, [toneA, toneB]);
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();
	const verse = clipByName(editor, toneA.name);
	const chorus = clipByName(editor, toneB.name);
	await editClipProperties(page, editor, verse, {
		sourceInFrame: 1_200,
		durationFrame: 34_800,
		fadeInFrame: 1_200,
		fadeOutFrame: 2_400,
	});
	await editClipProperties(page, editor, chorus, {
		sourceInFrame: 2_400,
		durationFrame: 33_600,
		fadeInFrame: 2_400,
		fadeOutFrame: 1_200,
		gain: -3,
	});
	const verseRow = trackRow(verse);
	await splitClip(page, editor, verse, 0.46);
	await expect(verseRow.locator('[data-clip-id]')).toHaveCount(2);
	const chorusTrackId = await trackRow(chorus).getAttribute('data-track-id');
	expect(chorusTrackId).toBeTruthy();
	const chorusRow = editor.locator(`[data-track-row][data-track-id="${chorusTrackId}"]`);
	await waitForSaved(editor);
	const [chorusBeforeDuplicate] = await persistedClipsByName(page, projectId, toneB.name);
	const beforeTracks = await trackCount(editor);
	const duplicate = await duplicateClip(page, editor, chorus);
	await expect.poll(() => trackCount(editor)).toBe(beforeTracks + 1);
	let chorusCopies = [];
	await expect.poll(async () => {
		chorusCopies = await persistedClipsByName(page, projectId, toneB.name);
		return chorusCopies.length;
	}).toBe(2);
	const chorusDuplicate = chorusCopies.find(({ id }) => id !== chorusBeforeDuplicate.id);
	expect(clipEditingState(chorusDuplicate)).toEqual(clipEditingState(chorusBeforeDuplicate));
	const duplicateRow = trackRow(duplicate);
	await setTrackMuteSolo(chorusRow, { mute: true });
	await setTrackMuteSolo(duplicateRow, { solo: true });
	const panel = await addTrackRackEffect(page, editor, verseRow, 'Invert');
	await expect(panel.locator('[data-effect-rack]').getByRole('group', {
		name: 'Invert', exact: true,
	})).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '4');
}

async function radioMontageSession(page, editor) {
	await importFiles(editor, [longTone, toneA, toneB]);
	const bed = clipByName(editor, longTone.name);
	const ident = clipByName(editor, toneA.name);
	const cue = clipByName(editor, toneB.name);
	await editClipProperties(page, editor, ident, {
		sourceInFrame: 1_800,
		durationFrame: 32_400,
		fadeInFrame: 2_400,
		fadeOutFrame: 4_800,
		gain: -1.5,
	});
	await authorClipGainPoint(page, editor, ident, 0.62);
	const bedRow = trackRow(bed);
	await splitClip(page, editor, bed, 0.32);
	await expect(bedRow.locator('[data-clip-id]')).toHaveCount(2);
	const beforeCut = await clipCount(editor);
	await selectClipHeader(cue);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Cut', 'Cut and leave gap']);
	await expect(editor).toHaveAttribute('data-clip-count', String(beforeCut - 1));
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', String(beforeCut));
	const panel = await addTrackRackEffect(page, editor, bedRow, 'Reverb');
	await expect(panel.locator('[data-effect-rack]').getByRole('group', {
		name: 'Reverb', exact: true,
	})).toBeVisible();
}

async function synchronizedBeatInsertSession(page, editor) {
	await importFiles(editor, [longTone, toneA, toneB]);
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();
	const beat = clipByName(editor, longTone.name);
	const bass = clipByName(editor, toneA.name);
	const accent = clipByName(editor, toneB.name);
	await editClipProperties(page, editor, bass, {
		sourceInFrame: 2_400,
		durationFrame: 31_200,
		fadeInFrame: 1_200,
		fadeOutFrame: 2_400,
	});
	await authorClipGainPoint(page, editor, bass, 0.35);
	const beatRow = trackRow(beat);
	const beatTrackId = await beatRow.getAttribute('data-track-id');
	expect(beatTrackId).toBeTruthy();
	const automation = await addTrackAutomation(page, editor, beatRow, { nudge: -2 });
	const pointIds = await automation.overlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	await waitForSaved(editor);
	const [beatBeforeInsert] = await persistedClipsByName(page, projectId, longTone.name);
	const [bassBeforeInsert] = await persistedClipsByName(page, projectId, toneA.name);
	const [accentBeforeInsert] = await persistedClipsByName(page, projectId, toneB.name);
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await playhead.focus();
	await page.keyboard.press('Home');
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
	await selectClipHeader(beat);
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	const pasteFrame = Number(await playhead.getAttribute('aria-valuenow'));
	const beforeInsert = await clipCount(editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Insert and preserve synchronisation']);
	await expect.poll(() => clipCount(editor)).toBeGreaterThan(beforeInsert);
	await expect.poll(async () => (
		(await persistedClipsByName(page, projectId, toneA.name))[0].timelineStartFrame
	)).toBeGreaterThan(bassBeforeInsert.timelineStartFrame);
	const [bassAfterInsert] = await persistedClipsByName(page, projectId, toneA.name);
	const [accentAfterInsert] = await persistedClipsByName(page, projectId, toneB.name);
	const synchronizedShift = bassAfterInsert.timelineStartFrame - bassBeforeInsert.timelineStartFrame;
	expect(bassAfterInsert.id).toBe(bassBeforeInsert.id);
	expect(accentAfterInsert.id).toBe(accentBeforeInsert.id);
	expect(synchronizedShift).toBe(beatBeforeInsert.durationFrames);
	expect(accentAfterInsert.timelineStartFrame - accentBeforeInsert.timelineStartFrame)
		.toBe(synchronizedShift);
	const insertedBeats = await persistedClipsByName(page, projectId, longTone.name);
	const pastedBeat = insertedBeats.find(({ id, timelineStartFrame }) => (
		id !== beatBeforeInsert.id && timelineStartFrame === pasteFrame
	));
	expect(pastedBeat).toBeTruthy();
	expect(pastedBeat.timelineStartFrame).toBe(pasteFrame);
	expect(clipContentState(pastedBeat)).toEqual(clipContentState(beatBeforeInsert));
	const pastedBeatOwner = (await persistedProject(page, projectId)).tracks
		.find((track) => track.clipIds?.includes(pastedBeat.id));
	expect(pastedBeatOwner?.id).toBe(beatTrackId);
	const accentRow = trackRow(accent);
	await splitClip(page, editor, accent, 0.5);
	await expect(accentRow.locator('[data-clip-id]')).toHaveCount(2);
	const insertedPointIds = await automation.overlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	expect(insertedPointIds).toEqual(expect.arrayContaining(pointIds));
	expect(insertedPointIds.length).toBeGreaterThan(pointIds.length);
}

async function audiobookPickupSession(page, editor) {
	await importFiles(editor, [longTone]);
	const chapter = clipByName(editor, longTone.name);
	await editClipProperties(page, editor, chapter, {
		sourceInFrame: 12_000,
		durationFrame: 300_000,
		fadeInFrame: 2_400,
		fadeOutFrame: 7_200,
		gain: 1,
	});
	const chapterRow = trackRow(chapter);
	await splitClip(page, editor, chapter, 0.47);
	let clips = chapterRow.locator('[data-clip-id]');
	await expect(clips).toHaveCount(2);
	await authorClipGainPoint(page, editor, clips.first(), 0.72);
	await deleteClipRange(page, editor, clips.last(), {
		start: 0.24,
		end: 0.42,
		mode: 'Delete and leave gap',
	});
	clips = chapterRow.locator('[data-clip-id]');
	await expect(clips).toHaveCount(3);
	const beforeTracks = await trackCount(editor);
	const pickup = await duplicateClip(page, editor, clips.last());
	await expect(pickup).toBeVisible();
	await expect.poll(() => trackCount(editor)).toBe(beforeTracks + 1);
	const automation = await addTrackAutomation(page, editor, chapterRow, { nudge: 1 });
	await expect(automation.overlay.locator('[data-automation-point-id]')).toHaveCount(2);
}

async function ambienceLayerSession(page, editor) {
	await importFiles(editor, [longTone, toneA]);
	const ambience = clipByName(editor, longTone.name);
	const cue = clipByName(editor, toneA.name);
	await editClipProperties(page, editor, ambience, {
		sourceInFrame: 7_200,
		durationFrame: 312_000,
		fadeInFrame: 9_600,
		fadeOutFrame: 12_000,
		gain: -5,
	});
	await authorClipGainPoint(page, editor, ambience, 0.22);
	await authorClipGainPoint(page, editor, ambience, 0.73);
	const beforeInsert = await clipCount(editor);
	await selectClipRange(page, editor, ambience, 0.18, 0.34);
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Insert']);
	await expect.poll(() => clipCount(editor)).toBeGreaterThan(beforeInsert);
	const cueRow = trackRow(cue);
	await splitClip(page, editor, cue, 0.55);
	await expect(cueRow.locator('[data-clip-id]')).toHaveCount(2);
	await setTrackMuteSolo(cueRow, { mute: true });
	const ambienceRow = trackRow(ambience);
	const panel = await addTrackRackEffect(page, editor, ambienceRow, 'Reverb');
	await expect(panel.locator('[data-effect-rack]').getByRole('group', {
		name: 'Reverb', exact: true,
	})).toBeVisible();
}

async function soundDesignClipboardSession(page, editor) {
	await importFiles(editor, [toneA, toneB]);
	const impact = clipByName(editor, toneA.name);
	const tail = clipByName(editor, toneB.name);
	await editClipProperties(page, editor, impact, {
		sourceInFrame: 1_200,
		durationFrame: 34_800,
		fadeInFrame: 600,
		fadeOutFrame: 3_600,
		gain: 2,
	});
	const impactRow = trackRow(impact);
	const tailRow = trackRow(tail);
	await splitClip(page, editor, impact, 0.36);
	await splitClip(page, editor, tail, 0.64);
	await expect(impactRow.locator('[data-clip-id]')).toHaveCount(2);
	await expect(tailRow.locator('[data-clip-id]')).toHaveCount(2);
	const target = impactRow.locator('[data-clip-id]').last();
	const targetId = await target.getAttribute('data-clip-id');
	await selectClipHeader(target);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Cut', 'Cut and leave gap']);
	await expect(editor.locator(`[data-clip-id="${targetId}"]`)).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator(`[data-clip-id="${targetId}"]`)).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator(`[data-clip-id="${targetId}"]`)).toHaveCount(0);
	const beforePaste = await clipCount(editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', String(beforePaste + 1));
	const panel = await addTrackRackEffect(page, editor, tailRow, 'Invert');
	await expect(panel.locator('[data-effect-rack]').getByRole('group', {
		name: 'Invert', exact: true,
	})).toBeVisible();
}

async function liveMultitrackCleanupSession(page, editor) {
	await importFiles(editor, [longTone, toneA, toneB]);
	const guide = clipByName(editor, longTone.name);
	const left = clipByName(editor, toneA.name);
	const right = clipByName(editor, toneB.name);
	await editClipProperties(page, editor, guide, {
		sourceInFrame: 4_800,
		durationFrame: 336_000,
		fadeInFrame: 2_400,
		fadeOutFrame: 4_800,
	});
	const guideRow = trackRow(guide);
	const leftRow = trackRow(left);
	const rightRow = trackRow(right);
	const automation = await addTrackAutomation(page, editor, guideRow, { nudge: 2 });
	const pointIds = await automation.overlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	await authorClipGainPoint(page, editor, guide, 0.16);
	await deleteClipRange(page, editor, guide, {
		start: 0.04,
		end: 0.075,
		mode: 'Delete and close gap on all tracks',
	});
	await expect(guideRow.locator('[data-clip-id]')).toHaveCount(2);
	await expect(leftRow.locator('[data-clip-id]')).toHaveCount(2);
	await expect(rightRow.locator('[data-clip-id]')).toHaveCount(2);
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();
	const [guideClips, leftClips, rightClips] = await Promise.all([
		expectContiguousSourceClips(page, projectId, longTone.name, 2),
		expectContiguousSourceClips(page, projectId, toneA.name, 2),
		expectContiguousSourceClips(page, projectId, toneB.name, 2),
	]);
	expect([guideClips[1], leftClips[1], rightClips[1]].map(({ timelineStartFrame }) => (
		timelineStartFrame
	))).toEqual(Array(3).fill(guideClips[1].timelineStartFrame));
	await setTrackMuteSolo(leftRow, { mute: true });
	await setTrackMuteSolo(rightRow, { solo: true });
	await chooseTrackMenuAction(page, editor, guideRow, 'Add automation');
	const reopenedOverlay = guideRow.locator('[data-track-automation-overlay]');
	await expect(reopenedOverlay.locator('[data-automation-point-id]')).not.toHaveCount(0);
	const ripplePointIds = await reopenedOverlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	expect(ripplePointIds).toEqual(expect.arrayContaining(pointIds));
	expect(ripplePointIds.length).toBeGreaterThan(pointIds.length);
	const panel = await addTrackRackEffect(page, editor, guideRow, 'Invert');
	await expect(panel.locator('[data-effect-rack]').getByRole('group', {
		name: 'Invert', exact: true,
	})).toBeVisible();
}

async function safetyDuplicateReplacementSession(page, editor) {
	await importFiles(editor, [longTone, toneA, toneB]);
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();
	const bed = clipByName(editor, longTone.name);
	const lead = clipByName(editor, toneA.name);
	const replacement = clipByName(editor, toneB.name);
	await editClipProperties(page, editor, lead, {
		sourceInFrame: 2_400,
		durationFrame: 32_400,
		fadeInFrame: 2_400,
		fadeOutFrame: 2_400,
		gain: -1,
	});
	const safety = await duplicateClip(page, editor, lead);
	const safetyRow = trackRow(safety);
	await setTrackMuteSolo(safetyRow, { mute: true });
	const bedRow = trackRow(bed);
	const bedTrackId = await bedRow.getAttribute('data-track-id');
	expect(bedTrackId).toBeTruthy();
	const automation = await addTrackAutomation(page, editor, bedRow, { nudge: -1 });
	const pointIds = await automation.overlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	);
	await authorClipGainPoint(page, editor, replacement, 0.48);
	await selectClipHeader(replacement);
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await waitForSaved(editor);
	const [replacementBeforePaste] = await persistedClipsByName(page, projectId, toneB.name);
	const tracksBeforeSourceRemoval = await trackCount(editor);
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await expect(editor).toHaveAttribute('data-track-count', String(tracksBeforeSourceRemoval - 1));
	await expect.poll(async () => (
		await persistedClipsByName(page, projectId, toneB.name)
	).length).toBe(0);
	await splitClip(page, editor, bed, 0.4);
	await expect(bedRow.locator('[data-clip-id]')).toHaveCount(2);
	let bedParts = [];
	await expect.poll(async () => {
		bedParts = await persistedClipsByName(page, projectId, longTone.name);
		return bedParts.length;
	}).toBe(2);
	const tailBeforeDelete = bedParts.at(-1);
	expect(tailBeforeDelete).toBeTruthy();
	const tail = editor.locator(`[data-clip-id="${tailBeforeDelete.id}"]`);
	await expect(tail).toBeVisible();
	await deleteClipRange(page, editor, tail, {
		start: 0.18,
		end: 0.36,
		mode: 'Delete and close gap per clip',
	});
	await expectContiguousSourceClips(page, projectId, longTone.name, 3);
	await chooseTrackMenuAction(page, editor, bedRow, 'Add automation');
	const reopenedOverlay = bedRow.locator('[data-track-automation-overlay]');
	await expect(reopenedOverlay.locator('[data-automation-point-id]'))
		.toHaveCount(pointIds.length);
	expect(await reopenedOverlay.locator('[data-automation-point-id]').evaluateAll(
		(points) => points.map((point) => point.getAttribute('data-automation-point-id')),
	)).toEqual(pointIds);
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	const pasteFrame = Number(await playhead.getAttribute('aria-valuenow'));
	expect(pasteFrame).toBeGreaterThan(tailBeforeDelete.timelineStartFrame);
	expect(pasteFrame).toBeLessThan(tailBeforeDelete.timelineStartFrame + tailBeforeDelete.durationFrames);
	const beforeInsert = await clipCount(editor);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Insert']);
	const mixDown = page.getByRole('dialog', { name: 'Mix down to mono', exact: true });
	await expect(mixDown).toBeVisible();
	await mixDown.getByRole('button', { name: 'Yes', exact: true }).click();
	await expect(mixDown).toBeHidden();
	await expect.poll(() => clipCount(editor)).toBeGreaterThan(beforeInsert);
	let pastedReplacement = null;
	await expect.poll(async () => {
		pastedReplacement = (await persistedClipsByName(page, projectId, toneB.name))
			.find(({ id }) => id !== replacementBeforePaste.id) ?? null;
		return pastedReplacement?.timelineStartFrame ?? null;
	}).not.toBeNull();
	expect(pastedReplacement.timelineStartFrame).toBe(pasteFrame);
	expect(clipProcessingState(pastedReplacement)).toEqual(clipProcessingState(replacementBeforePaste));
	expect(pastedReplacement.sourceId).not.toBe(replacementBeforePaste.sourceId);
	const replacementOwner = (await persistedProject(page, projectId)).tracks
		.find((track) => track.clipIds?.includes(pastedReplacement.id));
	expect(replacementOwner?.id).toBe(bedTrackId);
	const panel = await addTrackRackEffect(page, editor, bedRow, 'Reverb');
	await expect(panel.locator('[data-effect-rack]').getByRole('group', {
		name: 'Reverb', exact: true,
	})).toBeVisible();
	await expect(safetyRow.getByRole('button', { name: 'Mute', exact: true }))
		.toHaveAttribute('aria-pressed', 'true');
}
