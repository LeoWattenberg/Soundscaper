/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const threatModelUrl = new URL('../docs/production-threat-model.md', import.meta.url);
const CONTROL_ID = 'durable-routed-take-cycle-capture-and-recovery';

test('routed take-cycle capture has exact durability, recovery, and resource truth', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	const control = risk?.currentControls.find(({ id }) => id === CONTROL_ID);
	assert.ok(control);
	assert.equal(risk.status, 'partial');
	assert.equal(risk.releaseDisposition, 'conditional');
	assert.match(
		control.summary,
		/Soundscaper.*`takeComp`-gated.*Record options.*Record loop into takes.*writable exact-schema-17.*positive enabled loop.*unlocked armed audio targets.*routed input.*one owning sequence.*Framescaper.*neither.*cycle entry.*recovery UI.*direct start, Recover, and Discard.*before controller mutation/iu,
	);
	assert.match(
		control.summary,
		/refuse.*busy.*pending recovery.*timed recording.*punch selection.*sound activation.*locked or unrouted.*disabled or empty loop.*differently sized overlapping.*cannot pause/iu,
	);
	assert.match(
		control.summary,
		/selection-only.*session history.*dirty state.*without autosave or compaction.*flushes the exact current project.*before capture input or durable session I\/O.*currentness.*input acquisition.*AudioContext.*before.*one-minute point-in-time.*project sample rate.*total routed channels.*Float32.*60 seconds.*not a duration cap, quota reservation, or write guarantee.*before durable session and lane registration.*recorder creation or start/iu,
	);
	assert.match(
		control.summary,
		/resamples.*project rate.*contiguous integer sample grid.*complete pass.*explicitly interrupted partial final pass.*distinct ordered lane, take, and source.*exact-loop repeat.*same group.*differently sized overlap.*before input.*multiple tracks.*same publication generation.*finalizes.*independently.*not all-track atomic.*one history command and undo per routed track.*restart replay.*no undo/iu,
	);
	assert.match(
		control.summary,
		/raw capture.*outside project JSON and `\.scape`.*durable analysis registry.*source-chunk roots.*1 through 768,000.*1 through 64 channels.*65,536 frames.*8 MiB useful planar Float32.*4,096 spans and passes.*V17 entity capacity.*64 active spools per project.*4,096 globally.*exact global boundary.*IndexedDB reopen/iu,
	);
	assert.match(
		control.summary,
		/registry-visible prefix.*chunk written before.*failed registry CAS.*never capture evidence.*exact-token cleanup.*capturing and sealed roots.*retention.*regardless of age.*unregistered stale chunks.*reclaimed.*no age pruning or general project-deletion lifecycle.*registered roots/iu,
	);
	assert.match(
		control.summary,
		/source token.*canonical packed byte length and SHA-256.*recovery envelope.*publication generation.*lane ownership.*source journals.*base and target project revisions and document SHA-256.*project and source CAS.*strict active project.*session history.*session token.*before synchronization/iu,
	);
	assert.match(
		control.summary,
		/8 MiB.*each raw planar chunk.*one evidence accumulator.*separate useful-planar boundaries.*not a combined or aggregate transient-memory claim.*input callback PCM.*routed views.*resampler output.*span and source clones.*repository.*IndexedDB.*structured-clone.*canonical pack buffer.*JavaScript objects.*MediaStream.*codec.*browser audio internals.*GC.*heap.*RSS.*unrelated jobs.*excluded.*no aggregate duration, global byte, or RSS bound/iu,
	);
	assert.match(
		control.summary,
		/frozen recovery authority.*every envelope, raw, and capturing root.*ownership.*one publication generation.*exact object identity.*matching token.*current writable project.*no implicit decision.*closing.*switching.*durable roots.*inspection and pending authority.*block.*edits.*save and autosave.*ordinary, new-track, cycle, and timed recording.*handoff.*deletion.*garbage collection.*maintenance.*exact Recover or Discard/iu,
	);
	assert.match(
		control.summary,
		/lock loss.*cancellation and stop.*reinspection.*no prompt or bounded[- ]deadline guarantee.*partial settlement.*exact retry authority.*mixed.*IndexedDB process reopen.*Recover.*never activates.*stale published source token.*raw draft.*exact two-lane V17.*PCM.*Discard.*base unchanged.*zero.*source, envelope, spool, and chunk roots/iu,
	);
	assert.match(
		control.summary,
		/durable repository finalization and restart replay.*exact two-lane.*`\.scape` collision-copy.*production-recovered.*exact PCM.*remapping.*Soundscaper.*Framescaper.*read-only.*Soundscaper.*production-finalized.*no missing sources/iu,
	);
	assert.match(
		control.summary,
		/configured Chromium.*persistent userDataDir.*closes and relaunches the browser without application unload.*preserves IndexedDB.*ordinary settlement.*exact-loop repeat.*restart Recover.*second restart.*close.*no decision.*mutation controls.*blocked.*keyboard.*Discard.*named dialog.*Recover focus.*basic accessibility.*no serious axe.*forced colors/iu,
	);
	assert.match(
		control.summary,
		/not.*operating-system crash or power-loss.*fsync.*packaged device or OS matrix.*cross-browser.*screen-reader.*assistive-technology.*synthetic oscillator MediaStream.*synthetic quota.*not exact browser captured-waveform or PCM parity.*external latency calibration.*punch, timed, sound-activated, and paused modes.*excluded/iu,
	);

	assertEvidence(control, [
		'src/common/editor/take-cycle-capture-domain.ts',
		'src/common/editor/controller/take-cycle-routed-capture-validation.ts',
		'src/common/editor/controller/take-cycle-routed-capture-service.ts',
		'src/common/editor/controller/take-cycle-capture-pcm-evidence.ts',
		'src/common/editor/controller/take-cycle-live-pass-evidence.ts',
		'src/common/editor/controller/take-cycle-live-capture-spool.ts',
		'src/common/editor/storage/raw-pcm-spool-repository.ts',
		'src/common/editor/take-cycle-recovery-envelope.ts',
		'src/common/editor/storage/take-cycle-recovery-envelope-repository.ts',
		'src/common/editor/controller/take-cycle-recording-repository-composition.ts',
		'src/common/editor/controller/take-cycle-current-project-publication-service.ts',
		'src/common/editor/controller/take-cycle-open-recovery-authority.ts',
		'src/common/editor/controller/take-cycle-open-recovery-coordinator.ts',
		'src/common/editor/controller/take-cycle-production-composition.ts',
		'src/common/editor/controller/take-cycle-app-composition.ts',
		'src/common/editor/controller/take-cycle-recording-app-session.ts',
		'src/common/editor/controller/recording-action-facade.ts',
		'src/common/editor/controller/project-mutation-service.ts',
		'src/common/editor/controller/project-retention-service.ts',
		'src/common/editor/controller/project-lock-service.ts',
		'src/common/editor/controller/project-switch-service.ts',
		'src/common/editor/ui/take-cycle-recording-menu.ts',
		'src/common/editor/ui/dialogs/TakeCycleRecoveryDialog.tsx',
		'tests/audio-editor-take-cycle-capture-domain.test.ts',
		'tests/audio-editor-take-cycle-capture-resource-bounds.test.ts',
		'tests/audio-editor-take-cycle-capture-storage.test.ts',
		'tests/audio-editor-take-cycle-routed-capture-service.test.ts',
		'tests/audio-editor-take-cycle-repository-composition.test.ts',
		'tests/audio-editor-take-cycle-current-project-publication.test.ts',
		'tests/audio-editor-take-cycle-current-project-settlement.test.ts',
		'tests/audio-editor-take-cycle-recording-app-session.test.ts',
		'tests/audio-editor-take-cycle-production-recovery-storage.test.ts',
		'tests/audio-editor-take-cycle-open-recovery-coordinator.test.ts',
		'tests/audio-editor-recording-cycle-action-facade.test.ts',
		'tests/audio-editor-project-mutation-service.test.ts',
		'tests/audio-editor-project-retention-service.test.ts',
		'tests/audio-editor-project-lock-service.test.ts',
		'tests/audio-editor-project-switch-service.test.ts',
		'tests/audio-editor-take-cycle-ui.test.tsx',
		'tests/helpers/cycle-produced-take-fixture.ts',
		'tests/audio-editor-cycle-produced-take-fixture.test.ts',
		'tests/audio-editor-scape-take-comp-roundtrip.test.ts',
		'tests/desktop-project-library-take-comp-handoff.test.ts',
		'tests/browser/audio-editor-take-cycle-recording.spec.js',
	]);

	const threatModel = (await readFile(threatModelUrl, 'utf8')).replace(/\s+/gu, ' ');
	assert.match(threatModel, /policy-narrative:durable-routed-take-cycle-capture-and-recovery/iu);
	assert.match(threatModel, /one-minute point-in-time.*not a duration cap.*8 MiB.*not a combined or aggregate transient-memory claim/iu);
	assert.match(threatModel, /persistent userDataDir.*without application unload.*not.*operating-system crash or power-loss/iu);
});

function assertEvidence(control, paths) {
	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of paths) assert.equal(evidence.has(path), true, path);
}
