/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
	stubStorageEstimate,
} from './audio-editor-test-helpers.js';

test.describe('menu-only Guided Local Assistance', () => {
	registerAudioEditorHooks();

	test('keeps menu-only Guided workflows separate from explicit model install', async ({ page }) => {
		test.setTimeout(30_000);
		await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
		await installLocalAssistanceFixture(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const selectedClip = clipByName(editor, toneA.name);
		await selectedClip.focus();
		await page.keyboard.press('Enter');
		await expect(selectedClip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');

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
		await selectedClip.focus();
		await page.keyboard.press('Enter');
		await expect(selectedClip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');

		await chooseCommandAction(page, editor, 'Analyze', 'Local Assistance…');
		assistance = page.getByRole('dialog', { name: 'Local Assistance', exact: true });
		const workflowSelection = assistance.getByRole('tabpanel', { name: 'Guided', exact: true })
			.getByRole('combobox', { name: 'Workflow', exact: true });
		await expect(workflowSelection).toHaveValue('');
		await expect(workflowSelection.locator('option', { hasText: 'Enhance Dialogue' })).toHaveCount(1);
		await expect.poll(() => fixtureSnapshot(page).then(({ installCalls }) => installCalls)).toBe(1);
		expect(errors).toEqual([]);
	});
});

async function fixtureSnapshot(page) {
	return page.evaluate(() => ({
		installCalls: globalThis.__m7AssistanceFixture.installCalls,
	}));
}

async function installLocalAssistanceFixture(page) {
	await page.addInitScript(() => {
		const state = {
			installed: false,
			installCalls: 0,
			createWaits: 0,
			cancelCalls: 0,
			progressEvents: 0,
			stallNextCreate: true,
			releaseCreate: () => undefined,
			completeRun: () => undefined,
			latestAudio: null,
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
				state.latestAudio = request.bytes.slice(0, request.bytes.size, request.mediaType);
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
				const ranges = request.fence.sourceRanges.map((range) => (
					`${range.sourceId}:${String(range.sourceStartFrame)}-${String(range.sourceEndFrame)}`
				)).join(', ');
				const models = request.models.map((model) => `${model.modelId}@${model.version}`).join(', ');
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
				if (!outputReservations.has(claim.claimId) || !(state.latestAudio instanceof Blob)) {
					throw new Error('Fixture output custody is unavailable.');
				}
				return state.latestAudio.slice(0, state.latestAudio.size, 'audio/wav');
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
			run: async () => { throw new Error('Primitive inference is not used.'); },
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
	});
}
