/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('legacy AUP evidence pins structural and block-materialization budgets', async () => {
	const matrix = await readMatrix();
	const projectDocuments = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	assert.ok(projectDocuments);
	assert.equal(projectDocuments.status, 'partial');
	assert.equal(projectDocuments.releaseDisposition, 'conditional');

	const legacyAup = projectDocuments.currentControls.find(
		({ id }) => id === 'legacy-aup-xml-structural-budget',
	);
	assert.ok(legacyAup);
	assert.match(
		legacyAup.summary,
		/format-specific.*legacy `?\.aup`? XML.*authoritative declared `File\.size`.*independently measures.*returned text.*UTF-8 byte length.*16 MiB.*100,000.*elements.*400,000.*attributes.*depth.*128.*lower-only.*before.*`?_data`?.*block.*conversion.*project\/source persistence.*publication.*does not qualify.*elapsed time.*other project families.*PCM amplification.*total import working set/iu,
	);
	for (const path of [
		'src/common/editor/aup-legacy-xml.ts',
		'src/common/editor/aup-legacy.js',
		'src/common/editor/controller/project-import-service.ts',
		'tests/audio-editor-aup-legacy.test.js',
		'tests/audio-editor-aup-legacy-import-boundary.test.ts',
	]) assert.ok(legacyAup.evidence.some((item) => item.path === path));

	const blockBudget = projectDocuments.currentControls.find(
		({ id }) => id === 'legacy-aup-block-pcm-working-set-budget',
	);
	assert.ok(blockBudget);
	assert.match(
		blockBudget.summary,
		/canonical, default-sized legacy `?\.aup`?.*simple and silent.*non-raiseable.*lower-only.*65,536 selected.*65,536 materializing references.*2 MiB.*physical file.*1 MiB.*sample payload.*524,288.*frames per block.*512 MiB.*unique referenced `File\.size`.*512 MiB.*retained Float32 PCM.*bounded exact\/basename indexes.*positive block lengths.*24-byte AU header.*equal-length paired linked clips.*before retained-PCM allocation or block reads.*payload\/frame checks precede decoded-block allocation.*actual `ArrayBuffer\.byteLength`.*snapshotted declared size.*native-endian.*unique file.*preallocated output.*logically reachable parser-owned pending window.*2 MiB encoded.*2 MiB decoded.*without channel-normalization copies.*precedes conversion.*persistence.*publication.*does not qualify.*customized Audacity block-size.*garbage-collection lag.*total renderer RSS.*streaming-scale/iu,
	);
	for (const path of [
		'src/common/editor/aup-legacy-block-budget.ts',
		'src/common/editor/aup-legacy.js',
		'src/common/editor/controller/project-import-service.ts',
		'tests/audio-editor-aup-legacy-block-budget.test.ts',
		'tests/audio-editor-aup-legacy-block-compatibility.test.ts',
		'tests/audio-editor-aup-legacy.test.js',
		'tests/audio-editor-aup-legacy-import-boundary.test.ts',
	]) assert.ok(blockBudget.evidence.some((item) => item.path === path));

	const sharedBudget = projectDocuments.residualRisks.find(({ id }) => id === 'shared-project-parse-budget');
	const malformedCorpus = projectDocuments.residualRisks.find(({ id }) => id === 'malformed-project-corpus');
	assert.ok(sharedBudget);
	assert.match(
		sharedBudget.exposure,
		/legacy `?\.aup`? XML.*canonical, default-sized simple\/silent `?_data`?.*structural.*referenced-input.*block-geometry.*retained-PCM.*indexed-lookup.*parser-owned pending-window/iu,
	);
	assert.match(
		sharedBudget.exposure,
		/raw-JSON structural preflight.*every owning-family-v1 project input.*before `JSON\.parse`.*101,536 JSON values.*depth 130.*exact owning family v1.*decoded.*semantic validator.*independent ceilings.*100,000 logical nodes.*depth 128/iu,
	);
	assert.match(
		sharedBudget.exposure,
		/over-budget renderer input.*before host commit or staging.*loaded commit result.*before the renderer response.*may follow host publication/iu,
	);
	assert.match(
		sharedBudget.exposure,
		/lexical preflight.*decoded-codec traversal.*validation admission.*response serialization.*reset their counters.*per-phase shape bounds.*aggregate execution budget.*CPU or elapsed time.*cancellation.*allocation.*provider-internal allocation.*garbage-collection lag.*total main-process RSS/iu,
	);
	assert.match(
		sharedBudget.exposure,
		/other supported input parsers.*elapsed-time budgets.*opaque-extension cloning.*aliases.*customized Audacity block sizes.*downstream.*total renderer RSS.*cancellation.*streaming-scale legacy import/iu,
	);
	assert.match(
		sharedBudget.requiredControl,
		/structural budgets.*remaining supported input parsers.*aggregate CPU or elapsed-time.*cancellation.*scalar-byte work.*end-to-end working-set.*repeated main family-v1 project phases.*downstream legacy-import/iu,
	);
	assert.ok(malformedCorpus);
	assert.match(
		malformedCorpus.exposure,
		/focused legacy `?\.aup`? XML and AU-block.*declared.*returned XML bytes.*elements.*attributes.*depth.*selected.*referenced.*indexed lookup.*ambiguity.*declared\/actual block bytes.*header minimum.*positive block.*payload\/frame.*native endianness.*pre-allocation refusal.*retained PCM.*silence.*repeated references.*stereo padding.*unequal linked-pair rejection.*does not yet cover every supported project family/iu,
	);

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(
		documentation,
		/external-project-document-validation.*partial.*legacy `?\.aup`? XML.*`File\.size`.*UTF-8 byte length.*16 MiB.*100,000.*400,000.*128.*canonical, default-sized simple\/silent `?_data`?.*65,536.*2 MiB.*1 MiB.*524,288.*512 MiB.*retained Float32 PCM.*exact\/basename indexes.*positive block lengths.*24-byte AU header.*equal-length paired linked clips.*precedes retained-PCM allocation or block reads.*precedes decoded-block allocation.*native-endian.*unique file.*preallocated output.*logically reachable parser-owned window.*precedes conversion.*persistence.*publication.*do not qualify.*customized Audacity block-size.*garbage-collection lag.*total renderer RSS.*streaming-scale.*corpus/isu,
	);
	assert.match(
		documentation,
		/1\.0 project-identity boundary.*own\s+enumerable data properties.*numeric-only.*REIMPORT_REQUIRED.*no project migration, copy-forward, predecessor-validator dispatch/isu,
	);
});

test('desktop save admission evidence pins product-wide capacity before staging', async () => {
	const matrix = await readMatrix();
	const desktopWrite = matrix.risks.find(({ id }) => id === 'desktop-write-path-capabilities');
	assert.ok(desktopWrite);
	assert.equal(desktopWrite.status, 'partial');
	assert.equal(desktopWrite.releaseDisposition, 'conditional');

	const admission = desktopWrite.currentControls.find(
		({ id }) => id === 'aggregate-save-capacity-and-disk-admission',
	);
	assert.ok(admission);
	assert.match(
		admission.summary,
		/16 outstanding product-wide targets.*4 pending or live sessions.*65 GiB per-save and aggregate admitted bytes.*synchronously.*before the first await.*lower-only.*bigint `statfs`.*available.*before staging open.*point-in-time.*not an operating-system reservation.*cleanup failure.*charged.*ENOSPC or EDQUOT.*qualified typed refusal.*staged temporary file is discarded.*admitted count and bytes release.*committed target file survives.*commit-time space failure cleans staging.*other write failures keep the session open/iu,
	);
	for (const path of [
		'desktop/constants.js', 'desktop/preload.mjs',
		'desktop/save-targets.js', 'desktop/save-space.js',
		'tests/desktop-save-capacity.test.js', 'tests/desktop-save-space-exhaustion.test.js',
		'tests/desktop-protocol.test.js',
	]) assert.ok(admission.evidence.some((item) => item.path === path));

	assert.equal(desktopWrite.residualRisks.some(
		({ id }) => id === 'write-capacity-and-disk-admission',
	), false);
	assert.ok(desktopWrite.residualRisks.some(
		({ id }) => id === 'in-flight-write-cancellation',
	));

	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(
		documentation,
		/desktop-write-path-capabilities.*partial.*16 outstanding product-wide save targets.*4 pending or live save sessions.*65 GiB per-save and aggregate admitted bytes.*synchronously before the first await.*lower-only.*BigInt `statfs`.*before staging open.*point-in-time.*not an operating-system reservation.*cleanup failure.*charged.*active chunk.*parent-directory/isu,
	);
});

async function readMatrix() {
	return JSON.parse(await readFile(matrixUrl, 'utf8'));
}
