/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

import {
	cycleTimelineAnnotationHitId,
	timelineAnnotationCreationAnnouncement,
} from '../../src/common/editor/ui/timeline/timeline-annotation-ui-model.ts';
import { focusCreatedTimelineAnnotation } from '../../src/common/editor/ui/timeline/useTimelineAnnotationCreateFeedback.js';

import {
	bootEditor,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('timeline annotation capability boundary', () => {
	registerAudioEditorHooks(test);

	test('keeps the complete native surface unavailable before the product activation commit', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Milestone 3 qualifies this surface in Chromium and Firefox.');
		const editor = await bootEditor(page, '/embed/en/');
		await expect(editor).toHaveAttribute('data-product', 'soundscaper');
		await expect(editor.getByRole('listbox', { name: 'Markers and named regions' })).toHaveCount(0);
		await expect(editor.getByRole('region', { name: 'Markers and named regions' })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Add marker at playhead' })).toHaveCount(0);

		const ruler = editor.locator('[data-ruler-focus]').first();
		await ruler.focus();
		await ruler.press('m');
		await expect(editor.getByRole('listbox', { name: 'Markers and named regions' })).toHaveCount(0);
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

	test('cycles overlapping body rename and both resize-edge pointer targets', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Milestone 3 qualifies this surface in Chromium and Firefox.');
		const annotationCss = await readFile(new URL(
			'../../src/common/editor/ui/audio-editor-design-system/19-timeline-annotations.css', import.meta.url,
		), 'utf8');
		await page.exposeFunction('cycleAnnotationHit', cycleTimelineAnnotationHitId);
		await page.setContent(`
			<style>${annotationCss}</style>
			<div id="kw-audio-editor-design-system">
				<div data-stack style="position:relative;width:500px;height:33px">
					<div class="audio-editor-timeline-annotation audio-editor-timeline-annotation--region"
						data-annotation-id="first" style="left:100px;width:60px">
						<span class="audio-editor-timeline-annotation__handle" data-annotation-edge="start"></span>
						<span class="audio-editor-timeline-annotation__handle" data-annotation-edge="end"></span>
					</div>
					<div class="audio-editor-timeline-annotation audio-editor-timeline-annotation--region"
						data-annotation-id="second" style="left:100px;width:60px">
						<span class="audio-editor-timeline-annotation__handle" data-annotation-edge="start"></span>
						<span class="audio-editor-timeline-annotation__handle" data-annotation-edge="end"></span>
					</div>
				</div>
			<script>
				const stack = document.querySelector('[data-stack]');
				let cycle = { signature: null, id: null };
				let pending = Promise.resolve();
				stack.addEventListener('pointerdown', (event) => {
					const edge = event.target.getAttribute('data-annotation-edge') || 'body';
					const eventTargetId = event.target.closest('[data-annotation-id]').getAttribute('data-annotation-id');
					pending = pending.then(async () => {
						const previous = cycle.signature === edge ? cycle.id : null;
						const id = await window.cycleAnnotationHit(['first', 'second'], eventTargetId, previous);
						cycle = { signature: edge, id };
						document.body.dataset.pointerTarget = id;
						document.body.dataset.pointerEdge = edge;
					});
				});
				stack.addEventListener('dblclick', () => {
					pending = pending.then(() => { document.body.dataset.renameTarget = cycle.id; });
				});
			</script>
		`);
		const topRegion = await page.locator('[data-annotation-id="second"]').boundingBox();
		expect(topRegion).not.toBeNull();
		await page.mouse.dblclick(topRegion.x + topRegion.width / 2, topRegion.y + topRegion.height / 2);
		await expect(page.locator('body')).toHaveAttribute('data-rename-target', 'first');
		for (const edge of ['start', 'end']) {
			const handle = await page.locator(`[data-annotation-id="second"] [data-annotation-edge="${edge}"]`).boundingBox();
			expect(handle).not.toBeNull();
			const x = handle.x + handle.width / 2;
			const y = handle.y + handle.height / 2;
			await page.mouse.click(x, y);
			await expect(page.locator('body')).toHaveAttribute('data-pointer-target', 'second');
			await page.mouse.click(x, y);
			await expect(page.locator('body')).toHaveAttribute('data-pointer-target', 'first');
			await expect(page.locator('body')).toHaveAttribute('data-pointer-edge', edge);
		}
	});

	test('all create entry surfaces announce and focus the created annotation', async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Milestone 3 qualifies this surface in Chromium and Firefox.');
		await page.exposeFunction('annotationCreationAnnouncement', timelineAnnotationCreationAnnouncement);
		await page.setContent(`
			<section data-root>
				<button data-create="corner-marker">Corner marker</button>
				<div data-timeline-annotation-layer tabindex="-1"><button data-annotation-id="existing">Existing layer row</button></div>
				<section data-timeline-annotation-panel>
					<button data-create="panel-marker">Panel marker</button>
					<button data-annotation-id="existing">Existing panel row</button>
				</section>
				<div data-ruler tabindex="0">Ruler</div>
				<span data-status role="status" aria-live="polite" aria-atomic="true"></span>
			</section>
		`);
		await page.evaluate(({ focusSource }) => {
			const focusCreated = (0, eval)(`(${focusSource})`);
			const root = document.querySelector('[data-root]');
			const layer = root.querySelector('[data-timeline-annotation-layer]');
			const panel = root.querySelector('[data-timeline-annotation-panel]');
			const status = root.querySelector('[data-status]');
			let sequence = 0;
			const create = async (kind, origin, preferredSurface) => {
				sequence += 1;
				const id = `created-${origin}-${sequence}`;
				const start = sequence * 24_000;
				const annotation = {
					id, sequenceId: 'main', name: origin, color: 'blue', batchId: null,
					opaqueExtensions: {}, kind, anchor: 'sample',
					timelineStartFrame: start,
					timelineEndFrame: kind === 'marker' ? start : start + 12_000,
					durationFrames: kind === 'marker' ? 0 : 12_000,
					coordinateDomain: 'resolved-samples',
				};
				for (const surface of [layer, panel]) {
					const item = document.createElement('button');
					item.dataset.annotationId = id;
					item.textContent = origin;
					surface.append(item);
				}
				status.textContent = await window.annotationCreationAnnouncement(annotation, {
					sampleRate: 48_000, locale: 'en', secondsUnit: 's', unnamed: 'Unnamed annotation',
					marker: 'Marker', region: 'Region', template: 'Created {kind}: {name}, {timing}',
				});
				requestAnimationFrame(() => focusCreated(root, id, preferredSurface));
			};
			root.querySelector('[data-create="corner-marker"]').addEventListener('click', () => {
				void create('marker', 'corner', 'layer');
			});
			root.querySelector('[data-create="panel-marker"]').addEventListener('click', () => {
				void create('marker', 'panel', 'panel');
			});
			layer.addEventListener('keydown', (event) => {
				if (event.key.toLowerCase() === 'm') void create('marker', 'layer', 'layer');
			});
			root.querySelector('[data-ruler]').addEventListener('keydown', (event) => {
				if (event.key.toLowerCase() === 'r') void create('region', 'ruler', 'layer');
			});
		}, { focusSource: focusCreatedTimelineAnnotation.toString() });

		const status = page.locator('[data-status]');
		await page.locator('[data-create="corner-marker"]').click();
		await expect(status).toHaveText('Created Marker: corner, 0.500 s');
		await expect(page.locator('[data-timeline-annotation-layer] [data-annotation-id="created-corner-1"]')).toBeFocused();
		await page.locator('[data-create="panel-marker"]').click();
		await expect(status).toHaveText('Created Marker: panel, 1.000 s');
		await expect(page.locator('[data-timeline-annotation-panel] [data-annotation-id="created-panel-2"]')).toBeFocused();
		await page.locator('[data-timeline-annotation-layer]').focus();
		await page.locator('[data-timeline-annotation-layer]').press('m');
		await expect(status).toHaveText('Created Marker: layer, 1.500 s');
		await expect(page.locator('[data-timeline-annotation-layer] [data-annotation-id="created-layer-3"]')).toBeFocused();
		await page.locator('[data-ruler]').focus();
		await page.locator('[data-ruler]').press('r');
		await expect(status).toHaveText('Created Region: ruler, 2.000–2.250 s');
		await expect(page.locator('[data-timeline-annotation-layer] [data-annotation-id="created-ruler-4"]')).toBeFocused();
	});
});
