/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';

import {
	expect,
	test,
	toneA,
	TRANSLATIONS_ROOT,
} from './audio-editor-test-fixtures.js';
import {
	assertNoSeriousAxeViolations,
	bootEditor,
	chooseCommandAction,
	chooseFileAction,
	chooseNestedCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

const SCAPE_MIME_TYPE = 'application/vnd.soundscaper.scape+zip';
const ANNOTATION_CAPABILITY_ID = 'org.soundscaper.capability.timeline-annotations';

test.describe('native timeline annotations', () => {
	registerAudioEditorHooks(test);

	test('authors with pointer and keyboard, announces state, survives forced colors, and reopens', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Milestone 3 qualifies this surface in Chromium and Firefox.');
		test.setTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 1100 });
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		await expect(editor).toHaveAttribute('data-product', 'soundscaper');
		await expect(editor.locator('.audio-editor-timeline-panel')).toHaveAttribute('data-has-annotations', 'true');
		await expect(editor.getByRole('region', { name: 'Markers and named regions' })).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Markers']);
		await expect(editor.locator('[data-workspace-panel="markers"]')).toBeVisible();
		const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
		await expect(panel).toBeVisible();
		await expect(panel).toContainText('M: marker · R: region');
		await expect(panel.getByText('The primary sequence has no markers or regions yet.', { exact: true })).toBeVisible();

		await importFiles(editor, [toneA]);
		await panel.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
		let layer = editor.getByRole('listbox', { name: 'Markers and named regions', exact: true });
		await expect(layer).toBeVisible();
		await expect(layer).toHaveAttribute('aria-multiselectable', 'true');
		let options = layer.getByRole('option');
		await expect(options).toHaveCount(1);
		const marker = options.first();
		await expect(marker).toHaveAttribute('aria-label', /Unnamed annotation, Marker, \d+\.\d{3} s/u);
		await expect(marker).toHaveAttribute('aria-selected', 'true');
		await expect(marker).toHaveAttribute('aria-posinset', '1');
		await expect(marker).toHaveAttribute('aria-setsize', '1');
		await expect(panel.locator('[data-timeline-annotation]').first()).toBeFocused();

		// The docked panel announces its own creations; the ruler lane keeps the
		// announcement region that its keyboard shortcuts feed.
		const panelCreationStatus = editor.locator('[data-timeline-annotation-panel-create-status]');
		const creationStatus = editor.locator('[data-timeline-annotation-create-status]');
		for (const status of [panelCreationStatus, creationStatus]) {
			await expect(status).toHaveAttribute('role', 'status');
			await expect(status).toHaveAttribute('aria-live', 'polite');
			await expect(status).toHaveAttribute('aria-atomic', 'true');
		}
		await expect(panelCreationStatus).toHaveText(/Created Marker: Unnamed annotation, \d+\.\d{3} s/u);

		await marker.focus();
		await marker.press('Enter');
		const rename = editor.locator('.audio-editor-timeline-annotation__rename--overlay');
		await expect(rename).toBeFocused();
		await rename.fill('Pointer cue');
		await rename.press('Enter');
		await expect(marker).toHaveAttribute('aria-label', /Pointer cue, Marker/u);
		await expect(marker).toBeFocused();

		const ruler = editor.locator('[data-ruler-focus]').first();
		await ruler.scrollIntoViewIfNeeded();
		const rulerBounds = await ruler.boundingBox();
		expect(rulerBounds).not.toBeNull();
		await page.mouse.move(rulerBounds.x + 35, rulerBounds.y + 24);
		await page.mouse.down();
		await page.mouse.move(rulerBounds.x + 145, rulerBounds.y + 24, { steps: 5 });
		await page.mouse.up();
		await expect(panel.getByRole('button', { name: 'Add region from selection', exact: true })).toBeEnabled();

		await ruler.focus();
		await ruler.press('r');
		options = layer.getByRole('option');
		await expect(options).toHaveCount(2);
		const region = options.nth(1);
		await expect(region).toBeFocused();
		await expect(region).toHaveAttribute('aria-label', /Unnamed annotation, Region, \d+\.\d{3}–\d+\.\d{3} s/u);
		await expect(region).toHaveAttribute('aria-selected', 'true');
		await expect(region).toHaveAttribute('aria-posinset', '2');
		await expect(region).toHaveAttribute('aria-setsize', '2');
		await expect(creationStatus).toHaveText(/Created Region: Unnamed annotation, \d+\.\d{3}–\d+\.\d{3} s/u);

		const regionLabelBeforeMove = await region.getAttribute('aria-label');
		await region.press('Control+ArrowRight');
		await expect.poll(() => region.getAttribute('aria-label')).not.toBe(regionLabelBeforeMove);
		const regionLabelBeforeResize = await region.getAttribute('aria-label');
		const endHandle = region.locator('[data-annotation-edge="end"]');
		const endHandleBounds = await endHandle.boundingBox();
		expect(endHandleBounds).not.toBeNull();
		await page.mouse.move(
			endHandleBounds.x + endHandleBounds.width / 2,
			endHandleBounds.y + endHandleBounds.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			endHandleBounds.x + endHandleBounds.width / 2 + 32,
			endHandleBounds.y + endHandleBounds.height / 2,
			{ steps: 4 },
		);
		await page.mouse.up();
		await expect.poll(() => region.getAttribute('aria-label')).not.toBe(regionLabelBeforeResize);

		await marker.click({ modifiers: ['Shift'] });
		await expect(marker).toHaveAttribute('aria-selected', 'true');
		await expect(region).toHaveAttribute('aria-selected', 'true');
		// The ruler-corner actions stay hidden until Show markers is enabled, from
		// either the Add Track flyout or the View menu.
		const laneActions = editor.locator('[data-timeline-annotation-create-actions]');
		await expect(laneActions).toHaveCount(0);
		await editor.getByRole('button', { name: 'Add track', exact: true }).click();
		const markerToggle = editor.locator('[data-show-markers-toggle]');
		await expect(markerToggle).not.toBeChecked();
		await markerToggle.check();
		await expect(laneActions).toBeVisible();
		await chooseCommandAction(page, editor, 'View', 'Show markers');
		await expect(laneActions).toHaveCount(0);
		await chooseCommandAction(page, editor, 'View', 'Show markers');
		await expect(laneActions).toBeVisible();

		const laneStatus = editor.locator('[data-timeline-annotation-create-actions] + [role="status"]');
		await laneActions.getByRole('button', { name: 'Batch selected annotations', exact: true }).click();
		await expect(laneStatus).toHaveText('Batched 2 annotation(s)');
		await laneActions.getByRole('button', { name: 'Remove selected annotations from batch', exact: true }).click();
		await expect(laneStatus).toHaveText('Removed 2 annotation(s) from batch');
		await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
		await assertNoSeriousAxeViolations(page, '[data-timeline-annotation-panel]');
		await assertNoSeriousAxeViolations(page, '[data-timeline-annotation-layer]');

		if (browserName === 'chromium') {
			await page.emulateMedia({ forcedColors: 'active' });
			await expect(region).toHaveCSS('forced-color-adjust', 'none');
			await expect(region).toHaveCSS('border-top-width', '2px');
			await page.emulateMedia({ forcedColors: 'none' });
		}

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		layer = editor.getByRole('listbox', { name: 'Markers and named regions', exact: true });
		await expect(layer.getByRole('option')).toHaveCount(2);
		await expect(layer.getByRole('option', { name: /Pointer cue, Marker/u })).toBeVisible();
		await expect(layer.getByRole('option', { name: /Unnamed annotation, Region/u })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('keeps Framescaper unavailable and preserves annotations through a read-only Scape handoff', async ({ browser, page, browserName }) => {
		test.skip(browserName === 'webkit', 'Milestone 3 qualifies this boundary in Chromium and Firefox.');
		test.setTimeout(90_000);
		const originErrors = collectClientErrors(page);
		const origin = await bootEditor(page, '/embed/en/');
		await importFiles(origin, [toneA]);
		await chooseNestedCommandAction(page, origin, 'View', ['Panels', 'Markers']);
		const originPanel = origin.getByRole('region', { name: 'Markers and named regions', exact: true });
		await originPanel.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
		const originMarker = origin.getByRole('listbox', { name: 'Markers and named regions', exact: true })
			.getByRole('option');
		await expect(originMarker).toHaveCount(1);
		await originMarker.focus();
		await originMarker.press('Enter');
		const rename = origin.locator('.audio-editor-timeline-annotation__rename--overlay');
		await rename.fill('Cross-product cue');
		await rename.press('Enter');
		await expect(origin.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
		const projectId = await origin.getAttribute('data-project-id');
		const outbound = await captureScapeArchive(page, origin);
		const baseURL = new URL(page.url()).origin;
		const openedPages = [];
		try {
			const framesPage = await browser.newPage({ baseURL, serviceWorkers: 'block' });
			openedPages.push(framesPage);
			await routeTranslations(framesPage);
			const frameErrors = collectClientErrors(framesPage);
			const framescaper = await bootEditor(framesPage, '/framescaper/embed/en/');
			await openScapeArchive(framescaper, outbound, 'timeline-annotations.scape');
			const decision = framesPage.getByRole('dialog', { name: 'Project features unavailable', exact: true });
			await expect(decision).toHaveAttribute('data-scape-open-decision', 'compatibility');
			await expect(decision).toContainText('Timeline markers and regions');
			await expect(decision).toContainText(ANNOTATION_CAPABILITY_ID);
			await expect(decision).toContainText(/Unavailable.*Bypass declared/isu);
			await decision.getByRole('button', { name: 'Open read-only', exact: true }).click();
			await expect(framescaper).toHaveAttribute('data-product', 'framescaper');
			await expect(framescaper).toHaveAttribute('data-project-id', projectId);
			await expect(framescaper).toHaveAttribute('data-edit-block-reason', 'read-only');
			await expect(framescaper.getByRole('region', { name: 'Markers and named regions' })).toHaveCount(0);
			await expect(framescaper.getByRole('listbox', { name: 'Markers and named regions' })).toHaveCount(0);
			const notice = framescaper.locator(`[data-project-feature-requirement="${ANNOTATION_CAPABILITY_ID}"]`);
			await expect(notice).toContainText('Timeline markers and regions');
			await expect(notice).toHaveAttribute('data-declared-disposition', 'bypass');
			await expect(notice).toHaveAttribute('data-effective-disposition', 'bypassed');

			const returned = await captureScapeArchive(framesPage, framescaper);
			const homePage = await browser.newPage({ baseURL, serviceWorkers: 'block' });
			openedPages.push(homePage);
			await routeTranslations(homePage);
			const homeErrors = collectClientErrors(homePage);
			const home = await bootEditor(homePage, '/embed/en/');
			await openScapeArchive(home, returned, 'timeline-annotations-return.scape');
			await expect(home).toHaveAttribute('data-project-id', projectId, { timeout: 20_000 });
			await expect(home).not.toHaveAttribute('data-edit-block-reason', /.+/u);
			await expect(home.locator('[data-project-feature-compatibility]')).toHaveCount(0);
			const returnedLayer = home.getByRole('listbox', { name: 'Markers and named regions', exact: true });
			await expect(returnedLayer.getByRole('option')).toHaveCount(1);
			await expect(returnedLayer.getByRole('option', { name: /Cross-product cue, Marker/u })).toBeVisible();
			expect(frameErrors).toEqual([]);
			expect(homeErrors).toEqual([]);
		} finally {
			for (const openedPage of openedPages.reverse()) {
				if (!openedPage.isClosed()) await openedPage.close({ runBeforeUnload: false });
			}
		}
		expect(originErrors).toEqual([]);
	});

	test('keeps ruler-corner actions outside both right-edge resize hit targets', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Milestone 3 qualifies this surface in Chromium and Firefox.');
		const [timelineCss, annotationCss] = await Promise.all([
			readFile(new URL('../../src/common/editor/ui/audio-editor-design-system/07-timeline-tracks.css', import.meta.url), 'utf8'),
			readFile(new URL('../../src/common/editor/ui/audio-editor-design-system/19-timeline-annotations.css', import.meta.url), 'utf8'),
		]);
		await page.setContent(`
			<style>${timelineCss}\n${annotationCss}</style>
			<div id="kw-audio-editor-design-system">
				<section class="audio-editor-timeline-panel" data-has-annotations="true" style="width:660px">
					<div class="audio-editor-ruler-row" style="width:660px">
						<div class="audio-editor-ruler-corner" style="width:160px">
							<span>Tracks</span><button class="button">Add track</button>
							<div class="audio-editor-timeline-annotation-lane-actions" data-actions>
								<button>+M</button><button>+R</button><button>B</button><button>⇧B</button>
							</div>
						</div>
						<div class="audio-editor-ruler-viewport" data-viewport style="width:500px">
							<canvas class="timeline-ruler" data-live-ruler style="width:500px;height:33px"></canvas>
							<div class="audio-editor-timeline-annotations" style="width:500px">
								<div class="audio-editor-timeline-annotation audio-editor-timeline-annotation--region"
									style="left:435px;width:60px">
									<span class="audio-editor-timeline-annotation__handle" data-annotation-edge="start"></span>
									<span class="audio-editor-timeline-annotation__handle" data-annotation-edge="end"></span>
								</div>
							</div>
						</div>
					</div>
				</section>
			</div>
		`);
		const actions = await page.locator('[data-actions]').boundingBox();
		const viewport = await page.locator('[data-viewport]').boundingBox();
		const ruler = await page.locator('[data-live-ruler]').boundingBox();
		const lane = await page.locator('.audio-editor-timeline-annotations').boundingBox();
		expect(actions).not.toBeNull();
		expect(viewport).not.toBeNull();
		expect(ruler).not.toBeNull();
		expect(lane).not.toBeNull();
		expect(actions.x + actions.width).toBeLessThanOrEqual(viewport.x);
		expect(ruler.height).toBe(33);
		expect(ruler.y + ruler.height).toBeLessThanOrEqual(lane.y);
		for (const edge of ['start', 'end']) {
			const handle = await page.locator(`[data-annotation-edge="${edge}"]`).boundingBox();
			expect(handle).not.toBeNull();
			const hit = await page.evaluate(({ x, y }) => (
				document.elementFromPoint(x, y)?.getAttribute('data-annotation-edge')
			), { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 });
			expect(hit).toBe(edge);
		}
	});
});

async function captureScapeArchive(page, editor) {
	await page.evaluate(() => Object.defineProperty(globalThis, 'showSaveFilePicker', {
		configurable: true,
		value: undefined,
	}));
	const downloading = page.waitForEvent('download');
	await chooseFileAction(page, editor, 'Export project file (.scape)');
	const download = await downloading;
	const path = await download.path();
	expect(path).toBeTruthy();
	const archive = await readFile(path);
	await download.delete();
	return archive;
}

async function openScapeArchive(editor, archive, name) {
	await editor.locator('[data-aup4-input]').setInputFiles({
		name,
		mimeType: SCAPE_MIME_TYPE,
		buffer: archive,
	});
}

async function routeTranslations(page) {
	await page.route(`${TRANSLATIONS_ROOT}/**`, (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		headers: { 'Access-Control-Allow-Origin': '*' },
		body: JSON.stringify({ schemaVersion: 1, locales: {} }),
	}));
}
