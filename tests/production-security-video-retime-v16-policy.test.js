/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('family-v1 retime authority retains the independently versioned V2 curve without product inference', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'current-video-retime-admission',
	);
	assert.ok(control);
	assert.equal(control.policyAuthority, 'family-v1-active');
	assert.deepEqual(control.evidence, [
		{ kind: 'implementation', path: 'src/common/editor/video-retime-v16.ts' },
		{ kind: 'implementation', path: 'src/common/editor/video-retime-web-core-ordinal-authority.ts' },
		{ kind: 'implementation', path: 'src/framescaper/editor-project-retime.ts' },
		{ kind: 'test', path: 'tests/audio-editor-video-retime-web-core-ordinal-authority.test.ts' },
		{ kind: 'test', path: 'tests/audio-editor-framescaper-baseline.test.ts' },
	]);
	assert.match(
		control.summary,
		/Framescaper family v1.*independently versioned V2 retime curve.*direct unversioned domain modules/iu,
	);
	assert.match(
		control.summary,
		/Preview, browser export.*independent V14 native carrier.*exact ordinal selection.*source-domain proxy choice/iu,
	);
	assert.match(control.summary, /Soundscaper family v1 does not activate retime/iu);
	assert.match(control.summary, /no product family is inferred from the embedded curve or carrier version/iu);

	assert.equal(control.historicalPreFreezeNarrative?.status, 'provenance-only-not-runtime-authority');
	assert.equal(control.historicalPreFreezeNarrative?.formerId, 'v16-video-retime-preservation-admission');
	assert.match(control.historicalPreFreezeNarrative?.summary ?? '', /schema V16.*Framescaper V27/isu);

	const threatModel = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(threatModel, /policy-narrative:v16-video-retime-preservation-admission/iu);
	assert.match(threatModel, /Framescaper family v1.*independently versioned V2 retime curve.*direct unversioned domain modules/isu);
	assert.match(threatModel, /Soundscaper family v1 does not activate retime.*no product family is inferred/isu);
});
