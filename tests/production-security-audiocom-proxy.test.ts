/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
interface Evidence { readonly kind: string; readonly path: string }
interface Control { readonly id: string; readonly summary: string; readonly evidence: readonly Evidence[] }
interface Residual { readonly id: string; readonly exposure: string; readonly requiredControl: string; readonly acceptanceCriteria: readonly string[] }
interface Risk { readonly id: string; readonly boundaryIds: readonly string[]; readonly status: string; readonly surfaceDisposition: string; readonly currentControls: readonly Control[]; readonly residualRisks: readonly Residual[] }
interface Matrix { readonly boundaries: readonly { readonly id: string; readonly evidence: readonly Evidence[] }[]; readonly risks: readonly Risk[] }

test('audio.com governance records the authenticated proxy and retains deployment and media lifecycle gaps', async () => {
	const matrix = JSON.parse(await readFile(new URL('../config/production-security-matrix.json', import.meta.url), 'utf8')) as Matrix;
	const risk = matrix.risks.find(item => item.id === 'audiocom-proxy-boundary');
	assert.ok(risk);
	assert.equal(risk.status, 'partial');
	assert.equal(risk.surfaceDisposition, 'conditional');
	assert.deepEqual(risk.boundaryIds, ['authenticated-client-to-audiocom-proxy']);
	const boundary = matrix.boundaries.find(item => item.id === risk.boundaryIds[0]);
	assert.ok(boundary?.evidence.some(item => item.kind === 'test'));
	const control = risk.currentControls.find(item => item.id === 'bounded-audiocom-oauth-media-proxy');
	assert.ok(control);
	for (const path of ['functions/api/audiocom/_shared/oauth-handlers.ts', 'functions/api/audiocom/_shared/handlers.ts', 'desktop/audiocom-integration.ts', 'tests/audiocom-handlers.test.ts', 'tests/audiocom-oauth.test.ts']) {
		assert.ok(control.evidence.some(item => item.path === path), path);
	}
	assert.match(control.summary, /PKCE.*S256/isu);
	assert.match(control.summary, /AES-256-GCM.*HttpOnly/isu);
	assert.match(control.summary, /100,000,000.*128 MiB/isu);
	assert.match(control.summary, /no.*Audacity project.*original.*download/isu);
	assert.deepEqual(risk.residualRisks.map(item => item.id), ['audiocom-deployment-and-live-provider-proof', 'audiocom-media-transfer-lifecycle']);
	assert.match(risk.residualRisks[0]?.exposure ?? '', /does not provision or verify.*rate-limit.*registered.*smoke/isu);
	assert.match(risk.residualRisks[1]?.exposure ?? '', /no proxy-owned.*idle or total.*non-idempotent.*duplicate.*cleanup.*best-effort/isu);
	for (const residual of risk.residualRisks) {
		assert.ok(residual.requiredControl);
		assert.ok(residual.acceptanceCriteria.length);
	}
	const document = await readFile(new URL('../docs/policies/security.md', import.meta.url), 'utf8');
	assert.match(document, /### audio\.com API proxy/u);
	assert.match(document, /policy-narrative:bounded-audiocom-oauth-media-proxy/u);
	assert.match(document, /`audiocom-proxy-boundary` is \*\*partial\*\*/u);
});
