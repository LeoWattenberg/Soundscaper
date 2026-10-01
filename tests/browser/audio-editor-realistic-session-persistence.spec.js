/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	closeEffectsPanel,
	collectClientErrors,
	importFiles,
	openClipProperties,
	openEffectsForTrack,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import {
	addClipGainPoint,
	addTrackAutomation,
	addTrackRackEffect,
	clipDurationFrames,
	deleteClipRange,
	deleteWholeClip,
	editClipProperties,
	expectContiguousSourceClips,
	persistedProject,
	revealTimelineClip,
	setProjectTempo,
	splitClip,
} from './helpers/complex-editing-workflows.js';

test.use({ viewport: { width: 1_600, height: 1_000 } });

const sessions = [
	{ name: 'podcast cutdown survives duplicate-clip history and reload', action: 'duplicate-clip', tempo: 96, split: 0.36 },
	{ name: 'music edit survives a per-track ripple deletion and reload', action: 'ripple-delete', tempo: 104, split: 0.43 },
	{ name: 'dialogue assembly survives insert paste and reload', action: 'insert-paste', tempo: 112, split: 0.51 },
	{ name: 'restored edit keeps a deleted clip after undo and reload', action: 'delete-undo', tempo: 88, split: 0.29 },
	{ name: 'trim revision remains at the redone boundary after reload', action: 'trim-redo', tempo: 124, split: 0.62 },
	{ name: 'duplicated processed track retains the original automated source', action: 'duplicate-track', tempo: 90, split: 0.47 },
	{ name: 'muted and soloed edit keeps its clip and processing state', action: 'mute-solo', tempo: 118, split: 0.39 },
	{ name: 'reversed and inverted phrase preserves its mixed automation state', action: 'reverse-invert', tempo: 132, split: 0.56 },
	{ name: 'additional editorial split preserves envelopes and rack processing', action: 'second-split', tempo: 76, split: 0.67 },
	{ name: 'removed accent restored by undo survives as part of the session', action: 'accent-delete-undo', tempo: 108, split: 0.33 },
];

test.describe('realistic mixed-state session persistence', () => {
	registerAudioEditorHooks();

	for (const session of sessions) {
		test(session.name, async ({ page }) => {
			test.setTimeout(150_000);
			const errors = collectClientErrors(page);
			let editor = await bootEditor(page, '/en/');
			const projectId = await editor.getAttribute('data-project-id');
			expect(projectId).toBeTruthy();
			await importFiles(editor, [longTone], { timeout: 45_000 });
			let clip = clipByName(editor, longTone.name);
			await editClipProperties(page, editor, clip, {
				sourceInFrame: 4_800,
				durationFrame: 288_000,
				gain: -2,
				fadeInFrame: 4_800,
				fadeOutFrame: 9_600,
				stretchToTempo: session.tempo % 2 === 0,
			});
			await addClipGainPoint(page, editor, clip, 0.24);
			await addClipGainPoint(page, editor, clip, 0.71);
			let row = clip.locator('xpath=ancestor::*[@data-track-row][1]');
			const sourceTrackId = await row.getAttribute('data-track-id');
			expect(sourceTrackId).toBeTruthy();
			row = editor.locator(`[data-track-row][data-track-id="${sourceTrackId}"]`);
			let clips = await splitClip(page, editor, clip, session.split);
			await addTrackAutomation(page, editor, row, {
				mode: 'read',
				nudge: session.tempo % 3 - 1,
			});
			const panel = await addTrackRackEffect(page, editor, row, 'Invert');
			await closeEffectsPanel(panel);
			await setProjectTempo(page, editor, session.tempo);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
				timeout: 20_000,
			});
			const revisionEvidence = await applyEditorialRevision(
				page, editor, row, clips, session.action, projectId,
			);
			if (!await row.locator('[data-track-automation-controls]').isVisible()) {
				await chooseTrackMenuAction(page, editor, row, 'Add automation');
			}
			const clipCount = await editor.getAttribute('data-clip-count');
			const trackCount = await editor.getAttribute('data-track-count');
			const editedDuration = await clipDurationFrames(
				page,
				editor,
				clipByName(editor, longTone.name).first(),
			);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
				timeout: 20_000,
			});
			const projectBeforeReload = await persistedProject(page, projectId);
			const automationPointIds = projectBeforeReload.automationLanes
				.filter((lane) => lane.address?.strip?.id === sourceTrackId)
				.flatMap((lane) => lane.points.map(({ id }) => id));
			expect(automationPointIds).not.toHaveLength(0);

			await page.reload();
			editor = await waitForEditor(page);
			await expect(editor).toHaveAttribute('data-project-id', projectId);
			await expect(editor).toHaveAttribute('data-clip-count', clipCount);
			await expect(editor).toHaveAttribute('data-track-count', trackCount);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			await expect.poll(() => persistedProject(page, projectId)).toEqual(projectBeforeReload);
			await expect(editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true }))
				.toHaveValue(String(session.tempo));
			clip = clipByName(editor, longTone.name).first();
			expect(await clipDurationFrames(page, editor, clip)).toBe(editedDuration);

			row = editor.locator(`[data-track-row][data-track-id="${sourceTrackId}"]`);
			await expect(row.locator('[data-track-automation-controls]')).toHaveCount(0);
			await chooseTrackMenuAction(page, editor, row, 'Add automation');
			const restoredPoints = row.locator('[data-track-automation-overlay] [data-automation-point-id]');
			await expect(restoredPoints).toHaveCount(automationPointIds.length);
			const restoredPointIds = await restoredPoints.evaluateAll(
				(nodes) => nodes.map((node) => node.dataset.automationPointId),
			);
			expect(restoredPointIds).not.toHaveLength(0);
			expect(restoredPointIds).toEqual(expect.arrayContaining(automationPointIds));
			const rowIndex = await trackRowIndex(editor, row);
			const restoredPanel = await openEffectsForTrack(editor, rowIndex);
			await expect(restoredPanel.locator('[data-effect-rack]').getByRole('group', {
				name: 'Invert',
				exact: true,
			})).toBeVisible();
			await assertRestoredRevision(page, editor, row, session.action, revisionEvidence);
			expect(errors).toEqual([]);
		});
	}
});

async function applyEditorialRevision(page, editor, row, clips, action, projectId) {
	const beforeClips = Number(await editor.getAttribute('data-clip-count'));
	const evidence = {};
	switch (action) {
		case 'duplicate-clip':
			await clips.first().locator('.clip-header').click();
			await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
			await expect(editor).toHaveAttribute('data-clip-count', String(beforeClips + 1));
			break;
		case 'ripple-delete':
			await deleteClipRange(page, editor, clips.first(), {
				start: 0.2,
				end: 0.52,
				mode: 'Delete and close gap per track',
			});
			await expectContiguousSourceClips(page, projectId, longTone.name, 3);
			break;
		case 'insert-paste':
			await clips.first().locator('.clip-header').click();
			await chooseCommandAction(page, editor, 'Edit', 'Copy');
			await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Insert']);
			await expect.poll(async () => Number(await editor.getAttribute('data-clip-count')))
				.toBeGreaterThan(beforeClips);
			break;
		case 'delete-undo':
			await deleteWholeClip(page, editor, clips.last());
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(editor).toHaveAttribute('data-clip-count', String(beforeClips));
			break;
		case 'trim-redo': {
			const duration = await clipDurationFrames(page, editor, clips.first());
			await editClipProperties(page, editor, clips.first(), {
				durationFrame: Math.max(1, duration - 4_800),
			});
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await editor.getByRole('button', { name: 'Redo', exact: true }).click();
			break;
		}
		case 'duplicate-track':
			evidence.sourceTrackId = await row.getAttribute('data-track-id');
			evidence.trackIdsBefore = (await persistedProject(page, projectId)).tracks
				.map(({ id }) => id);
			await clips.first().locator('.clip-header').click();
			await chooseCommandAction(page, editor, 'Tracks', 'Duplicate track');
			await expect(editor).toHaveAttribute('data-clip-count', String(beforeClips * 2));
			await expect.poll(async () => (await persistedProject(page, projectId)).tracks.length)
				.toBe(evidence.trackIdsBefore.length + 1);
			evidence.duplicateTrackId = (await persistedProject(page, projectId)).tracks
				.find(({ id }) => !evidence.trackIdsBefore.includes(id))?.id;
			assertDuplicatedTrackState(await persistedProject(page, projectId), evidence);
			break;
		case 'mute-solo':
			await row.getByRole('button', { name: 'Mute', exact: true }).click();
			await row.getByRole('button', { name: 'Solo', exact: true }).click();
			await expect(row.getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute('aria-pressed', 'true');
			await expect(row.getByRole('button', { name: 'Solo', exact: true })).toHaveAttribute('aria-pressed', 'true');
			break;
		case 'reverse-invert': {
			const clipId = await clips.last().getAttribute('data-clip-id');
			const dialog = await openClipProperties(page, editor, clips.last());
			await dialog.getByRole('checkbox', { name: 'Reverse', exact: true }).click();
			await dialog.getByRole('checkbox', { name: 'Invert', exact: true }).click();
			await dialog.getByRole('button', { name: 'Done', exact: true }).click();
			evidence.clipId = clipId;
			break;
		}
		case 'second-split':
			evidence.envelopePoints = envelopePointCount(await persistedProject(page, projectId));
			await splitClip(page, editor, clips.first(), 0.52);
			await expect(editor).toHaveAttribute('data-clip-count', String(beforeClips + 1));
			await expect.poll(async () => envelopePointCount(await persistedProject(page, projectId)))
				.toBeGreaterThanOrEqual(evidence.envelopePoints);
			break;
		case 'accent-delete-undo': {
			await importFiles(editor, [toneA]);
			const accent = clipByName(editor, toneA.name);
			await deleteWholeClip(page, editor, accent);
			await editor.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(clipByName(editor, toneA.name)).toBeVisible();
			break;
		}
		default:
			throw new RangeError(`Unknown editorial revision: ${action}`);
	}
	return evidence;
}

async function assertRestoredRevision(page, editor, row, action, evidence) {
	if (action === 'mute-solo') {
		await expect(row.getByRole('button', { name: 'Mute', exact: true }))
			.toHaveAttribute('aria-pressed', 'true');
		await expect(row.getByRole('button', { name: 'Solo', exact: true }))
			.toHaveAttribute('aria-pressed', 'true');
	}
	if (action === 'reverse-invert') {
		expect(evidence.clipId).toBeTruthy();
		await revealTimelineClip(page, editor, evidence.clipId);
		const dialog = await openClipProperties(
			page, editor, editor.locator(`[data-clip-id="${evidence.clipId}"]`),
		);
		await expect(dialog.getByRole('checkbox', { name: 'Reverse', exact: true })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: 'Invert', exact: true })).toBeChecked();
		await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	}
	if (action === 'accent-delete-undo') {
		await expect(clipByName(editor, toneA.name)).toBeVisible();
	}
	if (action === 'duplicate-track') {
		assertDuplicatedTrackState(await persistedProject(
			page, await editor.getAttribute('data-project-id'),
		), evidence);
	}
	if (action === 'second-split') {
		expect(envelopePointCount(await persistedProject(
			page, await editor.getAttribute('data-project-id'),
		))).toBeGreaterThanOrEqual(evidence.envelopePoints);
	}
}

function assertDuplicatedTrackState(project, evidence) {
	const sourceTrack = project.tracks.find(({ id }) => id === evidence.sourceTrackId);
	const duplicateTrack = project.tracks.find(({ id }) => id === evidence.duplicateTrackId);
	expect(sourceTrack).toBeTruthy();
	expect(duplicateTrack).toBeTruthy();
	expect(duplicateTrack.effects.map(({ id, ...effect }) => effect))
		.toEqual(sourceTrack.effects.map(({ id, ...effect }) => effect));
	const laneState = (trackId) => project.automationLanes
		.filter((lane) => lane.address?.strip?.id === trackId)
		.map(({ id, address, points, ...lane }) => ({
			...lane,
			address: { ...address, strip: { ...address.strip, id: '<track>' } },
			points: points.map(({ id: pointId, ...point }) => point),
		}));
	expect(laneState(duplicateTrack.id)).toEqual(laneState(sourceTrack.id));
}

function envelopePointCount(project) {
	return project.clips.reduce((total, clip) => total + (clip.envelope?.length ?? 0), 0);
}

async function trackRowIndex(editor, row) {
	const trackId = await row.getAttribute('data-track-id');
	const index = await editor.locator('[data-track-row]').evaluateAll(
		(nodes, id) => nodes.findIndex((node) => node.dataset.trackId === id),
		trackId,
	);
	expect(index).toBeGreaterThanOrEqual(0);
	return index;
}
