/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { webBuildRouting, composeProductHeaders, parseHeaderRules, matchedHeaders, auditComposedHeaders } from '../scripts/lib/product-web-routing.mjs';

const shared = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
test('M10 dedicated bridge routes alone replace COOP, preserve COEP and decline editor offline fallback', () => {
	for (const [productId, line, path, coop] of [['motionscaper', 'baseline', '/composition-link/send/', 'same-origin-allow-popups'], ['framescaper', 'successor', '/composition-link/receive/', 'unsafe-none']] as const) {
		const routing = webBuildRouting({ SCAPE_PRODUCT: productId, SCAPE_FRAMESCAPER_LINE: line }); const headers = composeProductHeaders(shared, routing); const rules = parseHeaderRules(headers);
		assert.deepEqual(matchedHeaders(rules, path).get('cross-origin-opener-policy'), [coop]); assert.deepEqual(matchedHeaders(rules, path).get('cross-origin-embedder-policy'), ['credentialless']);
		assert.deepEqual(matchedHeaders(rules, '/en/').get('cross-origin-opener-policy'), ['same-origin']); assert.ok(routing.workers[0].foreignScopes.includes('/composition-link/'));
		assert.throws(() => auditComposedHeaders(headers + '\n/composition-link/evil/\n\t! Cross-Origin-Opener-Policy\n\tCross-Origin-Opener-Policy: unsafe-none', routing));
	}
});
test('M10 bridge exceptions are absent from Soundscaper and the frozen Frame line', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const routing = webBuildRouting({ SCAPE_PRODUCT: productId }); const headers = composeProductHeaders(shared, routing);
		assert.ok(!headers.includes('/composition-link/')); assert.deepEqual(matchedHeaders(parseHeaderRules(headers), '/composition-link/receive/').get('cross-origin-opener-policy'), ['same-origin']);
	}
});
