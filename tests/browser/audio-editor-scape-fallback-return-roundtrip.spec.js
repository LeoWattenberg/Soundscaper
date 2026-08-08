import { createHash } from 'node:crypto';

import {
	BlobReader,
	BlobWriter,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import {
	asymmetricStereoTone,
	expect,
	test,
	toneA,
	TRANSLATIONS_ROOT,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	clipByName,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
	trackNameText,
} from './audio-editor-test-helpers.js';

const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const PRODUCT_PATHS = {
	soundscaper: '/embed/en/',
	framescaper: '/framescaper/embed/en/',
};
const FEATURE_IDS = {
	audio: 'org.soundscaper.capability.audio-effects',
	video: 'org.soundscaper.capability.video-effects',
};
const AUDIO_EFFECT = {
	id: 'publisher-saturator',
	type: 'com.example.saturator',
	enabled: true,
	params: { drive: 0.625, opaqueCurve: [0, 0.4, 1] },
};
const VIDEO_EFFECT = {
	id: 'publisher-pixelate',
	type: 'pixelate',
	enabled: true,
	params: { blockSize: 12 },
};

const WORKFLOWS = [{
	id: 'audio-whole-mix-web-roundtrip',
	origin: 'soundscaper',
	recipient: 'framescaper',
	kind: 'audio',
	role: 'project-audio-mix-v1',
}, {
	id: 'audio-track-render-web-roundtrip',
	origin: 'soundscaper',
	recipient: 'framescaper',
	kind: 'audio',
	role: 'audio-track-render-v1',
}, {
	id: 'video-full-project-web-roundtrip',
	origin: 'framescaper',
	recipient: 'soundscaper',
	kind: 'video',
	role: 'project-video-render-v1',
}, {
	id: 'video-clip-render-web-roundtrip',
	origin: 'framescaper',
	recipient: 'soundscaper',
	kind: 'video',
	role: 'video-clip-render-v1',
}];

test.describe('rendered-fallback Scape return roundtrips', () => {
	registerAudioEditorHooks();

	for (const workflow of WORKFLOWS) {
		test(workflow.id, async ({ browser, page }) => {
			test.setTimeout(120_000);
			const origin = await bootEditor(page, PRODUCT_PATHS[workflow.origin]);
			const originErrors = collectClientErrors(page);
			const baseArchive = workflow.kind === 'audio'
				? await createAudioBaseArchive(page, origin)
				: await createVideoBaseArchive(page, origin, workflow.id);
			const outboundArchive = await renderedFallbackArchive(baseArchive, workflow);
			const outbound = await inspectScapeArchive(outboundArchive);

			const baseURL = new URL(page.url()).origin;
			const runtimes = [];
			try {
				const recipient = await openProductRuntime(browser, baseURL, workflow.recipient);
				runtimes.push(recipient);
				const recipientErrors = collectClientErrors(recipient.page);
				if (workflow.kind === 'audio') await installAudioScheduleProbe(recipient.page);
				await openScapeArchive(recipient.editor, outboundArchive, `${workflow.id}-outbound.scape`);
				await acceptReadOnlyFallback(recipient, workflow, outbound.project.id);
				await assertFallbackPlayback(recipient, workflow);

				const returningArchive = await exportScapeArchive(recipient.page, recipient.editor);
				const returning = await inspectScapeArchive(returningArchive);
				expect(returning.project).toEqual(outbound.project);
				expect(returning.assets).toEqual(outbound.assets);

				const home = await openProductRuntime(browser, baseURL, workflow.origin);
				runtimes.push(home);
				const homeErrors = collectClientErrors(home.page);
				await openScapeArchive(home.editor, returningArchive, `${workflow.id}-return.scape`);
				await expect(home.editor).toHaveAttribute('data-project-id', outbound.project.id, {
					timeout: 20_000,
				});
				await expect(home.editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
				await expect(home.editor.locator('[data-project-feature-compatibility]')).toHaveCount(0);
				await renameFirstTrack(home.editor, `${workflow.id} editable`);
				await expect(home.editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
				const edited = await inspectScapeArchive(await exportScapeArchive(home.page, home.editor));
				expect(edited.assets).toEqual(outbound.assets);
				expect(edited.project.sources).toEqual(outbound.project.sources);
				expect(edited.project.clips).toEqual(outbound.project.clips);
				expect(edited.project.featureRequirements).toEqual(outbound.project.featureRequirements);
				expect(edited.project.opaqueExtensions).toEqual(outbound.project.opaqueExtensions);
				expect(normalizeTrackNames(edited.project.tracks, outbound.project.tracks))
					.toEqual(outbound.project.tracks);

				expect(originErrors).toEqual([]);
				expect(recipientErrors).toEqual([]);
				expect(homeErrors).toEqual([]);
			} finally {
				for (const runtime of runtimes.reverse()) {
					if (!runtime.page.isClosed()) await runtime.page.close({ runBeforeUnload: false });
				}
			}
		});
	}
});

async function createAudioBaseArchive(page, editor) {
	for (const fixture of [toneA, asymmetricStereoTone]) {
		await importFiles(editor, [fixture]);
		await expect(clipByName(editor, fixture.name)).toBeVisible();
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	}
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 10_000,
	});
	return exportScapeArchive(page, editor);
}

async function createVideoBaseArchive(page, editor, id) {
	const canonical = await createGeneratedVideoFixture(page, `${id}-canonical.webm`);
	const fallback = { ...canonical, name: `${id}-fallback.webm`, buffer: Buffer.from(canonical.buffer) };
	await importFiles(editor, [canonical, fallback]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 10_000,
	});
	return exportScapeArchive(page, editor);
}

async function renderedFallbackArchive(input, workflow) {
	return rewriteArchive(input, ({ project, manifest }) => {
		project.id = workflow.id;
		project.title = `${workflow.role} return witness`;
		project.opaqueExtensions = {
			...project.opaqueExtensions,
			publisherReturnWitness: { role: workflow.role, revision: 1 },
		};
		const sources = project.sources.filter(({ kind }) => kind === workflow.kind);
		if (sources.length !== 2) throw new Error(`${workflow.id} requires exactly two ${workflow.kind} sources.`);
		const [canonicalSource, fallbackSource] = sources;
		const fallbackAsset = manifest.assets.find(({ sourceId }) => sourceId === fallbackSource.id);
		if (!fallbackAsset) throw new Error(`${workflow.id} is missing its fallback asset.`);
		const fallbackClipIds = new Set(project.clips
			.filter(({ sourceId }) => sourceId === fallbackSource.id)
			.map(({ id }) => id));
		project.clips = project.clips.filter(({ id }) => !fallbackClipIds.has(id));
		for (const track of project.tracks) {
			if (Array.isArray(track.clipIds)) {
				track.clipIds = track.clipIds.filter((id) => !fallbackClipIds.has(id));
			}
			if (Object.hasOwn(track, 'laneGroupId')) track.laneGroupId = null;
		}
		project.tracks = project.tracks.filter((track) => track.type === 'label' || track.clipIds.length > 0);
		const targetClip = project.clips.find(({ sourceId }) => sourceId === canonicalSource.id);
		const targetTrack = project.tracks.find(({ clipIds }) => clipIds?.includes(targetClip?.id));
		if (!targetClip || !targetTrack) throw new Error(`${workflow.id} is missing its canonical target.`);

		if (workflow.kind === 'audio') {
			project.sampleRate = fallbackSource.sampleRate;
			targetClip.durationFrames = fallbackSource.frameCount;
			targetTrack.effectsActive = true;
			targetTrack.effects = [structuredClone(AUDIO_EFFECT)];
		} else {
			fallbackSource.sampleRate = canonicalSource.sampleRate;
			fallbackSource.frameCount = targetClip.durationFrames;
			fallbackSource.width = canonicalSource.width;
			fallbackSource.height = canonicalSource.height;
			fallbackSource.frameRate = canonicalSource.frameRate;
			fallbackSource.hasAudio = false;
			targetClip.videoEffects = [structuredClone(VIDEO_EFFECT)];
		}

		project.featureRequirements = {
			schemaVersion: 2,
			requirements: [{
				id: `publisher-${workflow.kind}-render`,
				featureId: FEATURE_IDS[workflow.kind],
				displayName: `${workflow.role} publisher state`,
				disposition: 'rendered-fallback',
				fallback: {
					role: workflow.role,
					kind: workflow.kind,
					sourceId: fallbackSource.id,
					sha256: fallbackAsset.sha256,
					...(workflow.role === 'audio-track-render-v1'
						? { targetTrackId: targetTrack.id }
						: {}),
					...(workflow.role === 'video-clip-render-v1'
						? { targetClipId: targetClip.id }
						: {}),
				},
			}],
		};
	});
}

async function acceptReadOnlyFallback(runtime, workflow, projectId) {
	const dialog = runtime.page.getByRole('dialog', { name: 'Project features unavailable', exact: true });
	await expect(dialog).toHaveAttribute('data-scape-open-decision', 'compatibility');
	await expect(dialog.getByText(/Unavailable.*Rendered fallback declared/iu)).toBeVisible();
	await dialog.getByRole('button', { name: 'Open read-only', exact: true }).click();
	await expect(runtime.editor).toHaveAttribute('data-project-id', projectId, { timeout: 20_000 });
	await expect(runtime.editor).toHaveAttribute('data-edit-block-reason', 'read-only');
	const requirement = runtime.editor.locator(
		`[data-project-feature-requirement="${FEATURE_IDS[workflow.kind]}"]`,
	);
	await expect(requirement).toHaveAttribute('data-declared-disposition', 'rendered-fallback');
	await expect(requirement).toHaveAttribute('data-effective-disposition', 'rendered-fallback');
	await expect(requirement.locator(
		workflow.kind === 'audio'
			? '[data-project-feature-audio-rendered-fallback]'
			: '[data-project-feature-video-rendered-fallback]',
	)).toHaveText('Rendered fallback active during editor playback');
}

async function assertFallbackPlayback(runtime, workflow) {
	await runtime.editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(runtime.editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	if (workflow.kind === 'audio') {
		await expect.poll(() => runtime.page.evaluate(
			() => globalThis.__scapeFallbackReturnScheduledAudio.length,
		)).toBeGreaterThan(0);
		const scheduled = await runtime.page.evaluate(
			() => globalThis.__scapeFallbackReturnScheduledAudio.at(-1),
		);
		expect(scheduled.channelCount).toBe(2);
		expect(scheduled.frameCount).toBeGreaterThan(0);
		expect(scheduled.channelPeaks[0]).toBeGreaterThan(0.09);
		expect(scheduled.channelPeaks[0]).toBeLessThan(0.11);
		expect(scheduled.channelPeaks[1]).toBeGreaterThan(0.69);
		expect(scheduled.channelPeaks[1]).toBeLessThan(0.71);
	}
	await runtime.editor.getByRole('button', { name: 'Stop', exact: true }).click();
}

async function openProductRuntime(browser, baseURL, productId) {
	const page = await browser.newPage({ baseURL, serviceWorkers: 'block' });
	await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		headers: { 'Access-Control-Allow-Origin': '*' },
		body: JSON.stringify({ schemaVersion: 1, locales: {} }),
	}));
	return { editor: await bootEditor(page, PRODUCT_PATHS[productId]), page };
}

async function exportScapeArchive(page, editor) {
	await page.evaluate(() => {
		globalThis.__scapeFallbackReturnSave = { chunks: [], closes: 0 };
		Object.defineProperty(globalThis, 'showSaveFilePicker', {
			configurable: true,
			value: async () => ({
				name: 'fallback-return.scape',
				async createWritable() {
					return {
						async write(chunk) { globalThis.__scapeFallbackReturnSave.chunks.push(chunk.slice()); },
						async close() { globalThis.__scapeFallbackReturnSave.closes += 1; },
						async abort() {},
					};
				},
			}),
		});
	});
	await chooseFileAction(page, editor, 'Export project file (.scape)');
	await expect.poll(
		() => page.evaluate(() => globalThis.__scapeFallbackReturnSave.closes),
		{ timeout: 30_000 },
	).toBe(1);
	const chunks = await page.evaluate(
		() => globalThis.__scapeFallbackReturnSave.chunks.map((chunk) => [...chunk]),
	);
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function openScapeArchive(editor, archive, name) {
	await editor.locator('[data-aup4-input]').setInputFiles({
		name,
		mimeType: SCAPE_MIME_TYPE,
		buffer: archive,
	});
}

async function renameFirstTrack(editor, name) {
	const closeVideoPreview = editor.getByRole('button', { name: 'Close: Video preview', exact: true });
	if (await closeVideoPreview.isVisible()) await closeVideoPreview.click();
	const label = trackNameText(editor).first();
	await label.dblclick();
	const input = editor.locator('[data-track-name] input');
	await expect(input).toBeFocused();
	await input.fill(name);
	await input.press('Enter');
	await expect(label).toHaveText(name);
}

function normalizeTrackNames(tracks, expectedTracks) {
	const expectedNames = new Map(expectedTracks.map(({ id, name }) => [id, name]));
	return tracks.map((track) => ({ ...track, name: expectedNames.get(track.id) }));
}

async function rewriteArchive(input, mutate) {
	const reader = new ZipReader(new BlobReader(new Blob([input])), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const payloads = new Map();
	for (const entry of entries) payloads.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
	await reader.close();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const project = JSON.parse(decoder.decode(payloads.get('project.json')));
	const manifest = JSON.parse(decoder.decode(payloads.get('manifest.json')));
	mutate({ project, manifest });
	const projectBytes = encoder.encode(JSON.stringify(project));
	payloads.set('project.json', projectBytes);
	manifest.project.schemaVersion = project.schemaVersion;
	manifest.project.size = projectBytes.byteLength;
	manifest.project.sha256 = createHash('sha256').update(projectBytes).digest('hex');
	payloads.set('manifest.json', encoder.encode(JSON.stringify(manifest)));
	const writer = new ZipWriter(new BlobWriter(SCAPE_MIME_TYPE), {
		level: 0,
		useWebWorkers: false,
		zip64: true,
	});
	for (const entry of entries) {
		await writer.add(entry.filename, new Uint8ArrayReader(payloads.get(entry.filename)), {
			level: 0,
			zip64: true,
		});
	}
	return Buffer.from(await (await writer.close(undefined, { zip64: true })).arrayBuffer());
}

async function inspectScapeArchive(archive) {
	const reader = new ZipReader(new BlobReader(new Blob([archive])), { useWebWorkers: false });
	try {
		const entries = new Map((await reader.getEntries()).map((entry) => [entry.filename, entry]));
		const project = JSON.parse(new TextDecoder().decode(await readZipEntry(entries, 'project.json')));
		const manifest = JSON.parse(new TextDecoder().decode(await readZipEntry(entries, 'manifest.json')));
		const assets = [];
		for (const asset of manifest.assets) {
			const body = await readZipEntry(entries, asset.entry);
			expect(body.byteLength).toBe(asset.size);
			expect(createHash('sha256').update(body).digest('hex')).toBe(asset.sha256);
			assets.push({
				kind: asset.kind,
				sha256: asset.sha256,
				size: asset.size,
				sourceId: asset.sourceId,
			});
		}
		return { project, assets: assets.sort((left, right) => left.sourceId.localeCompare(right.sourceId)) };
	} finally {
		await reader.close();
	}
}

async function readZipEntry(entries, name) {
	const entry = entries.get(name);
	if (!entry || entry.directory) throw new Error(`Missing Scape archive entry ${name}.`);
	return entry.getData(new Uint8ArrayWriter());
}

async function installAudioScheduleProbe(page) {
	await page.evaluate(() => {
		globalThis.__scapeFallbackReturnScheduledAudio = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function captureScheduledFallback(...args) {
			const buffer = this.buffer;
			if (buffer) {
				globalThis.__scapeFallbackReturnScheduledAudio.push({
					channelCount: buffer.numberOfChannels,
					frameCount: buffer.length,
					channelPeaks: Array.from({ length: buffer.numberOfChannels }, (_value, channel) => {
						let peak = 0;
						for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
						return peak;
					}),
				});
			}
			return start.apply(this, args);
		};
	});
}

async function createGeneratedVideoFixture(page, name) {
	const base64 = await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 54;
		const drawing = canvas.getContext('2d');
		const stream = canvas.captureStream(15);
		const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
			? 'video/webm;codecs=vp8'
			: 'video/webm';
		const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 120_000 });
		const chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size) chunks.push(event.data);
		});
		const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
		recorder.start();
		for (let frame = 0; frame < 8; frame += 1) {
			drawing.fillStyle = '#1d4ed8';
			drawing.fillRect(0, 0, canvas.width, canvas.height);
			drawing.fillStyle = '#fbbf24';
			drawing.fillRect(frame * 10, 20, 18, 14);
			await new Promise((resolve) => setTimeout(resolve, 65));
		}
		recorder.stop();
		await stopped;
		stream.getTracks().forEach((track) => track.stop());
		const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	});
	return { name, mimeType: 'video/webm', buffer: Buffer.from(base64, 'base64') };
}
