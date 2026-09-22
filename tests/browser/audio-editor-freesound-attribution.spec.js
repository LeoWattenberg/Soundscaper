import {
	expect,
	readFile,
	test,
} from './audio-editor-test-fixtures.js';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import { createRiffId3Chunk } from '../../src/common/editor/id3-metadata.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseExportProjectFileAction,
	disableNativeSavePicker,
	downloadBytes,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const SOUND = Object.freeze({
	id: 314159,
	name: 'Harbor ambience with gulls, boats, evening wind in the rigging, distant waves, and harbor traffic recorded from the north pier.wav',
	pageUrl: 'https://freesound.org/s/314159/',
	creator: Object.freeze({
		username: 'field-recorder',
		pageUrl: 'https://freesound.org/people/field-recorder/',
	}),
	description: 'Waves and distant rigging recorded beside a harbor.',
	tags: Object.freeze(['harbor', 'waves']),
	category: null,
	subcategory: null,
	createdAt: '2026-01-02T03:04:05Z',
	license: Object.freeze({
		code: 'cc-by',
		name: 'Attribution 4.0',
		url: 'https://creativecommons.org/licenses/by/4.0/',
		requiresAttribution: true,
		commercialUseAllowed: true,
	}),
	generativeAiPreference: null,
	explicit: false,
	durationSeconds: 0.8,
	originalFile: Object.freeze({
		format: 'wav',
		channels: 2,
		byteLength: 153_644,
		sampleRate: 48_000,
		md5: '0123456789abcdef0123456789abcdef',
	}),
	statistics: Object.freeze({
		downloads: 42,
		averageRating: 4.75,
		ratingCount: 8,
	}),
	preview: Object.freeze({
		available: true,
		format: 'ogg',
		quality: 'high',
		approximateBitrateKbps: 192,
	}),
	waveform: Object.freeze({
		available: true,
		url: '/api/freesound/sounds/314159/waveform?asset=789&source=cdn',
	}),
});

const PREVIEW_FRAME_COUNT = 38_400;
const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const LOCAL_SOUND = Object.freeze({
	name: 'harbor-master.wav',
	clipTitle: 'harbor-master',
	title: 'Harbor master',
	artist: 'Local recordist',
	location: 'North pier',
});
let previewFixturePromise;

test.describe('Freesound discovery and attribution', () => {
	registerAudioEditorHooks();

	test('previews and drops a result, preserves local metadata, and round-trips attribution', async ({ browser, page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const requests = await mockFreesoundApi(page);
		const editor = await bootEditor(page, '/embed/en/');
		const freesoundPanel = editor.locator('[data-workspace-panel="freesound"]');

		await expect(freesoundPanel).toHaveCount(0);
		const panelsMenu = await openNestedCommandMenu(page, editor, 'View', ['Panels']);
		const freesoundItem = getMenuItem(panelsMenu, 'Freesound');
		await expect(freesoundItem).toBeVisible();
		await freesoundItem.press('Enter');
		await expect(freesoundPanel).toBeVisible();

		await freesoundPanel.getByRole('searchbox', { name: 'Search Freesound', exact: true }).fill('harbor');
		await freesoundPanel.getByRole('button', { name: 'Search', exact: true }).click();
		const results = freesoundPanel.getByRole('list', { name: 'Freesound results', exact: true });
		await expect(results).toBeVisible();
		await expect(freesoundPanel.getByText('1 sounds', { exact: true })).toBeVisible();
		const result = results.getByRole('listitem');
		await expect(result.getByRole('link', { name: SOUND.name, exact: true })).toHaveAttribute('href', SOUND.pageUrl);
		await expect(result.getByRole('link', { name: SOUND.creator.username, exact: true }))
			.toHaveAttribute('href', SOUND.creator.pageUrl);
		await expect(result.getByRole('link', { name: SOUND.license.name, exact: true }))
			.toHaveAttribute('href', SOUND.license.url);
		const waveform = result.locator('.kw-audio-editor__freesound-waveform img');
		await expect(waveform).toHaveAttribute('src',
			new RegExp(`/api/freesound/sounds/${String(SOUND.id)}/waveform\\?asset=789&source=cdn$`, 'u'));
		await expect.poll(() => waveform.evaluate((image) => image.complete && image.naturalWidth > 0))
			.toBe(true);
		const resultLayout = await result.evaluate((element) => {
			const name = element.querySelector('.kw-audio-editor__freesound-result-name');
			const metadata = element.querySelector('.kw-audio-editor__freesound-result-meta');
			const previewRow = element.querySelector('.kw-audio-editor__freesound-result-preview');
			const playButton = previewRow.querySelector('.kw-audio-editor__freesound-preview-button');
			const waveformContainer = previewRow.querySelector('.kw-audio-editor__freesound-waveform');
			const actions = element.querySelector('.kw-audio-editor__freesound-result-actions');
			const license = actions.querySelector('.kw-audio-editor__freesound-result-license');
			const insertButton = [...actions.querySelectorAll('button')].find((button) =>
				button.textContent.includes('Insert at playhead'));
			const binButton = [...actions.querySelectorAll('button')].find((button) =>
				button.textContent.includes('Add to Project Bin'));
			const previewBounds = previewRow.getBoundingClientRect();
			const playBounds = playButton.getBoundingClientRect();
			const waveformBounds = waveformContainer.getBoundingClientRect();
			const actionsBounds = actions.getBoundingClientRect();
			const licenseBounds = license.getBoundingClientRect();
			return {
				resultOverflow: element.scrollWidth > element.clientWidth,
				metadataOverflow: metadata.scrollWidth > metadata.clientWidth,
				nameTruncated: name.scrollWidth > name.clientWidth,
				metadataHeight: metadata.getBoundingClientRect().height,
				playLeftOfWaveform: playBounds.right <= waveformBounds.left,
				playAndWaveformShareRow: playBounds.top < waveformBounds.bottom
					&& waveformBounds.top < playBounds.bottom,
				actionsBelowWaveform: actionsBounds.top >= previewBounds.bottom - 1,
				licenseSharesInsertRow: licenseBounds.top < insertButton.getBoundingClientRect().bottom
					&& insertButton.getBoundingClientRect().top < licenseBounds.bottom,
				licenseBeforeInsertButtons: license.compareDocumentPosition(insertButton)
					=== Node.DOCUMENT_POSITION_FOLLOWING,
				insertBeforeBin: insertButton.compareDocumentPosition(binButton)
					=== Node.DOCUMENT_POSITION_FOLLOWING,
			};
		});
		expect(resultLayout).toMatchObject({
			resultOverflow: false,
			metadataOverflow: false,
			nameTruncated: true,
			playLeftOfWaveform: true,
			playAndWaveformShareRow: true,
			actionsBelowWaveform: true,
			licenseSharesInsertRow: true,
			licenseBeforeInsertButtons: true,
			insertBeforeBin: true,
		});
		expect(resultLayout.metadataHeight).toBeLessThan(25);
		expect(requests[0]).toMatchObject({
			pathname: '/api/freesound/search',
			query: 'harbor',
			page: '1',
			license: 'all',
			sort: 'relevance',
		});

		await result.getByRole('button', { name: `Play preview: ${SOUND.name}` }).click();
		await expect.poll(() => requests.filter(({ pathname }) => (
			pathname === `/api/freesound/sounds/${String(SOUND.id)}/preview`
		)).length).toBeGreaterThan(0);

		const lane = editor.locator('.audio-editor-track-lane[data-track-lane]').first();
		const laneBounds = await lane.boundingBox();
		expect(laneBounds).not.toBeNull();
		const dropPosition = {
			x: laneBounds.x + Math.min(180, laneBounds.width - 24),
			y: laneBounds.y + laneBounds.height / 2,
		};
		const transfer = await page.evaluateHandle(() => new DataTransfer());
		await result.dispatchEvent('dragstart', { dataTransfer: transfer });
		await lane.dispatchEvent('dragover', {
			dataTransfer: transfer,
			clientX: dropPosition.x,
			clientY: dropPosition.y,
		});
		await lane.dispatchEvent('drop', {
			dataTransfer: transfer,
			clientX: dropPosition.x,
			clientY: dropPosition.y,
		});
		await result.dispatchEvent('dragend', { dataTransfer: transfer });
		await transfer.dispose();
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		expect(requests.map(({ pathname }) => pathname)).toEqual(expect.arrayContaining([
			`/api/freesound/sounds/${String(SOUND.id)}`,
			`/api/freesound/sounds/${String(SOUND.id)}/preview`,
		]));

		await importFiles(editor, [localMetadataWav()]);
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 20_000 });

		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const metadataPanel = editor.locator('[data-workspace-panel="metadata"]');
		await expect(metadataPanel).toBeVisible();
		await metadataPanel.getByRole('tab', { name: 'Attribution', exact: true }).click();
		const attribution = metadataPanel.getByRole('tabpanel', { name: 'Attribution', exact: true });
		await expect(attribution).toBeVisible();
		const freesoundOccurrence = attribution.locator('.kw-audio-editor__attribution-occurrence')
			.filter({ has: page.getByRole('heading', { name: SOUND.name, exact: true }) });
		await expect(freesoundOccurrence).toBeVisible();
		await expect(freesoundOccurrence.getByText('Current use', { exact: true })).toBeVisible();
		const currentUse = freesoundOccurrence.getByText(
			/^\d{2}:\d{2}:\d{2}\.\d{3}–\d{2}:\d{2}:\d{2}\.\d{3}$/u,
		);
		await expect(currentUse).toBeVisible();
		const currentUseCsv = String(await currentUse.textContent())
			.split('–')
			.map((value) => `"${value}"`)
			.join(',');
		await expect(freesoundOccurrence.getByRole('link', { name: SOUND.name, exact: true }))
			.toHaveAttribute('href', SOUND.pageUrl);
		await expect(freesoundOccurrence.getByRole('link', { name: SOUND.creator.username, exact: true }))
			.toHaveAttribute('href', SOUND.creator.pageUrl);
		await expect(freesoundOccurrence.getByRole('link', { name: SOUND.license.name, exact: true }))
			.toHaveAttribute('href', SOUND.license.url);

		const localOccurrence = attribution.locator('.kw-audio-editor__attribution-occurrence')
			.filter({ has: page.getByRole('heading', { name: LOCAL_SOUND.clipTitle, exact: true }) });
		await expect(localOccurrence).toBeVisible();
		await localOccurrence.getByText('Imported metadata', { exact: true }).click();
		await expect(metadataField(page, localOccurrence, 'normalized.title'))
			.toContainText(LOCAL_SOUND.title);
		await expect(metadataField(page, localOccurrence, 'normalized.artist'))
			.toContainText(LOCAL_SOUND.artist);
		await expect(metadataField(page, localOccurrence, 'raw.TXXX.location'))
			.toContainText(LOCAL_SOUND.location);

		const downloadPromise = page.waitForEvent('download');
		await attribution.getByRole('button', { name: 'Export CSV', exact: true }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/-attribution\.csv$/u);
		const csv = new TextDecoder().decode(await downloadBytes(download));
		expect(csv).toContain('"project_source_id","source_name","source_kind"');
		expect(csv).toContain(`${SOUND.name}.ogg`);
		expect(csv).toContain(SOUND.creator.username);
		expect(csv).toContain(SOUND.license.name);
		expect(csv).toContain(currentUseCsv);
		expect(csv).toContain(LOCAL_SOUND.name);
		expect(csv).toContain(LOCAL_SOUND.artist);
		expect(csv).toContain(LOCAL_SOUND.location);

		const archivePromise = page.waitForEvent('download');
		await chooseExportProjectFileAction(page, editor);
		const archiveDownload = await archivePromise;
		const archive = await downloadBytes(archiveDownload);
		await archiveDownload.delete();
		const reopenedPage = await browser.newPage({
			baseURL: new URL(page.url()).origin,
			serviceWorkers: 'block',
		});
		try {
			const reopenedEditor = await bootEditor(reopenedPage, '/embed/en/');
			await reopenedEditor.locator('[data-aup4-input]').setInputFiles({
				name: 'attribution-roundtrip.sscape',
				mimeType: SCAPE_MIME_TYPE,
				buffer: Buffer.from(archive),
			});
			await expect(reopenedEditor).toHaveAttribute('data-clip-count', '2', { timeout: 20_000 });
			await chooseCommandAction(reopenedPage, reopenedEditor, 'Edit', 'Metadata editor');
			const reopenedMetadata = reopenedEditor.locator('[data-workspace-panel="metadata"]');
			await reopenedMetadata.getByRole('tab', { name: 'Attribution', exact: true }).click();
			const reopenedAttribution = reopenedMetadata.getByRole('tabpanel', {
				name: 'Attribution', exact: true,
			});
			await expect(reopenedAttribution.getByRole('link', { name: SOUND.name, exact: true }))
				.toHaveAttribute('href', SOUND.pageUrl);
			const reopenedLocal = reopenedAttribution.locator('.kw-audio-editor__attribution-occurrence')
				.filter({ has: reopenedPage.getByRole('heading', { name: LOCAL_SOUND.clipTitle, exact: true }) });
			await reopenedLocal.getByText('Imported metadata', { exact: true }).click();
			await expect(metadataField(reopenedPage, reopenedLocal, 'normalized.artist'))
				.toContainText(LOCAL_SOUND.artist);
			await expect(metadataField(reopenedPage, reopenedLocal, 'raw.TXXX.location'))
				.toContainText(LOCAL_SOUND.location);
		} finally {
			await reopenedPage.close({ runBeforeUnload: false });
		}
	});
});

function localMetadataWav() {
	const frameCount = 4_800;
	const channelCount = 1;
	const sampleRate = 48_000;
	const dataByteLength = frameCount * 2;
	const buffer = Buffer.alloc(44 + dataByteLength);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataByteLength, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channelCount, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * channelCount * 2, 28);
	buffer.writeUInt16LE(channelCount * 2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataByteLength, 40);
	for (let frame = 0; frame < frameCount; frame += 1) {
		const sample = Math.sin(2 * Math.PI * 220 * frame / sampleRate) * 0.2;
		buffer.writeInt16LE(Math.round(sample * 32767), 44 + frame * 2);
	}
	const metadata = createRiffId3Chunk({
		title: LOCAL_SOUND.title,
		artist: LOCAL_SOUND.artist,
		location: LOCAL_SOUND.location,
	});
	const tagged = Buffer.concat([buffer, Buffer.from(metadata)]);
	tagged.writeUInt32LE(tagged.byteLength - 8, 4);
	return { name: LOCAL_SOUND.name, mimeType: 'audio/wav', buffer: tagged };
}

function metadataField(page, occurrence, key) {
	return occurrence.locator('.kw-audio-editor__attribution-metadata > div')
		.filter({ has: page.getByText(key, { exact: true }) });
}

async function mockFreesoundApi(page) {
	const requests = [];
	const preview = await oggPreviewFixture();
	await page.route('**/api/freesound/**', async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		requests.push({
			pathname: url.pathname,
			query: url.searchParams.get('q'),
			page: url.searchParams.get('page'),
			license: url.searchParams.get('license'),
			sort: url.searchParams.get('sort'),
		});
		if (url.pathname === '/api/freesound/search') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					data: {
						query: url.searchParams.get('q'),
						page: 1,
						pageSize: 20,
						totalCount: 1,
						totalPages: 1,
						hasNextPage: false,
						hasPreviousPage: false,
						results: [SOUND],
					},
				}),
			});
			return;
		}
		if (url.pathname === `/api/freesound/sounds/${String(SOUND.id)}`) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ data: SOUND }),
			});
			return;
		}
		if (url.pathname === `/api/freesound/sounds/${String(SOUND.id)}/preview`) {
			await route.fulfill({
				status: 200,
				contentType: 'audio/ogg',
				headers: { 'Content-Length': String(preview.byteLength) },
				body: Buffer.from(preview),
			});
			return;
		}
		if (url.pathname === `/api/freesound/sounds/${String(SOUND.id)}/waveform`) {
			await route.fulfill({
				status: 200,
				contentType: 'image/png',
				body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNo+A8AAgIBgG5WixMAAAAASUVORK5CYII=', 'base64'),
			});
			return;
		}
		await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
	});
	return requests;
}

function oggPreviewFixture() {
	previewFixturePromise ??= (async () => {
		const pcm = new Float32Array(PREVIEW_FRAME_COUNT * 2);
		for (let frame = 0; frame < PREVIEW_FRAME_COUNT; frame += 1) {
			pcm[frame * 2] = Math.sin(2 * Math.PI * 330 * frame / 48_000) * 0.25;
			pcm[frame * 2 + 1] = Math.sin(2 * Math.PI * 330 * frame / 48_000 + Math.PI / 3) * 0.15;
		}
		return encodeDedicatedAudioPcm({
			format: 'ogg-vorbis',
			input: new Uint8Array(pcm.buffer),
			frameCount: PREVIEW_FRAME_COUNT,
			channelCount: 2,
			sampleRate: 48_000,
			settings: { quality: 4 },
			maximumOutputBytes: 1024 * 1024,
		}, { loadPayload: async (_format, url) => readFile(url) });
	})();
	return previewFixturePromise;
}
