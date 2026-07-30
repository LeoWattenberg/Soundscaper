/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

test('production evidence pins bounded random-access .scape admission', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const archiveExpansion = matrix.risks.find(({ id }) => id === 'scape-archive-expansion');
	const control = archiveExpansion?.currentControls.find(
		({ id }) => id === 'bounded-random-access-archive-reading',
	);
	assert.ok(control);
	assert.match(
		control.summary,
		/lower-only.*33 MiB.*native `Uint8Array`.*69,271,649-byte.*comments.*conflicting overlaps.*payload gaps.*Blob.*strict renderer adapter.*descriptor URL\/declared size.*fetch implementation.*16-MiB.*partial responses.*stream done.*first admitted abort or transport failure.*without exposing release authority.*project-dialog.*OS-association.*\.scape.*terminal.*exact canonical MIME.*awaited scope.*inspection.*open decision.*import.*exact-once capability release.*Browser Blob.*Audacity.*separate large-project admission.*absent.*512 MiB/iu,
	);
	for (const path of [
		'src/common/editor/desktop-scape-archive-byte-source.ts',
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
	]) {
		assert.ok(control.evidence.some((item) => item.path === path), `Missing evidence from ${path}`);
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)));
	}

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/scape-archive-structure-integrity.*branded random-access byte-source.*lower.*33 MiB.*native typed-array.*69,271,649-byte.*central comments.*conflicting overlaps.*payload gaps.*strict renderer adapter.*descriptor URL\/declared size.*fetch implementation.*16 MiB.*`206`.*`Content-Range`.*`Content-Length`.*stream `done`.*first admitted abort or transport error.*stable restorable reason.*queued.*neither fetches nor poisons.*project-dialog.*OS-association.*terminal.*\.scape.*exact canonical Scape MIME.*awaited capability scope.*inspection.*collision decision.*import.*exactly once.*main-process release.*authoritative.*bounded structural snapshot.*not whole-archive atomicity.*512 MiB.*large-project admission.*does not exist/isu,
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
		/desktop project router.*native dialog.*OS file\s+associations.*browser-selected.*Blob.*Audacity.*bounded\s+materialization.*no separate large-project admission.*512 MiB.*8 GiB/isu,
	);
});
