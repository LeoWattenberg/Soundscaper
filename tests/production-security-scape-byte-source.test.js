/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

test('production evidence pins bounded random-access .scape admission', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const matchingControls = matrix.risks.flatMap((risk) => risk.currentControls
		.filter(({ id }) => id === 'bounded-random-access-archive-reading')
		.map((control) => ({ riskId: risk.id, control })));
	assert.equal(matchingControls.length, 1);
	assert.equal(matchingControls[0].riskId, 'scape-archive-expansion');
	const { control } = matchingControls[0];
	assert.ok(control);
	assert.match(
		control.summary,
		/lower-only.*33 MiB.*native `Uint8Array`.*69,271,649-byte.*comments.*conflicting overlaps.*payload gaps.*Blob.*zero-high-water-mark.*overlap-only.*lazy.*immutable `scape-range-v1`.*Audacity.*`materialized-v1`.*strict renderer adapter.*descriptor URL\/declared size.*fetch implementation.*16-MiB.*`206`.*stream done.*without exposing release authority.*project-dialog.*OS-association.*awaited scope.*inspection.*open decision.*import.*exact-once release.*sparse 8 GiB.*current-schema.*real read-capability store.*protocol shim.*collision lookup.*cancellation before import.*less than 8 MiB.*65,557-byte.*placeholder huge asset.*sparse-host.*Node protocol shim.*does not qualify payload integrity.*full import.*RSS.*browser heap.*quota.*whole-archive atomicity.*publisher authentication/iu,
	);
	for (const path of [
		'desktop/constants.js',
		'desktop/protocol.js',
		'desktop/read-selection-service.js',
		'src/common/editor/desktop-scape-archive-byte-source.ts',
		'src/common/editor/desktop-read-profile.ts',
		'src/common/editor/file-service.js',
		'src/common/editor/scape-abort.ts',
		'src/common/editor/scape-archive-byte-source.ts',
		'src/common/editor/scape-archive-layout-witness.ts',
		'src/common/editor/scape-archive-layout.ts',
		'src/common/editor/scape-archive-reader.ts',
		'src/common/editor/scape-project-input.ts',
		'src/common/editor/ui/workspace/desktop-project-file-routing.ts',
		'tests/audio-editor-scape-archive-byte-source.test.ts',
		'tests/audio-editor-desktop-project-file-routing.test.ts',
		'tests/audio-editor-desktop-scape-archive-byte-source.test.ts',
		'tests/audio-editor-file-service-scape-ranges.test.ts',
		'tests/audio-editor-scape-project-byte-source.test.ts',
		'tests/desktop-read-selection-service.test.js',
		'tests/desktop-scape-range-protocol.test.js',
		'tests/desktop-scape-sparse-range-integration.test.ts',
		'tests/helpers/sparse-scape-zip64-fixture.ts',
	]) {
		assert.ok(control.evidence.some((item) => item.path === path), `Missing evidence from ${path}`);
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
	}

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/scape-archive-structure-integrity.*branded random-access byte-source.*lower.*33 MiB.*native typed-array.*69,271,649-byte.*central comments.*conflicting overlaps.*payload gaps.*zero-high-water-mark.*overlap-only.*lazily.*strict renderer adapter.*descriptor URL\/declared size.*fetch implementation.*16 MiB.*`206`.*`Content-Range`.*`Content-Length`.*stream `done`.*project-dialog.*OS-association.*terminal.*\.scape.*exact canonical Scape MIME.*awaited capability scope.*inspection.*collision decision.*import.*exactly once.*main-process release.*authoritative.*exact 8 GiB sparse Zip64.*current schema.*real read-capability store.*protocol handler.*structural inspection.*collision lookup.*cancellation before import.*less than 8 MiB.*65,557-byte.*sparse-file support.*Node protocol shim.*manifest digest.*ZIP CRC.*placeholders.*does not qualify payload integrity.*full import.*process RSS.*browser heap.*filesystem quota.*whole-archive atomicity.*publisher authentication/isu,
	);
	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(
		roadmap,
		/random-access byte source.*69,271,649 bytes.*canonical writer profile.*payload gaps/isu,
	);
	assert.match(
		roadmap,
		/desktop adapter.*descriptor URL\/declared size.*fetch implementation.*16 MiB.*`206`.*`Content-Range`.*`Content-Length`.*response-body `done`.*first admitted abort or\s+transport failure.*stable.*reason.*no descriptor ID or release authority.*file service.*awaited capability scope.*inspection.*open decision.*import.*exactly once.*success.*failure.*cancellation.*abort/isu,
	);
	assert.match(
		roadmap,
		/main-only selection service assigns `materialized-v1` or `scape-range-v1`.*four-capability.*65 GiB.*globally and per committed-document owner.*exact.*8 GiB sparse range witness.*at-most-16-MiB `206`.*less than 8 MiB.*65,557-byte.*asset CRC.*manifest-declared digest.*placeholders.*structural\/transport evidence rather than payload-integrity, full-import, or\s+memory qualification/isu,
	);
});
