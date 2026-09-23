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
import { staticRouteGeneratorArguments } from './helpers/static-route-generator-subprocess.ts';

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
	const effectiveDates = ['22 September 2026', '22. September 2026'];
	for (const [index, policy] of policies.entries()) {
		const prose = [policy.effectiveDate, policy.summary, ...policy.sections.flatMap(
			({ heading, body }) => [heading, body],
		)].join('\n');
		// Both are literal strings, so a substring check asserts what the test
		// means. Compiling them as patterns instead escaped only the parentheses
		// of the controller name and left the address's dots matching any
		// character at all.
		assert.ok(prose.includes(CONTROLLER), `the policy names the controller ${CONTROLLER}`);
		assert.ok(prose.includes(CONTACT), `the policy names the contact address ${CONTACT}`);
		assert.match(prose, /Cloudflare/iu);
		assert.match(prose, /GitHub/iu);
		assert.match(prose, /Web VCR/iu);
		assert.match(prose, /Migadu/iu);
		assert.match(prose, /Article 6\(1\)\(f\)|Art\. 6 Abs\. 1 lit\. f/iu);
		assert.match(prose, /microphone|Mikrofon/iu);
		assert.match(prose, /camera|Kamera/iu);
		assert.match(prose, /display|Bildschirm/iu);
		assert.match(prose, /recording device label|Bezeichnung des Aufnahmegeräts/iu);
		assert.match(prose, /hardware identifier|Hardwarekennung/iu);
		assert.match(prose, /local assistance|Lokale Assistenz/iu);
		assert.match(prose, /no Soundscaper or Framescaper accounts|keine Soundscaper- oder Framescaper-Konten/iu);
		assert.match(prose, /no product analytics|keine Produktanalyse/iu);
		assert.match(prose, /supervisory authority|Aufsichtsbehörde/iu);
		assert.equal(policy.effectiveDate, effectiveDates[index]);
		assert.doesNotMatch(prose, /google-analytics|googletagmanager|cloudflareinsights|posthog|sentry/iu);

		const network = policy.sections.find(({ id }) => id === 'network')?.body ?? '';
		assert.match(network, /Freesound/iu);
		assert.match(network, /search terms|Suchbegriffe/iu);
		assert.match(network, /result page|Ergebnisseite/iu);
		assert.match(network, /license filter|Lizenzfilter/iu);
		assert.match(network, /sort choice|Sortierauswahl/iu);
		assert.match(network, /sound ID|Sound-ID/iu);
		assert.match(network, /sound details|Sounddetails/iu);
		assert.match(network, /preview|Vorschau/iu);
		assert.match(network, /import/iu);
		assert.match(network, /byte range|Byte-Bereich/iu);
		assert.match(network, /Cloudflare.*Soundscaper.*proxy|Cloudflare.*Soundscaper-Proxy/iu);
		assert.match(network, /server-side application credential|serverseitigen Anwendungszugang/iu);
		assert.match(network, /Ogg preview|Ogg-Vorschau/iu);
		assert.match(network, /not sent|nicht übermittelt/iu);
		assert.match(network, /OAuth/iu);
		assert.match(network, /original file|Originaldatei/iu);
		assert.match(network, /upload|hochladen/iu);
		assert.match(network, /title|Titel/iu);
		assert.match(network, /description|Beschreibung/iu);
		assert.match(network, /license|Lizenz/iu);

		const recipients = policy.sections.find(({ id }) => id === 'recipients')?.body ?? '';
		assert.match(recipients, /Freesound/iu);
		assert.match(recipients, /Universitat Pompeu Fabra/iu);
		assert.match(recipients, /proxy.*connection data|Verbindungsdaten des Proxys/iu);
		assert.match(recipients, /own privacy policy|eigen(?:e|en) Datenschutzerklärung/iu);
		assert.match(recipients, /href="https:\/\/freesound\.org\/help\/privacy\/"/u);
		assert.match(recipients, /access and refresh tokens|Zugriffs- und Aktualisierungstoken/iu);

		const retention = policy.sections.find(({ id }) => id === 'retention-deletion')?.body ?? '';
		assert.match(retention, /disconnect|Verbindung trennen/iu);
		assert.match(retention, /OAuth attempt|OAuth-Versuch/iu);
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
			await execFileAsync(process.execPath, staticRouteGeneratorArguments(outputRoot), {
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

/**
 * The manual destination was once chosen by searching the whole URL for the
 * support host, so any address that merely mentioned it — in a path, a query or
 * a fragment an outside page controls — opened as though it were the Audacity
 * manual. Matching the parsed hostname is what confines the decision to the
 * host that actually serves the page.
 */
test('the desktop manual destination is chosen by host rather than by substring', () => {
	assert.equal(desktopExternalDestination('https://support.audacityteam.org/'), 'manual');
	assert.equal(desktopExternalDestination('https://support.audacityteam.org/quick_help.html'), 'manual');
	assert.equal(desktopExternalDestination('https://SUPPORT.AUDACITYTEAM.ORG/'), 'manual');

	assert.equal(desktopExternalDestination('https://example.invalid/?ref=support.audacityteam.org'), 'homepage');
	assert.equal(desktopExternalDestination('https://example.invalid/support.audacityteam.org/'), 'homepage');
	assert.equal(desktopExternalDestination('https://support.audacityteam.org.example.invalid/'), 'homepage');
	assert.equal(desktopExternalDestination('not a url at all'), 'homepage');
	assert.equal(desktopExternalDestination('mailto:privacy@support.soundscaper.org'), 'support');
});
