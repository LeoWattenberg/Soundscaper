/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	collectClientErrors,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';

// Keep this desktop-assistance workflow focused on consent and publication.
// This repository-owned VP8 fixture carries the exact container timing
// authority the shot reviewer must validate.
const VIDEO = videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1');
const CUT_FIXTURE = Object.freeze({
	timescale: 1_000,
	sourceFrameCount: 8,
	sourceFrame: 4,
	presentationTick: '542',
});
const ADVANCED_OPERATIONS = Object.freeze([
	'voice-activity-detection',
	'speech-recognition',
	'word-alignment',
	'speaker-diarization',
	'speech-enhancement',
	'source-separation',
	'audio-tagging',
	'beat-tracking',
	'text-embedding',
	'image-text-embedding',
	'optical-character-recognition',
	'shot-detection',
	'subject-detection',
	'saliency-detection',
	'editorial-generation',
]);

test.describe('menu-only Local Assistance workflows', () => {
	registerAudioEditorHooks();

	test('installs separately, accepts and undoes one workflow, then cancels preparation', async ({ page }) => {
		test.setTimeout(120_000);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await installLocalAssistanceFixture(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		await editor.locator('[data-import-input]').setInputFiles([VIDEO.file]);
		const sourceName = VIDEO.file.name.replace(/\.[^.]+$/u, '');
		const addToTimeline = editor.getByRole('button', {
			name: `Add to timeline: ${sourceName}`, exact: true,
		});
		await expect(addToTimeline).toBeVisible({ timeout: 60_000 });
		await addToTimeline.click();
		const selectedClip = editor.getByRole('group', { name: /^Video clip:/u }).first();
		await expect(selectedClip).toBeVisible({ timeout: 30_000 });
		await selectedClip.focus();
		await page.keyboard.press('Enter');
		await expect(selectedClip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();

		await expect(page.locator('[data-local-assistance="true"]')).toHaveCount(0);
		await expect(page.locator('[data-local-model-manager="true"]')).toHaveCount(0);
		await expect(editor.getByRole('button', { name: /Local Assistance|Local Models/u }))
			.toHaveCount(0);

		await chooseCommandAction(page, editor, 'Analyze', 'Local Assistance…');
		let assistance = page.getByRole('dialog', { name: 'Local Assistance', exact: true });
		await expect(assistance).toBeVisible();
		await expect(assistance.getByRole('tab', { name: 'Guided', exact: true }))
			.toHaveAttribute('aria-selected', 'true');
		await expect.poll(() => fixtureSnapshot(page).then(({ installCalls }) => installCalls)).toBe(0);
		await assistance.locator('button').filter({ hasText: /^Close$/u }).click();
		await expect(assistance).toBeHidden();

		await chooseNestedCommandAction(page, editor, 'Tools', ['Local Models', 'Manage Models…']);
		const manager = page.getByRole('dialog', { name: 'Local Models', exact: true });
		const model = manager.locator('[data-local-model-id="deepfilternet3"]');
		await expect(model).toHaveAttribute('data-local-model-availability', 'installable');
		await expect(model.getByRole('button', { name: 'Install', exact: true })).toBeVisible();
		await model.getByRole('button', { name: 'Install', exact: true }).click();
		await expect(model).toHaveAttribute('data-local-model-availability', 'installed');
		await expect(model.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
		await expect.poll(() => fixtureSnapshot(page).then(({ installCalls }) => installCalls)).toBe(1);
		await manager.locator('button').filter({ hasText: /^Close$/u }).click();
		await expect(manager).toBeHidden();
		await selectedClip.focus();
		await page.keyboard.press('Enter');
		await expect(selectedClip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);

		await chooseCommandAction(page, editor, 'Analyze', 'Local Assistance…');
		assistance = page.getByRole('dialog', { name: 'Local Assistance', exact: true });
		const guided = assistance.getByRole('tabpanel', { name: 'Guided', exact: true });
		const workflowSelection = guided.getByRole('combobox', { name: 'Workflow', exact: true });
		await expect(workflowSelection).toHaveValue('');
		await expect(workflowSelection.locator('option', { hasText: 'Mark Cuts' })).toHaveCount(1);
		await workflowSelection.selectOption({ label: 'Mark Cuts' });
		const fastMode = guided.getByRole('radio', { name: 'Fast · model-free', exact: true });
		const accurateMode = guided.getByRole('radio', { name: 'Accurate · TransNetV2', exact: true });
		await expect(fastMode).toBeChecked();
		await accurateMode.check();
		await expect(accurateMode).toBeChecked();
		await fastMode.check();
		await expect(fastMode).toBeChecked();

		const consentMessages = [];
		page.on('dialog', async (dialog) => {
			consentMessages.push(dialog.message());
			expect(dialog.type()).toBe('confirm');
			await dialog.accept();
		});
		await guided.getByRole('button', { name: 'Run Guided workflow', exact: true }).click();
		await expect(guided.getByRole('status')).toHaveText('detect-shots · running');
		await expect.poll(() => fixtureSnapshot(page).then(({ progressEvents }) => progressEvents)).toBe(1);
		await page.evaluate(() => globalThis.__m7AssistanceFixture.completeRun());
		await expect(guided.getByRole('status')).toContainText('The Guided workflow completed.');

		expect(consentMessages).toHaveLength(1);
		expect(consentMessages[0]).toContain('Workflow: mark-cuts');
		expect(consentMessages[0]).toContain('Stages: detect-shots, normalize-cuts');
		expect(consentMessages[0]).toContain('Models: none');
		expect(consentMessages[0]).toContain('Outputs: shot-boundaries, cut-proposals');
		expect(consentMessages[0]).toMatch(/Selection: .+:[0-9]+-[0-9]+/u);

		await guided.getByRole('button', { name: 'Review result', exact: true }).click();
		const review = guided.getByRole('region', { name: 'Guided workflow review', exact: true });
		await expect(review).toBeVisible();
		const choice = review.getByRole('checkbox', { name: 'Cut 1', exact: true });
		const accept = guided.getByRole('button', { name: 'Accept selected', exact: true });
		await expect(choice).not.toBeChecked();
		await expect(accept).toBeDisabled();
		await choice.check();
		await expect(accept).toBeEnabled();
		await choice.uncheck();
		await expect(accept).toBeDisabled();
		await choice.check();
		await accept.click();
		await expect(guided.getByRole('status')).toHaveText('The proposal was accepted.');
		await assistance.locator('button').filter({ hasText: /^Close$/u }).click();
		await expect(assistance).toBeHidden();

		await expect.poll(() => storedShotAnnotations(page, projectId), { timeout: 15_000 })
			.toHaveLength(1);
		const [acceptedMarker] = await storedShotAnnotations(page, projectId);
		expect(acceptedMarker).toMatchObject({
			name: 'Shot 1', kind: 'marker', anchor: 'sample', color: 'orange',
			ownership: {
				schemaVersion: 1, operation: 'shot-detection', detector: 'ffmpeg-scdet',
				timescale: CUT_FIXTURE.timescale,
				sourceFrameCount: CUT_FIXTURE.sourceFrameCount,
				sourceStartFrame: 0,
				sourceEndFrame: CUT_FIXTURE.sourceFrameCount,
				sourceFrame: CUT_FIXTURE.sourceFrame,
				presentationTick: CUT_FIXTURE.presentationTick,
				score: 0.9,
			},
		});
		expect(acceptedMarker.id).toMatch(/^assistance-shot:[a-f\d]{64}:4$/u);
		expect(acceptedMarker.positionFrame).toBeGreaterThan(0);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect.poll(() => storedShotAnnotations(page, projectId), { timeout: 15_000 })
			.toHaveLength(0);

		await page.evaluate(() => { globalThis.__m7AssistanceFixture.stallNextCreate = true; });
		await selectedClip.focus();
		await page.keyboard.press('Enter');
		await chooseCommandAction(page, editor, 'Analyze', 'Local Assistance…');
		const cancellationDialog = page.getByRole('dialog', {
			name: 'Local Assistance', exact: true,
		});
		const cancellationGuided = cancellationDialog.getByRole('tabpanel', {
			name: 'Guided', exact: true,
		});
		await cancellationGuided.getByRole('combobox', { name: 'Workflow', exact: true })
			.selectOption({ label: 'Mark Cuts' });
		await cancellationGuided.getByRole('button', { name: 'Run Guided workflow', exact: true })
			.click();
		await expect.poll(() => fixtureSnapshot(page).then(({ createWaits }) => createWaits)).toBe(1);
		await expect(cancellationGuided.getByRole('status'))
			.toHaveText('Preparing the aggregate workflow request.');
		await cancellationGuided.getByRole('button', { name: 'Cancel', exact: true }).click();
		await page.evaluate(() => globalThis.__m7AssistanceFixture.releaseCreate());
		await expect(cancellationGuided.getByRole('status'))
			.toHaveText('The local operation was cancelled.');
		await expect.poll(() => fixtureSnapshot(page).then(({ cancelCalls }) => cancelCalls))
			.toBeGreaterThan(0);
		expect(consentMessages).toHaveLength(1);
		await expect.poll(() => fixtureSnapshot(page).then(({ installCalls }) => installCalls)).toBe(1);
		expect(errors).toEqual([]);
	});

	test('keeps Advanced opt-in and runs a primitive through one workflow consent', async ({ page }) => {
		test.setTimeout(120_000);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await installLocalAssistanceFixture(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		await editor.locator('[data-import-input]').setInputFiles([VIDEO.file]);
		const sourceName = VIDEO.file.name.replace(/\.[^.]+$/u, '');
		await editor.getByRole('button', {
			name: `Add to timeline: ${sourceName}`, exact: true,
		}).click();
		const selectedClip = editor.getByRole('group', { name: /^Video clip:/u }).first();
		await expect(selectedClip).toBeVisible({ timeout: 30_000 });
		await selectedClip.focus();
		await page.keyboard.press('Enter');
		await expect(selectedClip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);

		await chooseCommandAction(page, editor, 'Analyze', 'Local Assistance…');
		const assistance = page.getByRole('dialog', { name: 'Local Assistance', exact: true });
		const guidedTab = assistance.getByRole('tab', { name: 'Guided', exact: true });
		const advancedTab = assistance.getByRole('tab', { name: 'Advanced', exact: true });
		await expect(guidedTab).toHaveAttribute('aria-selected', 'true');
		await expect(assistance.getByRole('tabpanel', { name: 'Advanced', exact: true }))
			.toHaveCount(0);
		await advancedTab.click();
		const advanced = assistance.getByRole('tabpanel', { name: 'Advanced', exact: true });
		await expect(advancedTab).toHaveAttribute('aria-selected', 'true');
		await expect(advanced).toBeVisible();

		const source = advanced.getByRole('combobox', { name: 'Selected media', exact: true });
		await expect(source.locator('option')).toHaveCount(2);
		await source.selectOption({ index: 1 });
		const operation = advanced.getByRole('combobox', { name: 'Operation', exact: true });
		expect((await operation.locator('option').allTextContents()).slice(1)).toEqual(ADVANCED_OPERATIONS);
		await expect(advanced.locator('input[type="checkbox"]')).toHaveCount(0);
		await expect(advanced).toContainText(
			'Run locally opens one consent dialog for this exact operation, model, input, and output selection.',
		);
		await operation.selectOption('shot-detection');
		await expect(advanced.getByText('This operation requires no installed model binding.'))
			.toBeVisible();

		const consentMessages = [];
		page.on('dialog', async (dialog) => {
			consentMessages.push(dialog.message());
			expect(dialog.type()).toBe('confirm');
			await dialog.accept();
		});
		await advanced.getByRole('button', { name: 'Run locally', exact: true }).click();
		await expect(advanced.getByText('Running the local model.', { exact: true })).toBeVisible();
		await page.evaluate(() => globalThis.__m7AssistanceFixture.completeRun());
		await expect(advanced.getByText('A validated local result is available.', { exact: true }))
			.toBeVisible();

		expect(consentMessages).toHaveLength(1);
		expect(consentMessages[0]).toContain('Workflow: advanced:shot-detection');
		expect(consentMessages[0]).toContain('Stages: run-shot-detection');
		expect(consentMessages[0]).toContain('Models: none');
		expect(consentMessages[0]).toContain('Outputs: shot-boundaries');
		await expect.poll(() => fixtureSnapshot(page)).toMatchObject({
			workflowRuns: [{ workflowId: 'advanced:shot-detection',
				stageIds: ['run-shot-detection'] }],
			primitiveRuns: 0,
			installCalls: 0,
		});
		await assistance.getByRole('button', { name: 'Review result', exact: true }).click();
		await expect(advanced.getByRole('list', { name: 'Shot boundaries' })).toContainText(
			`Source frame ${String(CUT_FIXTURE.sourceFrame)}`,
		);
		expect(errors).toEqual([]);
	});

});

async function fixtureSnapshot(page) {
	return page.evaluate(() => ({
		installCalls: globalThis.__m7AssistanceFixture.installCalls,
		createWaits: globalThis.__m7AssistanceFixture.createWaits,
		cancelCalls: globalThis.__m7AssistanceFixture.cancelCalls,
		progressEvents: globalThis.__m7AssistanceFixture.progressEvents,
		workflowRuns: globalThis.__m7AssistanceFixture.workflowRuns,
		primitiveRuns: globalThis.__m7AssistanceFixture.primitiveRuns,
	}));
}

async function storedShotAnnotations(page, projectId) {
	return page.evaluate(async ({ databaseName, id }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const database = await result(indexedDB.open(databaseName));
		try {
			const project = await result(
				database.transaction('projects', 'readonly').objectStore('projects').get(id),
			);
			return (project?.timelineAnnotations ?? []).filter((annotation) => (
				annotation.opaqueExtensions?.['org.soundscaper.assistance-shot-boundaries-v1']
			)).map((annotation) => ({
				id: annotation.id,
				name: annotation.name,
				kind: annotation.kind,
				anchor: annotation.anchor,
				color: annotation.color,
				positionFrame: annotation.positionFrame,
				ownership: annotation.opaqueExtensions[
					'org.soundscaper.assistance-shot-boundaries-v1'
				],
			}));
		} finally {
			database.close();
		}
	}, { databaseName: FRAMESCAPER_DATABASE_NAME, id: projectId });
}

async function installLocalAssistanceFixture(page) {
	await page.addInitScript((cutFixture) => {
		const state = {
			installed: false,
			installCalls: 0,
			createWaits: 0,
			cancelCalls: 0,
			progressEvents: 0,
			workflowRuns: [],
			primitiveRuns: 0,
			stallNextCreate: false,
			releaseCreate: () => undefined,
			completeRun: () => undefined,
			latestInput: null,
			id: 1,
		};
		const workflowListeners = new Set();
		const outputReservations = new Map();
		const opaqueId = () => (state.id++).toString(16).padStart(40, '0');
		const artifactSha256 = '11'.repeat(32);
		const managerModel = () => Object.freeze({
			modelId: 'deepfilternet3',
			version: '3.0.0',
			task: 'speech-enhancement',
			availability: state.installed ? 'installed' : 'installable',
			downloadBytes: 4_096,
			installedBytes: state.installed ? 4_096 : null,
			attributionRequired: true,
		});
		const workflowClaim = (custody) => Object.freeze({
			claimVersion: 1,
			direction: custody.direction,
			claimId: custody.claimId,
			jobId: custody.jobId,
			stageId: custody.stageId,
			slotId: custody.slotId,
		});
		const handle = (custody) => Object.freeze({ custody: Object.freeze(custody),
			workflowClaim: workflowClaim(custody) });
		const inputHandle = (request) => handle({
			custodyVersion: 1,
			workflowId: request.workflowId,
			direction: 'input',
			jobId: request.jobId,
			stageId: request.stageId,
			slotId: request.slotId,
			claimId: opaqueId(),
			role: request.slotId,
			mediaType: request.mediaType,
			byteLength: request.byteLength,
			sha256: request.sha256,
			maximumByteLength: null,
			producer: null,
		});
		const outputHandle = (request) => {
			const custody = {
				custodyVersion: 1,
				workflowId: request.workflowId,
				direction: 'output',
				jobId: request.jobId,
				stageId: request.stageId,
				slotId: request.slotId,
				claimId: opaqueId(),
				role: request.slotId,
				mediaType: request.slotId === 'enhanced-audio' ? 'audio/wav' : 'application/json',
				byteLength: null,
				sha256: null,
				maximumByteLength: request.maximumByteLength,
				producer: null,
			};
			outputReservations.set(custody.claimId, custody);
			return handle(custody);
		};
		const custody = Object.freeze({
			stageInput: async (request) => {
				state.latestInput = request.bytes.slice(0, request.bytes.size, request.mediaType);
				return inputHandle(request);
			},
			reserveOutput: async (request) => outputHandle(request),
			bindProducer: async (request) => {
				const producer = outputReservations.get(request.producer.claimId);
				if (!producer) throw new Error('Fixture producer reservation is unavailable.');
				return handle({ ...producer, direction: 'input', stageId: request.stageId,
					slotId: request.slotId, byteLength: null, sha256: null,
					producer: { stageId: request.producer.stageId, slotId: request.producer.slotId,
						claimId: request.producer.claimId } });
			},
			release: async () => true,
		});
		const workflow = Object.freeze({
			custody,
			createJob: async () => {
				const job = Object.freeze({ contractVersion: 1, jobId: opaqueId() });
				if (!state.stallNextCreate) return job;
				state.stallNextCreate = false;
				state.createWaits += 1;
				return await new Promise((resolve) => {
					state.releaseCreate = () => {
						state.releaseCreate = () => undefined;
						resolve(job);
					};
				});
			},
			run: async (request) => {
				state.workflowRuns.push(Object.freeze({ workflowId: request.workflowId,
					stageIds: Object.freeze([...request.stageIds]) }));
				const ranges = request.fence.sourceRanges.map((range) => (
					`${range.sourceId}:${String(range.sourceStartFrame)}-${String(range.sourceEndFrame)}`
				)).join(', ');
				const models = request.models.map((model) => (
					`${model.modelId}@${model.version}`
				)).join(', ') || 'none';
				const outputs = request.outputs.map(({ slotId }) => slotId).join(', ');
				const accepted = globalThis.confirm([
					'Local Assistance consent',
					`Workflow: ${request.workflowId}`,
					`Selection: ${ranges}`,
					`Stages: ${request.stageIds.join(', ')}`,
					`Models: ${models}`,
					`Outputs: ${outputs}`,
				].join('\n'));
				if (!accepted) return Object.freeze({ contractVersion: 1, jobId: request.jobId,
					workflowId: request.workflowId, outcome: 'consent-declined' });
				setTimeout(() => {
					const progress = Object.freeze({ contractVersion: 1, jobId: request.jobId,
						workflowId: request.workflowId, sequence: 0, stageId: request.stageIds[0],
						stageIndex: 0, stageCount: request.stageIds.length, phase: 'running',
						completed: 1, total: 4 });
					state.progressEvents += 1;
					for (const listener of workflowListeners) listener(progress);
				}, 0);
				return await new Promise((resolve) => {
					state.completeRun = () => {
						state.completeRun = () => undefined;
						resolve(Object.freeze({ contractVersion: 1, jobId: request.jobId,
							workflowId: request.workflowId, outcome: 'completed', result: Object.freeze({
								contractVersion: 1, jobId: request.jobId, workflowId: request.workflowId,
								stageIds: request.stageIds, outputs: request.outputs,
							}) }));
					};
				});
			},
			cancel: async (jobId) => {
				state.cancelCalls += 1;
				return Object.freeze({ contractVersion: 1, jobId, outcome: 'cancelled' });
			},
			readOutput: async ({ claim }) => {
				if (!outputReservations.has(claim.claimId) || !(state.latestInput instanceof Blob)) {
					throw new Error('Fixture output custody is unavailable.');
				}
				const semantic = claim.slotId === 'cut-proposals' ? {
					schemaVersion: 1,
					kind: 'cut-proposals',
					mode: 'fast',
					detector: 'ffmpeg-scdet',
					timescale: cutFixture.timescale,
					sourceFrameCount: cutFixture.sourceFrameCount,
					proposals: [{
						id: `cut:${String(cutFixture.sourceFrame)}:${cutFixture.presentationTick}`,
						sourceFrame: cutFixture.sourceFrame,
						presentationTick: cutFixture.presentationTick,
						score: 0.9,
						selected: false,
					}],
				} : {
					schemaVersion: 1,
					detector: 'ffmpeg-scdet',
					timescale: cutFixture.timescale,
					sourceFrameCount: cutFixture.sourceFrameCount,
					boundaries: [{
						sourceFrame: cutFixture.sourceFrame,
						presentationTick: cutFixture.presentationTick,
						score: 0.9,
					}],
				};
				return new Blob([JSON.stringify(semantic)], { type: 'application/json' });
			},
			onProgress: (listener) => {
				workflowListeners.add(listener);
				return () => workflowListeners.delete(listener);
			},
		});
		const localAssistance = Object.freeze({
			models: async () => state.installed ? Object.freeze([Object.freeze({
				modelId: 'deepfilternet3', version: '3.0.0', task: 'speech-enhancement',
				artifactSha256s: Object.freeze([artifactSha256]),
			})]) : Object.freeze([]),
			createJob: async () => Object.freeze({ contractVersion: 1, jobId: opaqueId() }),
			stageInput: async () => { throw new Error('Primitive staging is not used.'); },
			reserveOutput: async () => { throw new Error('Primitive reservation is not used.'); },
			run: async () => {
				state.primitiveRuns += 1;
				throw new Error('Primitive inference is not used.');
			},
			cancel: async (jobId) => Object.freeze({ contractVersion: 1, jobId, outcome: 'not-active' }),
			readOutput: async () => { throw new Error('Primitive output is not used.'); },
			release: async () => true,
			onProgress: () => () => undefined,
			workflow,
		});
		const bridge = Object.freeze({
			getEnvironment: async () => null,
			signalReady: async () => undefined,
			setLocale: async () => undefined,
			onMenuCommand: () => () => undefined,
			onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined,
			onWindowStateChanged: () => () => undefined,
			readNativeTierControls: async () => Object.freeze({
				probeHelperEnabled: false,
				probeHelperQuarantined: false,
				audioHelperEnabled: false,
				audioHelperQuarantined: false,
				nativeEffectDiscoveryEnabled: false,
			}),
			applyNativeTierControl: async () => {
				throw new Error('The Local Assistance fixture does not mutate native-tier controls.');
			},
			listAssistanceModels: async () => Object.freeze({ runtimeAvailable: true,
				runtimeReason: null, models: Object.freeze([managerModel()]) }),
			installAssistanceModel: async () => {
				state.installCalls += 1;
				state.installed = true;
				return managerModel();
			},
			cancelAssistanceModelInstall: async (modelId) => Object.freeze({
				contractVersion: 1, modelId, outcome: 'not-active',
			}),
			installPreseededAssistanceModel: async () => null,
			reconcileAssistanceModels: async () => Object.freeze({
				installedModelIds: state.installed ? ['deepfilternet3'] : [],
				incompleteModelIds: [], rejected: [],
			}),
			collectAssistanceModelGarbage: async () => Object.freeze({ reclaimedBlobBytes: 0,
				discardedManifestCount: 0, discardedPartialCount: 0,
				discardedPartialBytes: 0, reclaimedBytes: 0 }),
			listAssistanceModelNotices: async () => Object.freeze([]),
			relocateAssistanceModels: async () => null,
			removeAssistanceModel: async () => { state.installed = false; return 4_096; },
			onAssistanceInstallProgress: () => () => undefined,
			localAssistance,
		});
		Object.defineProperty(globalThis, '__m7AssistanceFixture', {
			configurable: true, value: state,
		});
		Object.defineProperty(globalThis, 'soundscaperDesktop', {
			configurable: true, value: Object.freeze({ v1: bridge }),
		});
	}, CUT_FIXTURE);
}
