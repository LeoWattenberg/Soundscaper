import { createHash } from 'node:crypto';

import {
	BlobReader,
	BlobWriter,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createUnreportedVideoSourceCharacteristics } from '../../src/common/editor/video-source-characteristics.ts';
import { resolveRuntimeClipProjection } from '../../src/common/editor/runtime-clip-projection.ts';
import {
	FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE,
} from '../../src/framescaper/editor-project-runtime-profile-v19.ts';
import { validateFramescaperProjectV19 } from '../../src/framescaper/editor-project-v19-validation.ts';
import { validateSoundscaperProjectV21 } from '../../src/soundscaper/editor-project-v21-validation.ts';

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
} from './audio-editor-test-helpers.js';
import { hasMediaRecorderCapability } from './helpers/media-recorder-capability.js';
import { installPinnedFfmpegRuntimeRoutes } from './helpers/pinned-ffmpeg-runtime.js';
import { promoteFramescaperArchiveToSoundscaperV21 } from './helpers/scape-exact-project-fixtures.js';

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
	origin: 'framescaper',
	recipient: 'framescaper',
	kind: 'audio',
	role: 'project-audio-mix-v1',
	schemaVersion: 19,
}, {
	id: 'audio-track-render-web-roundtrip',
	origin: 'framescaper',
	recipient: 'framescaper',
	kind: 'audio',
	role: 'audio-track-render-v1',
	schemaVersion: 19,
}, {
	id: 'video-full-project-web-roundtrip',
	origin: 'soundscaper',
	recipient: 'soundscaper',
	kind: 'video',
	role: 'project-video-render-v1',
	schemaVersion: 21,
}, {
	id: 'video-clip-render-web-roundtrip',
	origin: 'soundscaper',
	recipient: 'soundscaper',
	kind: 'video',
	role: 'video-clip-render-v1',
	schemaVersion: 21,
}];

test.describe('exact-product rendered-fallback Scape return roundtrips', () => {
	registerAudioEditorHooks();

	for (const workflow of WORKFLOWS) {
		test(workflow.id, async ({ browser, page }) => {
			if (workflow.kind === 'video') test.skip(!await page.evaluate(hasMediaRecorderCapability), 'Generated WebM fixtures require MediaRecorder.');
			test.setTimeout(120_000);
			await installPinnedFfmpegRuntimeRoutes(page);
			const fixtureProduct = workflow.kind === 'video' ? 'framescaper' : workflow.origin;
			const origin = await bootEditor(page, PRODUCT_PATHS[fixtureProduct]);
			const originErrors = collectClientErrors(page);
			const base = workflow.kind === 'audio'
				? { archive: await createAudioBaseArchive(page, origin), fallback: null }
				: await createVideoBaseArchive(page, origin, workflow.id);
			const outboundArchive = await renderedFallbackArchive(base.archive, workflow, base.fallback);
			const outbound = await inspectScapeArchive(outboundArchive);
			expect(outbound.project.schemaVersion).toBe(workflow.schemaVersion);

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
				if (workflow.kind === 'audio') await installAudioScheduleProbe(home.page);
				await openScapeArchive(home.editor, returningArchive, `${workflow.id}-return.scape`);
				await acceptReadOnlyFallback(home, workflow, outbound.project.id);
				await assertFallbackPlayback(home, workflow);
				const returnedAgain = await inspectScapeArchive(
					await exportScapeArchive(home.page, home.editor),
				);
				expect(returnedAgain.project).toEqual(outbound.project);
				expect(returnedAgain.assets).toEqual(outbound.assets);

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
	const canonical = await createGeneratedVideoFixture(page, `${id}-canonical.webm`, {
		variant: 'canonical',
		withAudio: false,
	});
	const fallback = await createGeneratedVideoFixture(page, `${id}-fallback.webm`, {
		variant: 'fallback',
		withAudio: false,
	});
	await importFiles(editor, [canonical]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
		timeout: 10_000,
	});
	const v19Archive = await exportScapeArchive(page, editor);
	const archive = await promoteFramescaperArchiveToSoundscaperV21(v19Archive, {
		id: `${id}-base`,
		title: `${id} base`,
	}, rewriteArchive);
	return { archive, fallback };
}

async function renderedFallbackArchive(input, workflow, fallbackFixture) {
	return rewriteArchive(input, ({ project, manifest, payloads }) => {
		project.id = workflow.id;
		project.title = `${workflow.role} return witness`;
		project.opaqueExtensions = {
			...project.opaqueExtensions,
			publisherReturnWitness: { role: workflow.role, revision: 1 },
		};
		const sources = project.sources.filter(({ kind }) => kind === workflow.kind);
		let canonicalSource;
		let fallbackSource;
		let fallbackAsset;
		if (workflow.kind === 'video') {
			if (sources.length !== 1 || !fallbackFixture) {
				throw new Error(`${workflow.id} requires one canonical video and one silent fallback fixture.`);
			}
			[canonicalSource] = sources;
			const fallbackSourceId = `${canonicalSource.id}-fallback`;
			fallbackSource = {
				...structuredClone(canonicalSource),
				id: fallbackSourceId,
				storageKey: fallbackSourceId,
				name: fallbackFixture.name,
				mimeType: fallbackFixture.mimeType,
				audioCodec: null,
				hasAudio: false,
				// A silent render is different media: nothing probed it, so it
				// cannot inherit the canonical source's reported characteristics.
				characteristics: createUnreportedVideoSourceCharacteristics(),
				posterStorageKey: null,
				thumbnailStorageKey: null,
				timingAsset: null,
				timingDecision: {
					mode: 'conform-cfr-at-ingest',
					rate: structuredClone(canonicalSource.frameRate),
				},
			};
			const fallbackBytes = new Uint8Array(fallbackFixture.buffer);
			const entry = `media/${fallbackSourceId}/original`;
			if (payloads.has(entry)) throw new Error(`${workflow.id} fallback entry collides with the base archive.`);
			fallbackAsset = {
				sourceId: fallbackSourceId,
				kind: 'video',
				entry,
				encoding: 'original',
				mimeType: fallbackFixture.mimeType,
				size: fallbackBytes.byteLength,
				sha256: createHash('sha256').update(fallbackBytes).digest('hex'),
			};
			const canonicalAsset = manifest.assets.find(({ sourceId }) => sourceId === canonicalSource.id);
			if (!canonicalAsset || canonicalAsset.sha256 === fallbackAsset.sha256) {
				throw new Error(`${workflow.id} requires an independent silent video fallback asset.`);
			}
			fallbackSource.contentSha256 = fallbackAsset.sha256;
			project.sources.push(fallbackSource);
			manifest.assets.push(fallbackAsset);
			payloads.set(entry, fallbackBytes);
		} else {
			if (sources.length !== 2) throw new Error(`${workflow.id} requires exactly two audio sources.`);
			[canonicalSource, fallbackSource] = sources;
			fallbackAsset = manifest.assets.find(({ sourceId }) => sourceId === fallbackSource.id);
			if (!fallbackAsset) throw new Error(`${workflow.id} is missing its fallback asset.`);
		}
		const fallbackClipIds = new Set(project.clips
			.filter(({ sourceId }) => sourceId === fallbackSource.id)
			.map(({ id }) => id));
		project.clips = project.clips.filter(({ id }) => !fallbackClipIds.has(id));
		for (const track of project.tracks) {
			if (Array.isArray(track.clipIds)) {
				track.clipIds = track.clipIds.filter((id) => !fallbackClipIds.has(id));
			}
		}
		if (fallbackClipIds.size > 0) {
			const retainedLaneGroupIds = new Set(project.tracks
				.filter((track) => track.type !== 'label' && track.clipIds.length > 0)
				.map(({ laneGroupId }) => laneGroupId)
				.filter((laneGroupId) => typeof laneGroupId === 'string'));
			project.tracks = project.tracks.filter((track) => (
				track.type === 'label'
				|| track.clipIds.length > 0
				|| retainedLaneGroupIds.has(track.laneGroupId)
			));
		}
		const retainedTrackIds = new Set(project.tracks.map(({ id }) => id));
		for (const sequence of project.sequences) {
			sequence.trackIds = sequence.trackIds.filter((id) => retainedTrackIds.has(id));
			// V12 derives the sequence track order from its hierarchy, so pruned
			// tracks have to leave the node list as well.
			sequence.trackNodes = sequence.trackNodes.filter((node) => (
				node.kind !== 'track' || retainedTrackIds.has(node.id)
			));
		}
		const targetClip = project.clips.find(({ sourceId }) => sourceId === canonicalSource.id);
		const targetTrack = project.tracks.find(({ clipIds }) => clipIds?.includes(targetClip?.id));
		if (!targetClip || !targetTrack) throw new Error(`${workflow.id} is missing its canonical target.`);

		if (workflow.kind === 'audio') {
			project.sampleRate = fallbackSource.sampleRate;
			targetClip.durationFrames = fallbackSource.frameCount;
			targetTrack.effectsActive = true;
			targetTrack.effects = [structuredClone(AUDIO_EFFECT)];
		} else {
			const targetDurationFrames = resolveRuntimeClipProjection(project, targetClip).durationFrames;
			fallbackSource.sampleRate = canonicalSource.sampleRate;
			fallbackSource.sampleFrameCount = targetDurationFrames;
			fallbackSource.sourceFrameCount = targetClip.sourceFrameCount;
			delete fallbackSource.frameCount;
			fallbackSource.width = canonicalSource.width;
			fallbackSource.height = canonicalSource.height;
			fallbackSource.frameRate = canonicalSource.frameRate;
			fallbackSource.hasAudio = false;
			targetClip.videoEffects = [structuredClone(VIDEO_EFFECT)];
		}

		const retainedRequirements = project.featureRequirements.requirements.filter(({ featureId }) => (
			featureId !== FEATURE_IDS[workflow.kind]
		));
		project.featureRequirements = {
			schemaVersion: 2,
			requirements: [...retainedRequirements, {
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
		if (project.schemaVersion !== workflow.schemaVersion) {
			throw new Error(`${workflow.id} requires exact schema ${String(workflow.schemaVersion)}.`);
		}
		if (workflow.schemaVersion === 19) {
			validateFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, project);
		} else {
			validateSoundscaperProjectV21(project);
		}
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
	await installPinnedFfmpegRuntimeRoutes(page);
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
	mutate({ project, manifest, payloads });
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
	for (const [filename, payload] of payloads) {
		await writer.add(filename, new Uint8ArrayReader(payload), {
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

async function createGeneratedVideoFixture(page, name, {
	variant = 'canonical',
	withAudio = true,
} = {}) {
	const base64 = await page.evaluate(async ({ includeAudio, fixtureVariant }) => {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 54;
		const drawing = canvas.getContext('2d');
		const videoStream = canvas.captureStream(15);
		let audioContext = null;
		let oscillator = null;
		let stream = videoStream;
		if (includeAudio) {
			audioContext = new AudioContext({ sampleRate: 48_000 });
			oscillator = audioContext.createOscillator();
			const gain = audioContext.createGain();
			const audioDestination = audioContext.createMediaStreamDestination();
			oscillator.frequency.value = 330;
			gain.gain.value = 0.06;
			oscillator.connect(gain).connect(audioDestination);
			oscillator.start();
			await audioContext.resume();
			stream = new MediaStream([
				...videoStream.getVideoTracks(),
				...audioDestination.stream.getAudioTracks(),
			]);
		}
		if (stream.getVideoTracks().length !== 1
			|| stream.getAudioTracks().length !== (includeAudio ? 1 : 0)) {
			throw new Error('Generated video fixture has an unexpected media-track inventory.');
		}
		const mimeType = includeAudio && MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
			? 'video/webm;codecs=vp8,opus'
			: MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
				? 'video/webm;codecs=vp8'
				: 'video/webm';
		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: 120_000,
			...(includeAudio ? { audioBitsPerSecond: 32_000 } : {}),
		});
		const chunks = [];
		recorder.addEventListener('dataavailable', (event) => {
			if (event.data.size) chunks.push(event.data);
		});
		const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
		recorder.start();
		for (let frame = 0; frame < 8; frame += 1) {
			drawing.fillStyle = fixtureVariant === 'fallback' ? '#7c2d12' : '#1d4ed8';
			drawing.fillRect(0, 0, canvas.width, canvas.height);
			drawing.fillStyle = fixtureVariant === 'fallback' ? '#67e8f9' : '#fbbf24';
			drawing.fillRect(frame * 10, 20, 18, 14);
			await new Promise((resolve) => setTimeout(resolve, 65));
		}
		recorder.stop();
		await stopped;
		stream.getTracks().forEach((track) => track.stop());
		oscillator?.stop();
		if (audioContext) await audioContext.close();
		const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	}, { includeAudio: withAudio, fixtureVariant: variant });
	return { name, mimeType: 'video/webm', buffer: Buffer.from(base64, 'base64') };
}
