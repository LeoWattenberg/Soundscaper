import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor, clipByName, clipField, closeDialog, collectClientErrors,
	importFiles, openClipProperties, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

async function overlapStereoClips(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const outgoing = clipByName(editor, toneA.name);
	const incoming = clipByName(editor, toneB.name);
	const track = outgoing.locator('xpath=ancestor::*[@data-track-row][1]');
	const trackId = await track.getAttribute('data-track-id');
	const trackName = (await track.locator('.track-control-panel__track-name-text').textContent()).trim();
	const properties = await openClipProperties(page, editor, incoming);
	await clipField(properties, 'startFrame').fill('19200');
	await clipField(properties, 'startFrame').press('Tab');
	await closeDialog(properties);
	await incoming.click({ button: 'right', position: { x: 32, y: 10 } });
	const menu = page.locator('.audio-editor-clip-context-menu');
	const move = menu.getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await move.hover();
	await move.getByRole('menuitem', { name: trackName, exact: true }).click();
	await expect(incoming.locator('xpath=ancestor::*[@data-track-row][1]')).toHaveAttribute('data-track-id', trackId);
	return { editor, outgoing, incoming, track };
}

async function curveMidpointGains(region) {
	return region.locator('[data-fade-curve] path, path[data-fade-curve]').evaluateAll(paths => paths.map(path => {
		const length = path.getTotalLength();
		let low = 0;
		let high = length;
		for (let step = 0; step < 32; step += 1) {
			const middle = (low + high) / 2;
			if (path.getPointAtLength(middle).x < 50) low = middle;
			else high = middle;
		}
		const viewBox = path.ownerSVGElement.viewBox.baseVal;
		return 1 - (path.getPointAtLength((low + high) / 2).y - viewBox.y) / viewBox.height;
	}));
}

test.describe('design-system audio crossfade visuals', () => {
	registerAudioEditorHooks();

	test('draws one linear crossover and keeps authored fade curves across an audio overlap', async ({ page }) => {
		const errors = collectClientErrors(page);
		const { editor, outgoing, incoming, track } = await overlapStereoClips(page);
		const region = track.locator('[data-automatic-crossfade="true"]');
		await expect(region).toHaveCount(1);
		await expect(region).toHaveAttribute('role', 'img');
		await expect(region).toHaveAttribute('aria-label', /^Automatic crossfade between .+ and .+$/u);
		await expect(region).toHaveCSS('background-image', 'none');
		await expect(region).toHaveCSS('overflow', 'hidden');
		await expect(region.locator('[data-fade-overlay="out"]')).toBeVisible();
		await expect(region.locator('[data-fade-overlay="in"]')).toBeVisible();
		await expect(region.locator('[data-fade-curve="out"]')).toBeVisible();
		await expect(region.locator('[data-fade-curve="in"]')).toBeVisible();
		const gains = await curveMidpointGains(region);
		expect(gains).toHaveLength(2);
		for (const gain of gains) expect(gain).toBeCloseTo(0.5, 2);

		const [outBounds, inBounds, regionBounds] = await Promise.all([
			outgoing.boundingBox(), incoming.boundingBox(), region.boundingBox(),
		]);
		expect(outBounds).not.toBeNull();
		expect(inBounds).not.toBeNull();
		expect(regionBounds).not.toBeNull();
		const overlapLeft = Math.max(outBounds.x, inBounds.x);
		const overlapRight = Math.min(outBounds.x + outBounds.width, inBounds.x + inBounds.width);
		expect(overlapRight - overlapLeft).toBeGreaterThan(20);
		expect(Math.abs(regionBounds.x - overlapLeft)).toBeLessThan(2);
		expect(Math.abs(regionBounds.x + regionBounds.width - overlapRight)).toBeLessThan(2);

		await outgoing.focus();
		await outgoing.press('Enter');
		const fadeIn = outgoing.getByRole('slider', { name: 'Fade in', exact: true });
		await fadeIn.press('End');
		const curves = outgoing.locator('.audio-editor-clip-fade__curve');
		await expect(curves.locator('polygon')).toHaveCount(0);
		await expect(curves.locator('path[data-fade-curve="in"]')).toHaveCount(1);
		await expect(outgoing.getByRole('slider', { name: 'Fade in shape', exact: true })).toBeVisible();
		await expect(outgoing.getByRole('slider', { name: 'Fade out shape', exact: true })).toHaveCount(0);
		await incoming.focus();
		await incoming.press('Enter');
		await expect(incoming.getByRole('slider', { name: 'Fade in shape', exact: true })).toHaveCount(0);
		await expect(region).toBeVisible();
		expect(errors).toEqual([]);
	});
});
