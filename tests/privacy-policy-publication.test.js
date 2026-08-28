/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
	privacyPolicyLocale,
	privacyPolicyPath,
	privacyPolicyUrl,
	renderPrivacyPolicyDocument,
} from '../src/common/site/privacy-policy.js';
import { AUDIO_EDITOR_APPLICATION_MENU_UTILITY_IDS } from '../src/common/editor/ui/application-menu-registry.ts';
import { createPrivacyPolicyMenuItem } from '../src/common/editor/ui/privacy-policy-menu.ts';
import { desktopExternalDestination } from '../src/common/editor/ui/workspace-runtime.js';

const execFileAsync = promisify(execFile);
const CONTROLLER = 'Koytek Wattenberg Media UG (haftungsbeschränkt)';
const CONTACT = 'privacy@support.soundscaper.org';

test('privacy policy locale and product URLs are closed over English and German routes', () => {
	assert.equal(privacyPolicyLocale('de-DE'), 'de');
	assert.equal(privacyPolicyLocale('en-US'), 'en');
	assert.equal(privacyPolicyLocale('fr'), 'en');
	assert.equal(privacyPolicyPath('de-DE'), '/privacy/de/');
	assert.equal(privacyPolicyUrl('soundscaper', 'en'), 'https://soundscaper.org/privacy/en/');
	assert.equal(privacyPolicyUrl('framescaper', 'de'), 'https://framescaper.org/privacy/de/');
	assert.equal(desktopExternalDestination('https://soundscaper.org/privacy/en/'), 'privacy-en');
	assert.equal(desktopExternalDestination('https://framescaper.org/privacy/de/'), 'privacy-de');
	assert.equal(AUDIO_EDITOR_APPLICATION_MENU_UTILITY_IDS.privacyPolicy, 'privacy-policy');
	const open = () => undefined;
	assert.deepEqual(createPrivacyPolicyMenuItem({ legalLink: 'Privacy policy' }, open), {
		id: 'privacy-policy', label: 'Privacy policy', onClick: open,
	});
});

test('English and German policy documents carry equivalent standalone privacy disclosures', () => {
	const english = renderPrivacyPolicyDocument({
		productId: 'soundscaper', locale: 'en', canonicalOrigin: 'https://soundscaper.org',
	});
	const german = renderPrivacyPolicyDocument({
		productId: 'framescaper', locale: 'de', canonicalOrigin: 'https://framescaper.org',
	});
	for (const [locale, html] of [['en', english], ['de', german]]) {
		assert.match(html, new RegExp(`<html[^>]+lang="${locale}"`, 'iu'));
		assert.match(html, new RegExp(CONTROLLER.replace(/[()]/gu, '\\$&'), 'u'));
		assert.match(html, new RegExp(CONTACT, 'u'));
		assert.match(html, /Cloudflare/iu);
		assert.match(html, /GitHub/iu);
		assert.match(html, /Web VCR/iu);
		assert.match(html, /Migadu/iu);
		assert.match(html, /Article 6\(1\)\(f\)|Art\. 6 Abs\. 1 lit\. f/iu);
		assert.match(html, /microphone|Mikrofon/iu);
		assert.match(html, /camera|Kamera/iu);
		assert.match(html, /display|Bildschirm/iu);
		assert.match(html, /local assistance|Lokale Assistenz/iu);
		assert.match(html, /no accounts|keine Konten/iu);
		assert.match(html, /no product analytics|keine Produktanalyse/iu);
		assert.match(html, /supervisory authority|Aufsichtsbehörde/iu);
		assert.match(html, /28 August 2026|28\. August 2026/iu);
		assert.doesNotMatch(html, /<script\b/iu);
		assert.doesNotMatch(html, /\s(?:src|srcset)=/iu);
		assert.doesNotMatch(html, /rel="stylesheet"/iu);
		assert.doesNotMatch(html, /google-analytics|googletagmanager|cloudflareinsights|posthog|sentry/iu);
	}
	assert.deepEqual(sectionIds(english), sectionIds(german));
	assert.equal(sectionIds(english).length, 13);
	assert.match(english, /HTTP log retention is disabled/iu);
	assert.match(german, /HTTP-Log-Aufbewahrung ist deaktiviert/iu);
});

test('the static route generator emits product-canonical policy pages without the editor shell', async (t) => {
	for (const productId of ['soundscaper', 'framescaper']) {
		await t.test(productId, async () => {
			const outputRoot = await mkdtemp(join(tmpdir(), `scape-privacy-${productId}-`));
			t.after(() => rm(outputRoot, { recursive: true, force: true }));
			await writeBuildFixture(outputRoot);
			await execFileAsync(process.execPath, ['scripts/generate-static-routes.mjs', outputRoot], {
				cwd: process.cwd(),
				env: { ...process.env, SCAPE_PRODUCT: productId },
			});
			for (const locale of ['en', 'de']) {
				const html = await readFile(join(outputRoot, 'privacy', locale, 'index.html'), 'utf8');
				assert.match(html, new RegExp(`<link rel="canonical" href="https://${productId}\\.org/privacy/${locale}/"`));
				assert.doesNotMatch(html, /id="app"|src="\/src\/main\.jsx"/u);
			}
		});
	}
});

function sectionIds(html) {
	return Array.from(html.matchAll(/<section\s+id="([^"]+)"/gu), ([, id]) => id);
}

async function writeBuildFixture(outputRoot) {
	await mkdir(outputRoot, { recursive: true });
	await writeFile(join(outputRoot, 'index.html'), `<!doctype html>
<html lang="en"><head><!-- route-head --><title>Soundscaper</title></head>
<body><div id="app"></div><script type="module" src="/src/main.jsx"></script></body></html>`);
	await writeFile(join(outputRoot, '_headers'), await readFile('public/_headers', 'utf8'));
}
