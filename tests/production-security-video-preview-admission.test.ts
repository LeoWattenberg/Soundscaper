/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

interface SecurityEvidence {
	readonly kind: string;
	readonly path: string;
}

interface SecurityControl {
	readonly id: string;
	readonly summary: string;
	readonly evidence: readonly SecurityEvidence[];
}

interface SecurityRisk {
	readonly id: string;
	readonly status: string;
	readonly currentControls: readonly SecurityControl[];
}

interface SecurityMatrix {
	readonly modelDocument: string;
	readonly risks: readonly SecurityRisk[];
}

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

const EXPECTED_EVIDENCE = [
	{ kind: 'implementation', path: 'src/common/editor/video-preview-capture-admission.ts' },
	{ kind: 'implementation', path: 'src/common/editor/video-media.js' },
	{ kind: 'implementation', path: 'src/common/editor/controller/source-import.ts' },
	{ kind: 'test', path: 'tests/audio-editor-video-preview-capture-admission.test.ts' },
	{ kind: 'test', path: 'tests/audio-editor-video-media.test.js' },
	{ kind: 'test', path: 'tests/audio-editor-source-import.test.ts' },
] as const;

test('disposable video-preview admission remains narrowly evidenced and documented', async () => {
	const matrixText = await readFile(matrixUrl, 'utf8');
	const matrix = JSON.parse(matrixText) as SecurityMatrix;
	const parserBounds = matrix.risks.find(({ id }) => id === 'external-media-parser-bounds');
	assert.ok(parserBounds, 'external-media-parser-bounds risk is required');
	assert.equal(parserBounds.status, 'partial');

	const admission = parserBounds.currentControls.find(
		({ id }) => id === 'bounded-disposable-video-preview-capture',
	);
	assert.ok(admission, 'bounded disposable video-preview capture control is required');
	for (const expected of EXPECTED_EVIDENCE) {
		assert.ok(
			admission.evidence.some(
				({ kind, path }) => kind === expected.kind && path === expected.path,
			),
			`video-preview admission needs ${expected.kind} evidence from ${expected.path}`,
		);
	}
	assert.match(admission.summary, /non-raiseable.*16,?384\s*(?:x|×|by)\s*16,?384/isu);
	assert.match(admission.summary, /256 MiB.*(?:nominal|logical).*source[- ]RGBA/isu);
	assert.match(admission.summary, /640\s*(?:x|×|by)\s*360.*921,?600.*RGBA/isu);
	assert.match(admission.summary, /exact.*post[- ]encode.*4 MiB/isu);
	assert.match(admission.summary, /4 MiB.*before.*(?:return|publication)/isu);
	assert.match(admission.summary, /per[- ]extractor.*serializ/isu);
	assert.match(admission.summary, /cancel/iu);

	const threatModel = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	const name = 'production threat model';
	const previewScope = videoPreviewDocumentation(threatModel, name);
	assert.match(
		previewScope,
		/non-raiseable.*16,?384\s*(?:x|×|by)\s*16,?384.*256 MiB/isu,
		`${name} must state the source-frame geometry and nominal RGBA ceilings`,
	);
	assert.match(
		previewScope,
		/640\s*(?:x|×|by)\s*360.*921,?600.*4 MiB/isu,
		`${name} must state the disposable output and post-encode ceilings`,
	);
	assert.match(
		previewScope,
		/loadedmetadata/iu,
		`${name} must retain loadedmetadata discovery as a residual`,
	);
	assert.match(
		previewScope,
		/decoder/iu,
		`${name} must retain decoder allocation as a residual`,
	);
	assert.match(
		previewScope,
		/(?:codec.*heap|heap.*codec)/isu,
		`${name} must retain codec heap as a residual`,
	);
	assert.match(
		previewScope,
		/\bRSS\b/iu,
		`${name} must retain process RSS as a residual`,
	);
	assert.match(
		previewScope,
		/(?:\bGC\b|garbage[- ]collection)/iu,
		`${name} must retain garbage-collection headroom as a residual`,
	);
	assert.match(
		previewScope,
		/encode[- ]time.*allocat/isu,
		`${name} must retain encode-time allocation as a residual`,
	);
	assert.match(
		previewScope,
		/toDataURL.*(?:base64|allocat)/isu,
		`${name} must retain the toDataURL fallback allocation as a residual`,
	);
	assert.match(
		previewScope,
		/(?:multiple|another|separate)\s+(?:concurrent\s+)?extractors?.*(?:overlap|concurrent|serializ|reservation)/isu,
		`${name} must retain multiple-extractor overlap as a residual`,
	);
	assert.match(
		previewScope,
		/genuine editorial (?:video )?prox(?:y|ies).*(?:future|remain.*open)/isu,
		`${name} must retain genuine editorial proxies as future work`,
	);
});

function videoPreviewDocumentation(documentation: string, name: string): string {
	const marker = /(?:disposable|bounded) (?:browser )?video[- ]preview capture/iu.exec(documentation);
	assert.ok(marker, `${name} must document bounded disposable video-preview capture`);
	return documentation.slice(marker.index, marker.index + 6_000);
}
