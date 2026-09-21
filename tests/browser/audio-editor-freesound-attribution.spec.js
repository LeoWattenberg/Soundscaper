import {
	expect,
	readFile,
	test,
} from './audio-editor-test-fixtures.js';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';
import {
	bootEditor,
	chooseCommandAction,
	downloadBytes,
	getMenuItem,
	openNestedCommandMenu,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const SOUND = Object.freeze({
	id: 314159,
	name: 'Harbor ambience',
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
});

const PREVIEW_FRAME_COUNT = 38_400;
let previewFixturePromise;

test.describe('Freesound discovery and attribution', () => {
	registerAudioEditorHooks();

	test('opens from the Panels menu, imports a result, and exports its current-use attribution', async ({ page }) => {
		test.setTimeout(60_000);
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
		expect(requests[0]).toMatchObject({
			pathname: '/api/freesound/search',
			query: 'harbor',
			page: '1',
			license: 'all',
			sort: 'relevance',
		});

		await result.getByRole('button', {
			name: /^Insert at playhead\s*:\s*Harbor ambience$/u,
		}).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		expect(requests.map(({ pathname }) => pathname)).toEqual([
			'/api/freesound/search',
			`/api/freesound/sounds/${String(SOUND.id)}`,
			`/api/freesound/sounds/${String(SOUND.id)}/preview`,
		]);

		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const metadataPanel = editor.locator('[data-workspace-panel="metadata"]');
		await expect(metadataPanel).toBeVisible();
		await metadataPanel.getByRole('tab', { name: 'Attribution', exact: true }).click();
		const attribution = metadataPanel.getByRole('tabpanel', { name: 'Attribution', exact: true });
		await expect(attribution).toBeVisible();
		await expect(attribution.getByRole('heading', { name: SOUND.name, exact: true })).toBeVisible();
		await expect(attribution.getByText('Current use', { exact: true })).toBeVisible();
		const currentUse = attribution.getByText(
			/^00:00:00\.000–00:00:00\.(?!000$)\d{3}$/u,
		);
		await expect(currentUse).toBeVisible();
		const currentUseCsv = String(await currentUse.textContent())
			.split('–')
			.map((value) => `"${value}"`)
			.join(',');
		await expect(attribution.getByRole('link', { name: SOUND.name, exact: true }))
			.toHaveAttribute('href', SOUND.pageUrl);
		await expect(attribution.getByRole('link', { name: SOUND.creator.username, exact: true }))
			.toHaveAttribute('href', SOUND.creator.pageUrl);
		await expect(attribution.getByRole('link', { name: SOUND.license.name, exact: true }))
			.toHaveAttribute('href', SOUND.license.url);

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
	});
});

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
