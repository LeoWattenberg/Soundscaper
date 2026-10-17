/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
interface Selection { testIgnore?: readonly string[]; testMatch?: readonly string[] }
async function config(name: string): Promise<Selection> {
	return (await import(new URL(`../${name}`, import.meta.url).href) as { default: Selection }).default;
}
test('Motion successor preview and native cleanup workflows run only against the explicit successor site', async () => {
	const linked = await config('playwright.motionscaper-links.config.mjs');
	for (const file of ['motionscaper-linked-native-menu.spec.ts', 'motionscaper-linked-mixed-preview.spec.ts', 'motionscaper-successor-native-cleanup.spec.ts', 'motionscaper-successor-shell.spec.ts', 'motionscaper-successor-opaque-archive.spec.ts']) {
		const pattern = `**/${file}`;
		assert.ok(linked.testMatch?.includes(pattern), `${file} needs the successor fixture`);
		for (const name of ['playwright.config.mjs', 'playwright.motionscaper.config.mjs']) {
			assert.ok((await config(name)).testIgnore?.includes(pattern), `${name} must not send ${file} to a baseline product`);
		}
	}
});
