/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const compatibilityUrl = new URL('../config/project-compatibility.json', import.meta.url);
const compatibilityDocumentUrl = new URL('../docs/project-compatibility.md', import.meta.url);
const securityUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);

test('linked WAV handoff policy stays point-in-time and container-free', async () => {
	const policy = JSON.parse(await readFile(compatibilityUrl, 'utf8'));
	const rule = policy.rules.find(
		({ id }) => id === 'current-desktop-linked-wav-managed-handoff',
	);
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.requiredOutcome,
		/explicitly injected Electron.*point-in-time.*RIFF\/RF64 PCM or IEEE-float WAV.*first-party BW64 integer-PCM.*512 MiB.*main-private.*pathless.*initial chooser and bind.*whole WAV snapshot.*binding commits.*owner-scoped exact-revision range capability.*exact length and MIME.*full sequential SHA-256.*at-most-4-MiB.*recheck.*binding.*range-backed RIFF\/RF64\/BW64.*without another whole-original `Blob`.*generic platform port.*without.*optional range.*whole-`Blob` fallback.*sender.*no owned PCM body.*explicit managed handoff.*two full source-API passes.*fresh recipient.*ordinary owned canonical PCM.*reopen.*without.*locator.*external WAV container.*locator.*must not enter.*shared managed catalog.*recipient/iu,
	);
	assert.match(
		rule.currentBehavior,
		/main-private registry.*absolute path.*device, inode, size, modification time, and change time.*512 MiB.*binding.*scalar.*pathless.*chooser and initial bind.*whole WAV snapshot.*later maintained Electron source reads.*owner-scoped `linked-audio-range-v1`.*exact locator revision.*exact byte length and MIME.*complete opened handle.*at-most-4-MiB `206`.*recheck.*binding.*range-backed source.*without a second whole-original `Blob`.*read session.*release.*generic platform port.*whole-`Blob` resolution/iu,
	);
	assert.match(
		rule.currentBehavior,
		/sender.*owned source inventory remains empty.*`prepareHandoff`.*two canonical Float32 PCM source-API passes.*managed `audio-f32le-chunks-v1`.*fresh recipient.*owned source writer.*reopens.*without.*linked-original port.*WAV container bytes.*locator identity.*never cross.*managed-media bridge or catalog/iu,
	);
	assert.match(
		rule.currentBehavior,
		/pathname move or replacement.*cannot retarget.*opened handle.*same-inode mutation.*during or after sequential digest verification.*not fenced.*not content-frozen.*durable.*cross-process snapshot/iu,
	);
	for (const path of [
		'desktop/linked-video-locator-ipc.js',
		'src/common/editor/desktop-linked-audio-range-adapter.ts',
		'src/common/editor/desktop-linked-original-port.ts',
		'src/common/editor/controller/linked-wav-import-service.ts',
		'src/common/editor/storage/linked-audio-original-source-reader.ts',
		'src/common/editor/storage/linked-original-range-byte-source.ts',
		'src/common/editor/storage/linked-original-range-lease.ts',
		'src/common/editor/storage/desktop-shared-project-media-sender.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'tests/desktop-linked-audio-locator.test.ts',
		'tests/desktop-linked-audio-range-capability.test.js',
		'tests/audio-editor-desktop-linked-audio-range-source.test.ts',
		'tests/audio-editor-linked-audio-range-source-reader.test.ts',
		'tests/audio-editor-linked-wav-import.test.ts',
		'tests/audio-editor-linked-audio-source-reader.test.ts',
		'tests/desktop-project-library-managed-audio-handoff.test.ts',
	]) assert.ok(rule.evidence.includes(path), path);

	const documentation = await readFile(compatibilityDocumentUrl, 'utf8');
	assert.match(
		documentation,
		/narrow linked-WAV managed-handoff exception.*explicitly injected Electron.*point-in-time.*RIFF\/RF64 PCM or.*IEEE-float WAV.*first-party BW64 integer-PCM.*512 MiB.*main-private registry.*chooser and initial bind.*whole WAV snapshot.*binding commits.*owner-scoped `linked-audio-range-v1`.*exact locator revision.*RIFF\/RF64\/BW64 inspection.*complete opened handle.*at-most-4-MiB `206`.*rechecks.*binding.*range-backed source.*no second whole-original.*generic platform port.*whole-`Blob`.*fallback.*sender.*owned PCM inventory remains empty.*explicit `prepareHandoff`.*two canonical Float32 PCM.*source-API passes.*fresh recipient.*ordinary owned source writer.*reopen.*without.*locator.*external WAV container bytes.*locator identity.*do not cross.*managed-media bridge or enter.*shared catalog/isu,
	);
	assert.match(
		documentation,
		/This exception does not qualify.*packaged executable or UI.*operating-system file-dialog or path durability.*relink or watch.*broader audio formats.*arbitrary.*third-party BW64.*new BW64 ADM preservation or.*editing semantics.*range support outside maintained post-bind Electron.*linked-WAV source reads.*generic linked-audio support/isu,
	);
	assert.match(
		documentation,
		/same-inode in-place mutation.*during or after sequential digest verification.*not fenced.*not an operating-system bookmark.*content-frozen or durable byte lease.*cross-process snapshot/isu,
	);
});

test('linked WAV managed handoff is a narrow point-in-time security control', async () => {
	const matrix = JSON.parse(await readFile(securityUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'shared-desktop-project-library-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'point-in-time-linked-wav-managed-handoff',
	);
	assert.equal(risk?.status, 'partial');
	assert.ok(control);
	assert.match(
		control.summary,
		/explicitly injected Electron.*main-private.*pathless point-in-time binding.*RIFF\/RF64 PCM or IEEE-float WAV.*first-party BW64 integer-PCM.*512 MiB.*sender.*no owned PCM body.*whole external WAV.*exact digest.*canonical geometry/iu,
	);
	assert.match(
		control.summary,
		/subsequent maintained source reads.*exact locator revision.*opened-handle identity.*at-most-4-MiB responses.*binding and CAS fence.*exact WAV ranges.*without another whole-original Blob.*audio and video share.*128 capabilities.*64 GiB.*16 active requests.*512 MiB per file.*4 MiB per response.*only explicit managed handoff.*two canonical Float32 PCM passes.*`audio-f32le-chunks-v1`/iu,
	);
	assert.match(
		control.summary,
		/fresh recipient.*no locator port.*ordinary owned canonical PCM.*reopen.*without the original locator.*external WAV container bytes.*locator identity.*never cross.*managed-media bridge or catalog/iu,
	);
	assert.match(
		control.summary,
		/not.*packaged executable or UI.*operating-system file-dialog or path durability.*relink or watch.*broader formats.*arbitrary third-party BW64.*new BW64 ADM preservation or editing semantics.*generic linked-audio support.*audible or device playback.*reference-scale qualification.*initial whole-body materialization remains.*not a content-frozen, durable, or cross-process lease.*same-inode external mutation/iu,
	);
	for (const path of [
		'desktop/linked-video-locator-store.ts',
		'desktop/linked-video-locator-ipc.js',
		'desktop/preload.mjs',
		'src/common/editor/desktop-linked-original-port.ts',
		'src/common/editor/controller/linked-wav-import-service.ts',
		'src/common/editor/storage/linked-audio-original-source-reader.ts',
		'src/common/editor/storage/desktop-shared-project-media-sender.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'tests/desktop-linked-audio-locator.test.ts',
		'tests/audio-editor-linked-wav-import.test.ts',
		'tests/audio-editor-linked-audio-source-reader.test.ts',
		'tests/desktop-project-library-managed-audio-handoff.test.ts',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);

	const residual = risk?.residualRisks.find(
		({ id }) => id === 'shared-library-cross-product-media-availability',
	);
	assert.match(
		residual?.exposure ?? '',
		/maintained linked-WAV exception.*point-in-time.*initial whole-body binding materialization.*sender without owned PCM.*exact-revision owner-scoped stable-handle range lease.*canonical Float32 PCM.*without another whole-original Blob.*fresh recipient owns canonical PCM.*without the locator.*external WAV container.*does not cross/iu,
	);
	assert.match(
		residual?.exposure ?? '',
		/maintained linked-WAV exception.*exact-revision owner-scoped stable-handle range lease.*without another whole-original Blob.*linked audio beyond the maintained RIFF\/RF64 and first-party BW64.*range.*packaged executable or UI.*operating-system path durability.*arbitrary third-party BW64.*new BW64 ADM preservation and editing semantics.*content-frozen or cross-process leasing.*same-inode mutation fencing.*audible or device playback.*reference-scale memory/iu,
	);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/narrow linked-WAV managed-handoff exception.*Electron-injected.*point-in-time/isu,
	);
	assert.match(
		threatModel,
		/main-private maintained RIFF\/RF64 PCM or IEEE-float\s+WAV.*first-party BW64 integer-PCM.*no larger than 512 MiB/isu,
	);
	assert.match(
		threatModel,
		/sender\s+has no owned PCM.*explicit managed handoff.*two\s+canonical\s+Float32 PCM passes.*fresh recipient.*ordinary owned canonical PCM.*reopens without the original locator/isu,
	);
	assert.match(
		threatModel,
		/external container bytes and locator identity do not cross the managed-media\s+bridge or enter its catalog/iu,
	);
	assert.match(
		threatModel,
		/does not qualify.*packaged executable or UI.*operating-system file-dialog or path durability.*relink or watch.*broader audio formats.*arbitrary third-party BW64.*new BW64 ADM preservation or.*editing semantics.*generic linked-audio.*audible or device playback.*reference-scale.*initial complete-body materialization remains.*same-inode mutation.*not fenced.*four-MiB transport ceiling.*does not bound.*Float32 arrays.*metadata.*process RSS/isu,
	);
});

test('linked WAV portable archive stores canonical PCM without locator state', async () => {
	const policy = JSON.parse(await readFile(compatibilityUrl, 'utf8'));
	const rule = policy.rules.find(
		({ id }) => id === 'current-linked-wav-portable-archive',
	);
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.match(
		rule.requiredOutcome,
		/current-format exact-schema-9 `.scape` export.*linked RIFF\/RF64 PCM or IEEE-float WAV.*first-party BW64 integer-PCM.*sender.*no owned PCM.*only canonical `audio-f32le-chunks-v1`.*no locator.*WAV container.*fresh portless recipient.*ordinary owned canonical PCM.*durable reopen/iu,
	);
	assert.match(
		rule.currentBehavior,
		/verified linked source reader.*canonical Float32 PCM chunks.*sender.*zero owned source and chunk records.*archive.*one `audio-f32le-chunks-v1` asset.*canonical framed PCM.*different from.*external WAV container.*locator ID and revision.*absent.*fresh recipient.*no linked-original port.*owned source writer.*IndexedDB source and chunk.*zero linked bindings.*close and reopen.*exact samples/iu,
	);
	assert.match(
		rule.currentBehavior,
		/maintained Electron chooser and initial binding.*whole WAV snapshot.*subsequent archive source reads.*owner-scoped exact-revision range capability.*full sequential SHA-256.*at-most-4-MiB.*range-backed RIFF\/RF64\/BW64.*without another whole-original `Blob`.*generic platform port.*whole-`Blob`.*fallback.*directly exercises first-party BW64 integer PCM.*focused reader and import.*RIFF\/RF64 PCM and IEEE-float.*first-party BW64 integer-PCM.*does not qualify.*future-schema archive preservation.*byte-exact WAV-container preservation.*packaged executable or UI.*operating-system.*relink or watch.*other audio formats.*arbitrary third-party BW64.*new BW64 ADM preservation or editing semantics.*range support outside maintained post-bind Electron linked-WAV source reads/iu,
	);
	for (const path of [
		'src/common/editor/scape-project.js',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/storage/linked-audio-original-source-reader.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'tests/audio-editor-linked-audio-scape-roundtrip.test.ts',
	]) assert.ok(rule.evidence.includes(path), path);

	const documentation = await readFile(compatibilityDocumentUrl, 'utf8');
	assert.match(
		documentation,
		/narrow linked-WAV portable-archive exception.*current-format exact schema 9.*sender.*no owned PCM.*export.*canonical `audio-f32le-chunks-v1`.*external WAV container.*locator.*absent.*fresh recipient without.*linked-original port.*ordinary owned PCM.*close and reopen.*exact samples/isu,
	);
	assert.match(
		documentation,
		/maintained Electron chooser and initial bind.*whole WAV.*snapshot.*binding commits.*owner-scoped exact-revision range capability.*at-most-4-MiB.*range-backed.*RIFF.RF64.BW64.*without constructing another whole-original `Blob`.*generic platform port.*whole-`Blob`.*fallback/isu,
	);
	assert.match(
		documentation,
		/portable exception does not qualify.*future-schema archive preservation.*byte-exact WAV-container preservation.*packaged executable or UI.*operating-system.*relink or watch.*other audio formats.*arbitrary.*third-party BW64.*new BW64 ADM preservation or.*editing semantics.*range support outside maintained post-bind Electron.*linked-WAV source reads/isu,
	);
});

test('portable linked WAV canonicalization has a dedicated archive security control', async () => {
	const matrix = JSON.parse(await readFile(securityUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'scape-archive-structure-integrity');
	const control = risk?.currentControls.find(
		({ id }) => id === 'linked-wav-canonical-pcm-portability',
	);
	assert.equal(risk?.status, 'enforced');
	assert.ok(control);
	assert.match(
		control.summary,
		/current-format exact-schema-9 `.scape`.*linked RIFF\/RF64 PCM or IEEE-float WAV.*first-party BW64 integer-PCM.*no owned sender PCM.*verified canonical Float32 chunks.*one `audio-f32le-chunks-v1` asset.*external container bytes.*locator identity.*excluded.*fresh portless import.*ordinary owned PCM.*durable reopen/iu,
	);
	assert.match(
		control.summary,
		/First-party BW64 integer PCM.*direct witness.*maintained RIFF\/RF64 PCM and IEEE-float.*first-party BW64 integer-PCM boundary.*focused.*does not qualify.*future-schema archive preservation.*byte-exact WAV-container.*packaged executable or UI.*operating-system.*relink or watch.*other audio formats.*arbitrary third-party BW64.*new BW64 ADM preservation or editing semantics.*audible or device playback.*content-frozen or cross-process leases.*same-inode mutation fencing.*reference-scale memory/iu,
	);
	for (const path of [
		'src/common/editor/scape-project.js',
		'src/common/editor/scape-export-plan.ts',
		'src/common/editor/scape-archive-media.ts',
		'src/common/editor/storage/linked-audio-original-source-reader.ts',
		'src/common/editor/storage/source-write-repository.ts',
		'tests/audio-editor-linked-audio-scape-roundtrip.test.ts',
	]) assert.ok(control.evidence.some((item) => item.path === path), path);

	const threatModel = await readFile(threatModelUrl, 'utf8');
	assert.match(
		threatModel,
		/narrow linked-WAV portable-archive control.*current-format exact schema 9.*sender has no owned PCM.*canonical `audio-f32le-chunks-v1`.*external WAV container bytes.*locator identity.*absent.*fresh portless recipient.*ordinary owned PCM.*reopens.*exact samples/isu,
	);
	assert.match(
		threatModel,
		/does not qualify.*future-schema archive preservation.*byte-exact WAV-container preservation.*packaged executable or UI.*operating-system.*relink or watch.*other audio formats.*arbitrary third-party BW64.*new BW64 ADM preservation or editing semantics.*audible or device playback.*reference-scale memory/isu,
	);
});
