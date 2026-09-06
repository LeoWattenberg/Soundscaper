/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

/**
 * Helpers for the editor's responsive layouts. Below 900px (or with the Layout
 * preference forced) the editor keeps its menubar, action bar and tool
 * toolbar in a chrome drawer and its track headers in a second drawer; a
 * helper that reaches into either opens it first and lets the command close
 * it again. On the desktop layout the toggles do not exist and these return
 * false without touching anything.
 */
export async function openChromeDrawer(editor) {
	const toggle = editor.locator('[data-chrome-drawer-toggle]');
	if (!await toggle.isVisible()) return false;
	if (await toggle.getAttribute('aria-expanded') !== 'true') {
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	}
	return true;
}

export async function closeChromeDrawer(editor) {
	const toggle = editor.locator('[data-chrome-drawer-toggle]');
	if (!await toggle.isVisible() || await toggle.getAttribute('aria-expanded') !== 'true') return;
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
}

export async function openTrackHeaderDrawer(editor) {
	const toggle = editor.locator('[data-track-header-toggle]');
	if (!await toggle.isVisible()) return false;
	if (await toggle.getAttribute('aria-expanded') !== 'true') {
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	}
	return true;
}

/**
 * A surface a browser reports as fractionally outside its viewport is still
 * inside it. Layout, transforms and device pixel ratios all round, and a box
 * has come back at x = -0.043 on a phone viewport that draws correctly; the
 * check is for a surface that has left the screen, so it admits less than half
 * a pixel either way.
 */
const VIEWPORT_SUBPIXEL_TOLERANCE = 0.5;

export async function expectSurfaceWithinViewport(surface, page) {
	const box = await surface.boundingBox();
	expect(box).not.toBeNull();
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	expect(box.x).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE);
	expect(box.y).toBeGreaterThanOrEqual(-VIEWPORT_SUBPIXEL_TOLERANCE);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + VIEWPORT_SUBPIXEL_TOLERANCE);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + VIEWPORT_SUBPIXEL_TOLERANCE);
}

export async function waitForResponsiveEditorLayout(editor) {
	await expect.poll(() => editor.evaluate((root) => (
		root.classList.contains('kw-audio-editor--compact') === window.matchMedia('(max-width: 900px)').matches
	))).toBe(true);
	await editor.evaluate(() => new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(resolve));
	}));
}
