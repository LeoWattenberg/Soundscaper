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
		/lower-only.*33 MiB.*native `Uint8Array`.*69,271,649-byte.*comments.*conflicting overlaps.*payload gaps.*Blob.*zero-high-water-mark.*overlap-only.*lazy.*immutable `scape-range-v1`.*Audacity.*`materialized-v1`.*strict renderer adapter.*descriptor URL\/declared size.*fetch implementation.*16-MiB.*`206`.*stream done.*without exposing release authority.*project-dialog.*OS-association.*awaited scope.*inspection.*open decision.*import.*exact-once release.*inspection collision-cancel.*less than 8 MiB.*65,557-byte suffix.*does not hash.*authentic exact 8 GiB.*8,589,932,094-byte.*7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be.*2,909,126,900.*real read-capability store.*protocol shim.*renderer adapter.*file service.*project service.*full import.*independent counting-SHA-256.*zero payload retention.*no Blob.*capability release.*exactly once.*pinned handle close.*exactly once.*sparse-file.*Node protocol shim.*not packaged UI.*OPFS.*IndexedDB.*durable.*quota.*preflight.*browser heap.*RSS.*whole-storage atomicity.*publisher authentication/iu,
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
		'tests/desktop-scape-sparse-full-import-integration.test.ts',
		'tests/desktop-scape-sparse-range-integration.test.ts',
		'tests/helpers/sparse-scape-zip64-fixture.ts',
	]) {
		assert.ok(control.evidence.some((item) => item.path === path), `Missing evidence from ${path}`);
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
	}
	const integrityRisk = matrix.risks.find(({ id }) => id === 'scape-archive-structure-integrity');
	const integrityControl = integrityRisk?.currentControls
		.find(({ id }) => id === 'canonical-entry-and-content-integrity');
	assert.ok(integrityControl);
	assert.match(
		integrityControl.summary,
		/zip\.js.*`checkSignature: true`.*CRC.*negative rollback.*signature rejection.*target inventory unchanged/iu,
	);
	for (const path of [
		'src/common/editor/scape-archive-reader.ts',
		'tests/audio-editor-scape-streaming-video.test.ts',
	]) {
		assert.ok(integrityControl.evidence.some((item) => item.path === path), `Missing integrity evidence from ${path}`);
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
	}

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/scape-archive-structure-integrity.*branded random-access byte-source.*lower.*33 MiB.*native typed-array.*69,271,649-byte.*central comments.*conflicting overlaps.*payload gaps.*zero-high-water-mark.*overlap-only.*lazily.*strict renderer adapter.*descriptor URL\/declared size.*fetch implementation.*16 MiB.*`206`.*`Content-Range`.*`Content-Length`.*stream `done`.*project-dialog.*OS-association.*terminal.*\.scape.*exact canonical Scape MIME.*awaited capability scope.*inspection.*collision decision.*import.*exactly once.*main-process release.*authoritative.*inspection collision-cancel.*less than 8 MiB.*65,557-byte suffix.*does not hash.*authentic exact 8 GiB.*8,589,932,094-byte.*7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be.*2,909,126,900.*zip\.js.*`checkSignature: true`.*CRC.*negative rollback.*real read-capability store.*protocol handler.*renderer adapter.*file service.*project service.*full import.*independent counting-SHA-256.*zero payload retention.*no Blob.*capability release.*exactly once.*pinned handle close.*exactly once.*sparse-file.*Node protocol shim.*not packaged UI.*OPFS.*IndexedDB.*durable.*quota.*preflight.*browser heap.*RSS.*whole-storage atomicity.*publisher authentication/isu,
	);
	assert.doesNotMatch(control.summary, /placeholder huge[- ]asset/iu);
	assert.doesNotMatch(threatModel, /huge asset(?:'s)? manifest digest and ZIP CRC are placeholders/iu);
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
		/main-assigned `scape-range-v1`.*exact 8 GiB sparse Zip64.*without a final renderer `Blob`.*collision-cancel.*payload-lazy.*standalone full import.*authentic pinned CRC.*manifest SHA.*real range\/service\/import.*non-retaining counting independent-SHA.*transactional sink.*packaged Electron.*UI.*OPFS\/IndexedDB durable storage.*quota\/preflight.*browser heap.*RSS.*whole-archive.*storage atomicity.*publisher.*authentication/isu,
	);
});
