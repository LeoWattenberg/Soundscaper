/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const referenceScaleTestUrl = new URL('./desktop-scape-sparse-full-import-integration.test.ts', import.meta.url);
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
	for (const claim of [
		/lower-only.*33 MiB.*native `Uint8Array`.*69,271,649-byte.*comments.*conflicting overlaps.*payload gaps.*Blob.*zero-high-water-mark.*overlap-only.*lazy/iu,
		/immutable `scape-range-v1`.*Audacity.*`materialized-v1`.*strict renderer adapter.*descriptor URL\/declared size.*fetch implementation.*16-MiB.*`206`.*stream done.*without exposing release authority.*project-dialog.*OS-association.*awaited scope.*inspection.*open decision.*import.*exact-once release/iu,
		/inspection collision-cancel.*less than 8 MiB.*65,557-byte suffix.*does not hash.*authentic exact 8 GiB.*8,589,932,094-byte.*7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be.*2,909,126,900/iu,
		/real read-capability store.*protocol shim.*renderer adapter.*file service.*project service.*full import.*independent counting-SHA-256.*zero payload retention.*no Blob.*point-in-time import-capacity estimate.*precedes the media writer.*9,448,925,304-byte.*capability release.*exactly once.*pinned handle close.*exactly once/iu,
		/verified reference evidence.*opt-in.*`npm run test:reference:scape-8gib`.*routine Node.*coverage.*fast-skip.*measured all-files coverage.*passed.*525 seconds.*does not demote.*collision-cancel.*corrupted-CRC negative rollback.*routine coverage.*sparse-file.*Node protocol shim.*not packaged UI/iu,
		/OPFS.*IndexedDB.*durable.*real browser or filesystem quota accuracy.*reservation.*write-time success.*concurrent writers.*browser heap.*RSS.*whole-storage atomicity.*publisher authentication/iu,
	]) assert.match(control.summary, claim);
	const capacityControl = matrix.risks.find(({ id }) => id === 'scape-archive-expansion')?.currentControls
		.find(({ id }) => id === 'point-in-time-import-capacity-admission');
	assert.ok(capacityControl);
	for (const claim of [
		/validated manifest assets.*collision-cancel.*before copy remapping.*transaction construction.*writer creation/iu,
		/checked safe-integer sum.*ceil\(10%\).*optional storage estimator once/iu,
		/cancel performs no estimate.*copy and replace.*full incoming asset total.*absent or unknown estimate permits.*known insufficient.*stable quota error/iu,
		/cancellation.*signal-ignoring estimate.*no writer or extraction/iu,
		/8,589,932,094.*9,448,925,304.*before its media writer/iu,
		/lastPreflight.*reserve capacity.*real browser or filesystem quota accuracy.*durable OPFS or IndexedDB 8 GiB.*overhead.*policy headroom.*write-time success.*concurrent writers/iu,
	]) assert.match(capacityControl.summary, claim);
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
	const packageMetadata = JSON.parse(await readFile(packageUrl, 'utf8'));
	assert.equal(
		packageMetadata.scripts?.['test:reference:scape-8gib'],
		'node --import tsx --test tests/desktop-scape-sparse-full-import-integration.test.ts',
	);
	const referenceScaleTest = await readFile(referenceScaleTestUrl, 'utf8');
	assert.match(referenceScaleTest, /REFERENCE_SCALE_NPM_LIFECYCLE = 'test:reference:scape-8gib'/u);
	assert.match(referenceScaleTest, /process\.env\.npm_lifecycle_event === REFERENCE_SCALE_NPM_LIFECYCLE/u);
	assert.match(referenceScaleTest, /process\.env\[REFERENCE_SCALE_ENVIRONMENT\] === '1'/u);
	assert.match(referenceScaleTest, /skip: RUN_REFERENCE_SCALE_GATE \? false : REFERENCE_SCALE_SKIP_MESSAGE/u);
	assert.match(referenceScaleTest, /EXACT_REQUIRED_FREE_BYTES = 9_448_925_304/u);
	assert.match(referenceScaleTest, /'capacity-estimated',[\s\S]*'media-write-began'/u);
	for (const path of [
		'tests/audio-editor-scape-streaming-video.test.ts',
		'tests/desktop-scape-sparse-range-integration.test.ts',
	]) {
		const routineTest = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
		assert.doesNotMatch(routineTest, /SOUNDSCAPER_RUN_REFERENCE_SCAPE_8GIB/u);
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
	assert.match(threatModel, /scape-archive-structure-integrity/iu);
	for (const claim of [
		/point-in-time-import-capacity-admission.*validated manifest asset size.*checked safe-integer arithmetic.*ceil\(10%\)/isu,
		/collision-cancel decision.*before copy remapping.*transaction construction.*source metadata reads.*writer creation.*optional storage estimator once/isu,
		/cancel performs no estimate.*copy and replace.*full incoming asset total.*missing estimator or unknown.*permits import.*known insufficient.*quota error/isu,
		/cancellation.*signal-ignoring estimate.*no writer or extraction.*8,589,932,094.*9,448,925,304-byte.*lastPreflight/isu,
		/does not reserve capacity.*real browser or filesystem quota accuracy.*durable 8 GiB.*overhead.*policy headroom.*write-time success.*concurrent writers/isu,
	]) assert.match(threatModel, claim);
	for (const claim of [
		/branded random-access byte-source.*lower.*33 MiB.*native typed-array.*69,271,649-byte.*central comments.*conflicting overlaps.*payload gaps.*zero-high-water-mark.*overlap-only.*lazily/isu,
		/strict renderer adapter.*descriptor URL\/declared size.*fetch implementation.*16 MiB.*`206`.*`Content-Range`.*`Content-Length`.*stream `done`.*project-dialog.*OS-association.*terminal.*\.scape.*exact canonical Scape MIME.*awaited capability scope.*inspection.*collision decision.*import.*exactly once.*main-process release.*authoritative/isu,
		/inspection collision-cancel.*less than 8 MiB.*65,557-byte suffix.*does not hash.*authentic exact 8 GiB.*8,589,932,094-byte.*7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be.*2,909,126,900.*zip\.js.*`checkSignature: true`.*CRC.*negative rollback/isu,
		/real read-capability store.*protocol handler.*renderer adapter.*file service.*project service.*full import.*independent counting-SHA-256.*zero payload retention.*point-in-time capacity estimate.*precedes the media writer.*9,448,925,304.*no Blob.*capability release.*exactly once.*pinned handle close.*exactly once/isu,
		/verified reference evidence.*opt-in.*`npm run test:reference:scape-8gib`.*routine Node.*coverage.*fast-skip.*measured all-files coverage.*passed.*525 seconds.*does not demote.*collision-cancel.*corrupted-CRC negative rollback.*routine coverage.*sparse-file.*Node protocol shim.*not packaged UI/isu,
		/OPFS.*IndexedDB.*durable.*real production browser or filesystem quota accuracy.*reservation.*write-time success.*concurrent writers.*browser heap.*RSS.*whole-storage atomicity.*publisher authentication/isu,
	]) assert.match(threatModel, claim);
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
		/main-assigned `scape-range-v1`.*exact 8 GiB sparse Zip64.*without a final renderer `Blob`.*collision-cancel.*payload-lazy.*standalone full import.*authentic pinned CRC.*manifest SHA.*real range\/service\/import.*non-retaining counting independent-SHA.*transactional sink.*packaged Electron.*UI.*OPFS\/IndexedDB durable storage.*browser heap.*RSS.*whole-archive.*storage\s+atomicity.*publisher.*authentication/isu,
	);
});
