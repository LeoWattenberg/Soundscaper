/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, monoTone, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';
import {
	addClipGainPoint,
	addTrackRackEffect,
	addTrackAutomation,
	applySelectionEffect,
	deleteClipRange,
	deleteWholeClip,
	installOscillatorMicrophone,
	persistedClipIds,
	persistedClipIdsByName,
	persistedProject,
	recordPass,
	revealTimelineClip,
	selectionEffects,
	writeAutomationGesture,
} from './helpers/complex-editing-workflows.js';

const sessions = [
	{
		name: 'podcast host records an intro, draws clip gain, and monitors a pickup in read mode',
		mode: 'read', nudge: 1, gainPoints: [0.32],
		passes: [{ label: 'pickup', gestures: [] }],
	},
	{
		name: 'voice-over editor records a take, trims its level, then records a paused pickup',
		mode: 'trim', nudge: -1,
		passes: [{ label: 'paused pickup', pause: true, gestures: ['ArrowDown'] }],
	},
	{
		name: 'vocalist records a guide, adds two clip rides, and touches the fader before take two',
		mode: 'touch', nudge: 2, gainPoints: [0.24, 0.7],
		passes: [{ label: 'second take', gestures: ['ArrowUp'] }],
	},
	{
		name: 'narrator latches a chapter correction, then records through pause and resume',
		mode: 'latch', nudge: -2, gainPoints: [0.58],
		passes: [{ label: 'latched correction', pause: true, gestures: ['ArrowDown'] }],
	},
	{
		name: 'guitarist records a guide and writes the current fader before an overdub',
		mode: 'write', nudge: 1,
		passes: [{ label: 'written overdub', gestures: [], ride: true }],
	},
	{
		name: 'producer records scratch audio, latches its level, and overdubs a new track',
		mode: 'latch', nudge: 1,
		passes: [{ label: 'new-track overdub', newTrack: true, gestures: ['ArrowUp'] }],
	},
	{
		name: 'dialogue editor adds clip gain, touches the original, and records a paused ADR track',
		mode: 'touch', nudge: -1, gainPoints: [0.2, 0.82],
		passes: [{
			label: 'paused ADR track', newTrack: true, pause: true, gestures: ['ArrowDown'],
		}],
	},
	{
		name: 'singer records a guide and carries latch automation across two more takes',
		mode: 'latch', nudge: 2, gainPoints: [0.46],
		passes: [
			{ label: 'second take', gestures: ['ArrowDown'] },
			{ label: 'third take on a new track', newTrack: true, gestures: ['ArrowUp'] },
		],
	},
	{
		name: 'engineer writes an overdub ride then returns the third recording to read mode',
		mode: 'write', nudge: -2,
		passes: [
			{ label: 'written new-track overdub', newTrack: true, gestures: [], ride: true },
			{ label: 'read-only third pass', mode: 'read', gestures: [] },
		],
	},
	{
		name: 'mix engineer trims the guide before a new-track take then touches it before take three',
		mode: 'trim', nudge: 1, gainPoints: [0.36, 0.74],
		passes: [
			{ label: 'trimmed new-track take', newTrack: true, gestures: ['ArrowUp'] },
			{ label: 'touch-mode third take', mode: 'touch', gestures: ['ArrowDown'] },
		],
	},
];

// Keep every synthetic-microphone workflow in this file on one worker. Parallel
// AudioWorklets can starve one another on the two-core browser CI runners.
test.describe.configure({ mode: 'serial' });

test.describe('realistic recording and automation sessions', () => {
	// Precise V8 coverage can starve the realtime recorder on a loaded CI host.
	test.use({ browserCoverage: false, viewport: { height: 1_000, width: 1_600 } });
	registerAudioEditorHooks();

	for (const session of sessions) {
		test(session.name, async ({ page }) => {
			test.setTimeout(150_000);
			await installOscillatorMicrophone(page);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/embed/en/');
			const projectId = await editor.getAttribute('data-project-id');
			expect(projectId).toBeTruthy();

			const first = await test.step('record the first take', async () => {
				const recorded = await recordPass(page, editor);
				await expect(editor).toHaveAttribute('data-clip-count', '1');
				return recorded;
			});
			const firstTrackId = await first.row.getAttribute('data-track-id');
			expect(firstTrackId).toBeTruthy();
			const firstRow = editor.locator(`[data-track-row][data-track-id="${firstTrackId}"]`);
			const tracksAfterFirst = Number(await editor.getAttribute('data-track-count'));

			if (session.gainPoints?.length) {
				await test.step('author clip gain on the first take', async () => {
					for (const position of session.gainPoints) {
						await addClipGainPoint(page, editor, first.clip, position);
					}
					await expect(first.clip.locator('.envelope-point'))
						.toHaveCount(session.gainPoints.length);
					await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
				});
			}

			const automation = await test.step('author the first-take automation lane', async () => {
				const authored = await addTrackAutomation(page, editor, firstRow, {
					mode: session.mode,
					nudge: session.nudge,
				});
				await expect(authored.overlay.locator('[data-automation-point-id]')).toHaveCount(2);
				await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
					timeout: 20_000,
				});
				return authored;
			});
			let expectedTracks = tracksAfterFirst;
			let activeMode = session.mode;
			for (const pass of session.passes) {
				await test.step(`record ${pass.label}`, async () => {
					await chooseCommandAction(page, editor, 'Select', 'Select none');
					if (pass.mode && pass.mode !== activeMode) {
						await automation.modeSelect.selectOption(pass.mode);
						activeMode = pass.mode;
					}
					await expect(automation.modeSelect).toHaveValue(activeMode);
					const ridesAutomation = pass.ride || pass.gestures.length > 0;
					const beforeRide = await persistedAutomationState(page, projectId);
					if (ridesAutomation) {
						await playAutomationRide(page, editor, automation, pass);
						await expect.poll(() => persistedAutomationState(page, projectId))
							.not.toEqual(beforeRide);
					}
					const beforeRecording = await persistedAutomationState(page, projectId);
					const clipsBeforeRecording = Number(await editor.getAttribute('data-clip-count'));
					const recorded = await recordPass(page, editor, {
						newTrack: Boolean(pass.newTrack),
						pause: Boolean(pass.pause),
						adjust: async () => {
							await expect(editor).toHaveAttribute('data-edit-block-reason', 'recording');
							await expect(automation.modeSelect).toHaveValue(activeMode);
						},
					});
					if (pass.newTrack) expectedTracks += 1;
					expect(Number(await editor.getAttribute('data-clip-count')))
						.toBeGreaterThanOrEqual(clipsBeforeRecording);
					await expect(editor).toHaveAttribute('data-track-count', String(expectedTracks));
					await expect(recorded.clip).toBeVisible();
					await expect(automation.modeSelect).toHaveValue(activeMode);
					if (activeMode !== 'write') {
						await expect.poll(() => persistedAutomationState(page, projectId))
							.toEqual(beforeRecording);
					} else {
						const afterRecording = await persistedAutomationState(page, projectId);
						expect(afterRecording[0]?.id).toBe(beforeRecording[0]?.id);
						expect(afterRecording[0]?.points).toEqual(expect.arrayContaining(
							beforeRecording[0]?.points ?? [],
						));
					}
				});
			}

			await expect(firstRow).toHaveAttribute('data-track-id', firstTrackId);
			const persistedAutomation = await persistedAutomationState(page, projectId);
			expect(persistedAutomation).not.toHaveLength(0);
			expect(persistedAutomation[0]?.points).not.toHaveLength(0);
			if (session.gainPoints?.length) {
				await expect.poll(() => persistedEnvelopePointCount(page, projectId))
					.toBeGreaterThanOrEqual(session.gainPoints.length);
			}
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
				timeout: 20_000,
			});
			expect(errors).toEqual([]);
		});
	}
});

async function playAutomationRide(page, editor, automation, pass) {
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await playhead.focus();
	await page.keyboard.press('Home');
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
		.toBeGreaterThan(pass.gestures.length ? 4_800 : 24_000);
	if (pass.pause) {
		const frameBeforePause = Number(await playhead.getAttribute('aria-valuenow'));
		await page.keyboard.press('p');
		await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
		await page.keyboard.press('p');
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
			.toBeGreaterThan(frameBeforePause + 4_800);
	}
	for (const direction of pass.gestures) {
		await writeAutomationGesture(page, automation.row, direction);
	}
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 20_000,
	});
	await editor.getByRole('button', { name: 'Jump to project end', exact: true }).click();
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow')))
		.toBeGreaterThan(0);
}

async function persistedAutomationState(page, projectId) {
	return (await persistedProject(page, projectId))?.automationLanes ?? [];
}

async function persistedEnvelopePointCount(page, projectId) {
	const project = await persistedProject(page, projectId);
	return project?.clips?.reduce((total, clip) => total + (clip.envelope?.length ?? 0), 0) ?? 0;
}

const editRecordEffectWorkflows = [
	{
		name: 'podcast pickup repair through two recorded fixes and a fresh outro import',
		initialFiles: [longTone], finalFiles: [toneA], range: [0.12, 0.27],
		deleteMode: 'Delete and leave gap', firstRecord: { newTrack: false },
		firstEffect: { kind: 'selection', effect: selectionEffects.invert },
		secondRecord: { newTrack: false }, secondEffect: { kind: 'rack', name: 'Echo' },
		deleteTarget: 'split-tail',
	},
	{
		name: 'vocal comp cleanup with separate takes, compression, and a harmony import',
		initialFiles: [longTone, monoTone], finalFiles: [toneB], range: [0.18, 0.36],
		deleteMode: 'Delete and close gap per clip', firstRecord: { newTrack: false },
		firstEffect: { kind: 'rack', name: 'Compressor' },
		secondRecord: { newTrack: true }, secondEffect: { kind: 'rack', name: 'Tremolo' },
		deleteTarget: 'first-recording',
	},
	{
		name: 'field report assembly with a ripple edit, two voiceovers, and room tone',
		initialFiles: [longTone, toneA], finalFiles: [monoTone], range: [0.24, 0.43],
		deleteMode: 'Delete and close gap per track', firstRecord: { newTrack: false },
		firstEffect: { kind: 'rack', name: 'Noise gate' },
		secondRecord: { newTrack: true }, secondEffect: { kind: 'rack', name: 'Compressor' },
		deleteTarget: 'second-recording',
	},
	{
		name: 'live set edit with an all-track ripple, two overdubs, and a replacement sting',
		initialFiles: [longTone, toneB], finalFiles: [toneA], range: [0.31, 0.49],
		deleteMode: 'Delete and close gap on all tracks', firstRecord: { newTrack: false },
		firstEffect: { kind: 'rack', name: 'Invert' },
		secondRecord: { newTrack: true }, secondEffect: { kind: 'rack', name: 'Bitcrusher' },
		deleteTarget: 'split-head',
	},
	{
		name: 'audiobook chapter repair with gated narration, a retake, and new ambience',
		initialFiles: [longTone], finalFiles: [monoTone, toneA], range: [0.38, 0.56],
		deleteMode: 'Delete and leave gap', firstRecord: { newTrack: false },
		firstEffect: { kind: 'rack', name: 'Noise gate' },
		secondRecord: { newTrack: true }, secondEffect: { kind: 'rack', name: 'Echo' },
		deleteTarget: 'first-recording',
	},
	{
		name: 'sound-design revision with a new layer, destructive leveling, and a final hit',
		initialFiles: [longTone, toneA], finalFiles: [toneB], range: [0.44, 0.63],
		deleteMode: 'Delete and close gap per clip', firstRecord: { newTrack: false },
		firstEffect: { kind: 'rack', name: 'Tremolo' },
		secondRecord: { newTrack: true }, secondEffect: { kind: 'selection', effect: selectionEffects.normalize },
		deleteTarget: 'split-tail',
	},
	{
		name: 'radio segment rebuild with compressed reads, a filtered pickup, and a bumper',
		initialFiles: [longTone, monoTone], finalFiles: [toneA], range: [0.16, 0.41],
		deleteMode: 'Delete and close gap per track', firstRecord: { newTrack: false },
		firstEffect: { kind: 'rack', name: 'Compressor' },
		secondRecord: { newTrack: true }, secondEffect: { kind: 'rack', name: 'Noise gate' },
		deleteTarget: 'second-recording',
	},
	{
		name: 'drum-loop reconstruction with two captured layers and a replacement accent',
		initialFiles: [longTone, toneB], finalFiles: [monoTone], range: [0.52, 0.71],
		deleteMode: 'Delete and close gap on all tracks', firstRecord: { newTrack: false },
		firstEffect: { kind: 'rack', name: 'Bitcrusher' },
		secondRecord: { newTrack: true }, secondEffect: { kind: 'rack', name: 'Tremolo' },
		deleteTarget: 'split-head',
	},
	{
		name: 'dialogue ADR pass with a cut repair, processed takes, and imported wild sound',
		initialFiles: [longTone], finalFiles: [toneB, monoTone], range: [0.21, 0.47],
		deleteMode: 'Delete and leave gap', firstRecord: { newTrack: false },
		firstEffect: { kind: 'rack', name: 'Echo' },
		secondRecord: { newTrack: true }, secondEffect: { kind: 'rack', name: 'Compressor' },
		deleteTarget: 'first-recording',
	},
	{
		name: 'rehearsal edit with ripple cleanup, layered pickups, and a new reference clip',
		initialFiles: [longTone, toneA], finalFiles: [toneB], range: [0.27, 0.58],
		deleteMode: 'Delete and close gap per clip', firstRecord: { newTrack: false },
		firstEffect: { kind: 'rack', name: 'Invert' },
		secondRecord: { newTrack: true }, secondEffect: { kind: 'rack', name: 'Noise gate' },
		deleteTarget: 'second-recording',
	},
];

test.describe('realistic edit, record, and effect sessions', () => {
	test.use({ browserCoverage: false, viewport: { width: 1_600, height: 1_000 } });
	registerAudioEditorHooks();

	for (const workflow of editRecordEffectWorkflows) {
		test(workflow.name, async ({ page }) => {
			test.setTimeout(150_000);
			await installOscillatorMicrophone(page);
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, '/en/');
			const projectId = await editor.getAttribute('data-project-id');
			expect(projectId).toBeTruthy();

			await importFiles(editor, workflow.initialFiles, { timeout: 45_000 });
			await expectClipCount(editor, workflow.initialFiles.length);
			const initialClip = clipByName(editor, longTone.name);
			const clipsBeforePartialDelete = await clipCount(editor);
			await deleteClipRange(page, editor, initialClip, {
				start: workflow.range[0],
				end: workflow.range[1],
				mode: workflow.deleteMode,
			});
			await expectClipCount(editor, clipsBeforePartialDelete + 1);
			const splitClips = clipByName(editor, longTone.name);
			await expect(splitClips).toHaveCount(2);

			const firstRecording = await runRecordingPhase(page, editor, workflow.firstRecord);
			const firstRecordingId = await firstRecording.clip.getAttribute('data-clip-id');
			await runEffectPhase(page, editor, firstRecording, workflow.firstEffect);
			const secondRecording = await runRecordingPhase(page, editor, workflow.secondRecord);
			const secondRecordingId = await secondRecording.clip.getAttribute('data-clip-id');
			await runEffectPhase(page, editor, secondRecording, workflow.secondEffect);
			const currentSplitIds = await persistedClipIdsByName(page, projectId, longTone.name);
			expect(currentSplitIds).not.toHaveLength(0);

			const deleteTargets = {
				'first-recording': firstRecordingId,
				'second-recording': secondRecordingId,
				'split-head': currentSplitIds[0],
				'split-tail': currentSplitIds.at(-1),
			};
			const clipsBeforeWholeDelete = await clipCount(editor);
			await deleteWholeClip(page, editor, deleteTargets[workflow.deleteTarget]);
			await expectClipCount(editor, clipsBeforeWholeDelete - 1);

			const clipsBeforeFinalImport = await clipCount(editor);
			const clipIdsBeforeFinalImport = new Set(await persistedClipIds(page, projectId));
			await importFiles(editor, workflow.finalFiles, { timeout: 45_000 });
			await expectClipCount(editor, clipsBeforeFinalImport + workflow.finalFiles.length);
			await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
				timeout: 20_000,
			});
			const importedClipIds = (await persistedClipIds(page, projectId))
				.filter((id) => !clipIdsBeforeFinalImport.has(id));
			expect(importedClipIds).toHaveLength(workflow.finalFiles.length);
			for (const [index, id] of importedClipIds.entries()) {
				await revealTimelineClip(page, editor, id);
				await expect(clipByName(editor, workflow.finalFiles[index].name)).toBeVisible();
			}
			expect(errors).toEqual([]);
		});
	}
});

async function runRecordingPhase(page, editor, options) {
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const clipsBefore = await clipCount(editor);
	const tracksBefore = Number(await editor.getAttribute('data-track-count'));
	const recording = await recordPass(page, editor, options);
	// Recording over existing material can either replace it or split it around the take.
	// recordPass already proves that a new persisted clip exists, so only reject net loss here.
	expect(await clipCount(editor)).toBeGreaterThanOrEqual(clipsBefore);
	await expect(editor).toHaveAttribute(
		'data-track-count',
		String(tracksBefore + (options.newTrack ? 1 : 0)),
	);
	return recording;
}

async function runEffectPhase(page, editor, recording, effect) {
	if (effect.kind === 'selection') {
		await applySelectionEffect(page, editor, recording.clip, effect.effect);
	} else {
		const panel = await addTrackRackEffect(page, editor, recording.row, effect.name);
		await expect(panel.locator('[data-effect-rack]').getByRole('group', {
			name: effect.name,
			exact: true,
		})).toBeVisible();
		const effectWindow = page.locator('[data-effects-window-host="true"]');
		if (await effectWindow.count()) {
			const dialog = page.getByRole('dialog', { name: effect.name, exact: true });
			await expect(dialog).toBeVisible();
			await dialog.getByRole('button', { name: 'Close', exact: true }).click();
			await expect(effectWindow).toHaveCount(0);
		}
	}
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 20_000,
	});
}

async function expectClipCount(editor, count) {
	await expect(editor).toHaveAttribute('data-clip-count', String(count), { timeout: 20_000 });
}

async function clipCount(editor) {
	return Number(await editor.getAttribute('data-clip-count'));
}
