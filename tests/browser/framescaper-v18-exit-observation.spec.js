/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, TRANSLATIONS_ROOT } from './audio-editor-test-fixtures.js';

import { sequenceFrameBoundarySample } from '../../src/common/editor/sequence-frame-navigation.ts';
import {
	validateVideoTimingAssetBytes,
} from '../../src/common/editor/video-timing-asset.ts';
import {
	videoBoundaryTime,
	videoSourceTimingView,
} from '../../src/common/editor/video-source-timing-view.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-project-runtime-profile-v18.ts';
import {
	materializeFramescaperMulticameraPlaybackProjectV18,
} from '../../src/framescaper/editor-project-v18-multicam-playback.ts';
import {
	flattenFramescaperSequenceV18,
} from '../../src/framescaper/editor-project-v18-nested-sequence.ts';
import {
	createM3FramescaperV18ExitWorkload,
	validateM3FramescaperV18ExitWorkload,
} from '../../src/framescaper/quality/m3-framescaper-v18-exit-workload.ts';
import {
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
} from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';

const DATABASE_NAME = 'kw-media-framescaper-editor-v18';
const OPFS_DIRECTORY_NAME = 'framescaper-editor-v18-sources';
const ENVIRONMENT_ID = 'reference-linux-gpu-01';
const PROFILE = 'deterministic-framescaper-v18-browser-observation-v1';
const WORKLOAD_ID = 'm3-framescaper-v18-exit';
const FIXTURE_ID = 'm3-framescaper-v18-exit-2h-v1';
const CFR = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1');
const VFR = videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1');

test('observes maintained V18 timing, nested, and multicamera projections without qualifying the host', async ({
	browser,
	context,
	page,
}) => {
	test.skip(
		process.env.SOUNDSCAPER_M3_FRAMESCAPER_V18_EXIT !== '1',
		'Run explicitly through quality:collect:m3-framescaper-v18-exit.',
	);
	test.setTimeout(360_000);
	await page.setViewportSize({ width: 1_440, height: 1_100 });
	await installRuntimeRoutes(page);
	let editor = await bootEditor(page, '/framescaper/en/');
	const projectId = await editor.getAttribute('data-project-id');
	expect(projectId).toBeTruthy();

	await selectSequenceRate25(page, editor);
	for (const file of [cameraFile('camera-a.mp4'), cameraFile('camera-b.mp4')]) {
		await importMedia(editor, file);
	}
	const clips = editor.locator('[data-clip-kind="video"]');
	await expect(clips).toHaveCount(2, { timeout: 30_000 });
	await clips.first().focus();
	await clips.first().press('Enter');
	await expect(clips.first().locator('.clip-display')).toHaveClass(/clip-display--selected/u);

	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Create from video sources']);
	await waitForAction(editor);
	await saveProject(page, editor);
	const created = await storedV18Evidence(page, projectId);
	expect(created.project.multicameraGroups).toHaveLength(1);
	expect(created.project.multicameraGroups[0].members).toHaveLength(2);
	const initialActiveMemberId = created.project.multicameraGroups[0].activeMemberId;

	await chooseNestedCommandAction(page, editor, 'Tracks', ['Multicamera', 'Switch camera']);
	await waitForAction(editor);
	await saveProject(page, editor);
	const switched = await storedV18Evidence(page, projectId);
	expect(switched.project.multicameraGroups[0].activeMemberId).not.toBe(initialActiveMemberId);

	await importMedia(editor, {
		name: VFR.file.name,
		mimeType: VFR.file.mimeType,
		buffer: Buffer.from(VFR.file.buffer),
	});
	await nestedAction(page, editor, 'Create shared sequence');
	await nestedAction(page, editor, 'Add nested placement');
	await nestedAction(page, editor, 'Move nested sequence');
	await saveProject(page, editor);

	await page.close();
	const reopenedPage = await context.newPage();
	await reopenedPage.setViewportSize({ width: 1_440, height: 1_100 });
	await installRuntimeRoutes(reopenedPage);
	editor = await bootEditor(
		reopenedPage,
		`/framescaper/en/?project=${encodeURIComponent(projectId)}`,
	);
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	const browserEvidence = await storedV18Evidence(reopenedPage, projectId);
	assertBrowserWorkflow(browserEvidence, initialActiveMemberId);
	for (const evidence of browserEvidence.timingEvidence) {
		const index = validateVideoTimingAssetBytes(
			evidence.source.timingAsset,
			Uint8Array.from(evidence.timingBytes),
		);
		expect(index.frameCount).toBe(evidence.source.sourceFrameCount);
	}

	const workload = createM3FramescaperV18ExitWorkload(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE);
	const input = validateM3FramescaperV18ExitWorkload(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		workload,
	);
	expect(input.status).toBe('qualified-input');
	const projectionTrials = measureMaintainedProjections(workload);
	expect(projectionTrials).toHaveLength(6);
	for (const trial of projectionTrials) {
		expect(trial.observedSample).toBe(trial.expectedSample);
		expect(trial.observedVideoFrame).toBe(trial.expectedVideoFrame);
	}
	const renderer = await rendererDiagnostic(reopenedPage);
	const diagnostic = {
		schemaVersion: 1,
		profile: PROFILE,
		observationClass: 'framescaper-v18-maintained-projections-v1',
		workloadId: WORKLOAD_ID,
		fixtureId: FIXTURE_ID,
		environmentId: ENVIRONMENT_ID,
		rendererClass: renderer.rendererClass,
		environmentFingerprint: await browserFingerprint(reopenedPage, browser, renderer),
		fixture: fixtureIdentity(workload),
		browserWorkflow: {
			productId: 'framescaper',
			projectSchemaVersion: browserEvidence.project.schemaVersion,
			coldReopenCount: 1,
			exactTimingSourceCount: browserEvidence.timingEvidence.length,
			nestedPlacementCount: browserEvidence.project.subsequences.length,
			multicameraGroupCount: browserEvidence.project.multicameraGroups.length,
			multicameraMemberCount: browserEvidence.project.multicameraGroups[0].members.length,
			activeMemberSwitchCount: 1,
		},
		projectionTrials,
	};
	console.log(`SOUNDSCAPER_M3_FRAMESCAPER_V18_EXIT ${JSON.stringify(diagnostic)}`);
});

function measureMaintainedProjections(workload) {
	const expected = new Map(workload.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
	const project = workload.project;
	const sampleRate = project.sampleRate;
	const main = project.sequences.find(({ id }) => id === project.primarySequenceId);
	const nestedSequence = project.sequences.find(({ id }) => id === 'nested-sequence');
	const vfrSource = project.sources.find(({ id }) => id === 'vfr-source');
	const vfrIndex = validateVideoTimingAssetBytes(
		vfrSource.timingAsset,
		Uint8Array.from(workload.vfrTimingBytes),
	);
	const vfrView = videoSourceTimingView(new Map([[
		vfrSource.id,
		{ kind: 'vfr', reference: vfrSource.timingAsset, index: vfrIndex },
	]]), vfrSource);
	const flattened = flattenFramescaperSequenceV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		project,
		project.primarySequenceId,
	);
	const nested = flattened.find(({ clipId }) => clipId === 'nested-video-clip');
	const multicameraProject = materializeFramescaperMulticameraPlaybackProjectV18(
		FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE,
		project,
	);
	const cameraClip = multicameraProject.clips.find(({ id }) => id === 'multicamera-output');
	const group = project.multicameraGroups[0];
	const activeMember = group.members.find(({ id }) => id === group.activeMemberId);
	expect(cameraClip.sourceId).toBe(activeMember.sourceId);
	expect(
		sequenceFrameBoundarySample(cameraClip.sourceInFrame, main.rate, sampleRate)
			- activeMember.syncOffsetSamples,
	).toBe(sequenceFrameBoundarySample(
		project.clips.find(({ id }) => id === group.outputClipId).sourceInFrame,
		main.rate,
		sampleRate,
	));
	return [
		measuredTrial(expected, 'audio-start', () => ({ sample: 0, frame: null })),
		measuredTrial(expected, 'integer-video', () => ({
			sample: sequenceFrameBoundarySample(30, main.rate, sampleRate),
			frame: 30,
		})),
		measuredTrial(expected, 'ntsc-video', () => ({
			sample: sequenceFrameBoundarySample(30, nestedSequence.rate, sampleRate),
			frame: 30,
		})),
		measuredTrial(expected, 'verified-vfr', () => {
			const time = videoBoundaryTime(vfrView, 2);
			return {
				sample: exactInteger(time.numerator * BigInt(sampleRate), time.denominator),
				frame: 2,
			};
		}),
		measuredTrial(expected, 'nested-root', () => ({
			sample: exactInteger(
				nested.startFrame.numerator * BigInt(sampleRate * main.rate.den),
				nested.startFrame.denominator * BigInt(main.rate.num),
			),
			frame: exactInteger(nested.startFrame.numerator, nested.startFrame.denominator),
		})),
		measuredTrial(expected, 'multicamera-active', () => ({
			sample: sequenceFrameBoundarySample(cameraClip.sequenceStartFrame, main.rate, sampleRate),
			frame: cameraClip.sequenceStartFrame,
		})),
	];
}

function measuredTrial(expectedById, id, observe) {
	const expected = expectedById.get(id);
	const startedAt = performance.now();
	const observed = observe();
	return {
		id,
		kind: expected.kind,
		expectedSample: expected.expectedSample,
		observedSample: observed.sample,
		expectedVideoFrame: expected.expectedVideoFrame,
		observedVideoFrame: observed.frame,
		elapsedMs: performance.now() - startedAt,
	};
}

function fixtureIdentity(workload) {
	return {
		schemaVersion: workload.project.schemaVersion,
		durationSeconds: workload.specification.durationSeconds,
		sampleRate: workload.specification.sampleRate,
		contains: [
			'attached-proxy',
			'nested-sequence',
			'multicamera',
			'verified-vfr',
			'source-timecode',
		],
	};
}

function assertBrowserWorkflow(evidence, initialActiveMemberId) {
	const project = evidence.project;
	expect(project.schemaVersion).toBe(18);
	expect(project.subsequences).toHaveLength(1);
	expect(project.subsequences[0].sequenceStartFrame).toBe(25);
	expect(project.multicameraGroups).toHaveLength(1);
	expect(project.multicameraGroups[0].members).toHaveLength(2);
	expect(project.multicameraGroups[0].activeMemberId).not.toBe(initialActiveMemberId);
	expect(evidence.timingEvidence).toHaveLength(3);
	expect(evidence.timingEvidence.every(({ source }) => (
		source.timingDecision?.mode === 'exact' && source.timingAsset !== null
	))).toBe(true);
}

async function installRuntimeRoutes(page) {
	await installPinnedFfmpegRuntimeRoutes(page);
	await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		headers: { 'Access-Control-Allow-Origin': '*' },
		body: JSON.stringify({ schemaVersion: 1, locales: {} }),
	}));
}

async function selectSequenceRate25(page, editor) {
	const projectBin = editor.locator('[data-workspace-panel="project-bin"]');
	if (await projectBin.isVisible()) {
		await projectBin.locator('.kw-audio-editor__workspace-panel-close').click();
		await expect(projectBin).toBeHidden();
	}
	await editor.getByRole('button', { name: 'Sequence timing', exact: true }).focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Sequence timing', exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('25/1');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
}

async function importMedia(editor, file) {
	await editor.locator('[data-import-input]').setInputFiles(file);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', {
		timeout: 90_000,
	});
}

async function nestedAction(page, editor, action) {
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Nested sequences', action]);
	await waitForAction(editor);
}

async function waitForAction(editor) {
	await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
}

async function saveProject(page, editor) {
	await chooseFileAction(page, editor, 'Save project');
	await expect(editor.getByRole('tab', { selected: true })).toBeEnabled();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
}

function cameraFile(name) {
	return {
		name,
		mimeType: CFR.file.mimeType,
		buffer: Buffer.from(CFR.file.buffer),
	};
}

async function storedV18Evidence(page, projectId) {
	return page.evaluate(async ({ databaseName, id, opfsDirectoryName }) => {
		const result = (request) => new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const readBytes = async (record, chunks) => {
			if (record.storage === 'opfs') {
				const root = await navigator.storage.getDirectory();
				const directory = await root.getDirectoryHandle(opfsDirectoryName);
				const handle = await directory.getFileHandle(record.path);
				return [...new Uint8Array(await (await handle.getFile()).arrayBuffer())];
			}
			if (record.blob instanceof Blob) return [...new Uint8Array(await record.blob.arrayBuffer())];
			const selected = chunks
				.filter(({ mediaChunkToken }) => mediaChunkToken === record.mediaChunkToken)
				.sort((left, right) => left.index - right.index);
			const bytes = new Uint8Array(selected.reduce((total, chunk) => total + chunk.payload.size, 0));
			let offset = 0;
			for (const chunk of selected) {
				const payload = new Uint8Array(await chunk.payload.arrayBuffer());
				bytes.set(payload, offset);
				offset += payload.byteLength;
			}
			return [...bytes];
		};
		const database = await result(indexedDB.open(databaseName));
		try {
			const transaction = database.transaction(
				['projects', 'revisions', 'mediaAssets', 'mediaAssetChunks'],
				'readonly',
			);
			const [project, revisions, mediaAssets, mediaChunks] = await Promise.all([
				result(transaction.objectStore('projects').get(id)),
				result(transaction.objectStore('revisions').getAll()),
				result(transaction.objectStore('mediaAssets').getAll()),
				result(transaction.objectStore('mediaAssetChunks').getAll()),
			]);
			const latest = revisions
				.filter(({ projectId: revisionProjectId }) => revisionProjectId === id)
				.sort((left, right) => right.revision - left.revision)[0]?.project ?? project;
			const timingEvidence = [];
			for (const source of latest.sources.filter(({ kind, timingAsset }) => (
				kind === 'video' && timingAsset !== null
			))) {
				const record = mediaAssets.find(({ sourceId }) => sourceId === source.timingAsset.storageKey);
				if (!record) throw new Error(`Timing body ${source.timingAsset.storageKey} is missing.`);
				timingEvidence.push({
					source,
					timingBytes: await readBytes(record, mediaChunks),
				});
			}
			return { project: latest, timingEvidence };
		} finally {
			database.close();
		}
	}, { databaseName: DATABASE_NAME, id: projectId, opfsDirectoryName: OPFS_DIRECTORY_NAME });
}

function exactInteger(numerator, denominator) {
	if (denominator <= 0n || numerator % denominator !== 0n) {
		throw new RangeError('A V18 observation did not resolve to an exact integer coordinate.');
	}
	const result = Number(numerator / denominator);
	if (!Number.isSafeInteger(result)) throw new RangeError('A V18 observation exceeds the safe-integer range.');
	return result;
}

async function rendererDiagnostic(page) {
	return page.evaluate(() => {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
		const info = gl?.getExtension('WEBGL_debug_renderer_info');
		const vendor = gl
			? String(info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR))
			: 'unavailable';
		const renderer = gl
			? String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
			: 'unavailable';
		const joined = `${vendor} ${renderer}`;
		return {
			vendor,
			renderer,
			rendererClass: !gl
				? 'unknown'
				: /swiftshader|llvmpipe|software|offscreen/iu.test(joined) ? 'software' : 'hardware',
		};
	});
}

async function browserFingerprint(page, browser, renderer) {
	const values = await page.evaluate(() => ({
		userAgent: navigator.userAgent,
		platform: navigator.platform,
		logicalCpuCount: navigator.hardwareConcurrency,
		deviceMemoryGiB: navigator.deviceMemory ?? null,
		displayMode: `${screen.width}x${screen.height}@${devicePixelRatio}`,
		displayRefreshHz: null,
		powerProfile: null,
	}));
	return {
		...values,
		browserVersion: browser.version(),
		browserBinarySha256: null,
		gpuVendor: renderer.vendor,
		gpuModel: renderer.renderer,
		gpuMemoryBytes: null,
		gpuDriver: null,
	};
}
