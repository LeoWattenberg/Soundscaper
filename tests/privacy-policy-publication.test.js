/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
	privacyPolicyContent,
	privacyPolicyLocale,
	privacyPolicyPath,
	privacyPolicyUrl,
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

test('English and German dialog content carries equivalent privacy disclosures', () => {
	const policies = [privacyPolicyContent('en'), privacyPolicyContent('de')];
	for (const policy of policies) {
		const prose = [policy.effectiveDate, policy.summary, ...policy.sections.flatMap(
			({ heading, body }) => [heading, body],
		)].join('\n');
		assert.match(prose, new RegExp(CONTROLLER.replace(/[()]/gu, '\\$&'), 'u'));
		assert.match(prose, new RegExp(CONTACT, 'u'));
		assert.match(prose, /Cloudflare/iu);
		assert.match(prose, /GitHub/iu);
		assert.match(prose, /Web VCR/iu);
		assert.match(prose, /Migadu/iu);
		assert.match(prose, /Article 6\(1\)\(f\)|Art\. 6 Abs\. 1 lit\. f/iu);
		assert.match(prose, /microphone|Mikrofon/iu);
		assert.match(prose, /camera|Kamera/iu);
		assert.match(prose, /display|Bildschirm/iu);
		assert.match(prose, /local assistance|Lokale Assistenz/iu);
		assert.match(prose, /no accounts|keine Konten/iu);
		assert.match(prose, /no product analytics|keine Produktanalyse/iu);
		assert.match(prose, /supervisory authority|Aufsichtsbehörde/iu);
		assert.match(prose, /28 August 2026|28\. August 2026/iu);
		assert.doesNotMatch(prose, /google-analytics|googletagmanager|cloudflareinsights|posthog|sentry/iu);
	}
	assert.deepEqual(
		policies[0].sections.map(({ id }) => id),
		policies[1].sections.map(({ id }) => id),
	);
	assert.equal(policies[0].sections.length, 13);
	assert.match(policies[0].sections.map(({ body }) => body).join('\n'), /HTTP log retention is disabled/iu);
	assert.match(policies[1].sections.map(({ body }) => body).join('\n'), /HTTP-Log-Aufbewahrung ist deaktiviert/iu);
});

test('the static route generator emits dialog-only policy application routes, including /privacy/', async (t) => {
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
				assert.match(html, /id="app"/u);
				assert.match(html, /src="\/src\/main\.jsx"/u);
				assert.doesNotMatch(html, /<main>\s*<p class="eyebrow"/u);
			}
			const rootHtml = await readFile(join(outputRoot, 'privacy', 'index.html'), 'utf8');
			assert.match(rootHtml, new RegExp(`<link rel="canonical" href="https://${productId}\\.org/privacy/en/"`));
			assert.match(rootHtml, /id="app"/u);
			assert.match(rootHtml, /src="\/src\/main\.jsx"/u);
		});
	}
});

async function writeBuildFixture(outputRoot) {
	await mkdir(outputRoot, { recursive: true });
	await writeFile(join(outputRoot, 'index.html'), `<!doctype html>
<html lang="en"><head><!-- route-head --><title>Soundscaper</title></head>
<body><div id="app"></div><script type="module" src="/src/main.jsx"></script></body></html>`);
	await writeFile(join(outputRoot, '_headers'), await readFile('public/_headers', 'utf8'));
}
