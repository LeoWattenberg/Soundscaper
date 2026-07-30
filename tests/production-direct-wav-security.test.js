/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

test('direct PCM security controls stay limited to WAV, AIFF, BWF, and authored BW64 routes', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const exactDirectPcm = findControl(matrix, 'desktop-write-path-capabilities', 'exact-direct-pcm-mix-save');
	const directPcmRollback = findControl(matrix, 'long-job-cancellation', 'direct-pcm-mix-save-rollback');
	const controllerIoBoundary = matrix.boundaries.find(({ id }) => id === 'controller-task-to-io');
	assert.ok(controllerIoBoundary, 'controller-task-to-io');

	for (const path of [
		'desktop/validation.js',
		'desktop/save-targets.js',
		'desktop/preload.mjs',
		'desktop/direct-wav-smoke.js',
		'src/common/editor/aiff.js',
		'src/common/editor/export.js',
		'src/common/editor/controller/direct-aiff-export.ts',
		'src/common/editor/controller/direct-bw64-export.ts',
		'src/common/editor/controller/direct-bwf-export.ts',
		'src/common/editor/controller/direct-export-dispatch.ts',
		'src/common/editor/controller/direct-pcm-export.ts',
		'src/common/editor/controller/direct-wav-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/controller/realtime-export-pcm-transform.ts',
		'src/common/editor/engine/rendering.ts',
		'src/common/editor/file-save-stream.ts',
		'src/common/editor/pcm-sink.js',
		'scripts/lib/desktop-direct-wav-smoke.mjs',
		'scripts/lib/desktop-direct-wav-smoke-evidence.mjs',
		'scripts/lib/desktop-direct-wav-pcm-signal.mjs',
		'tests/audio-editor-aiff-layout.test.ts',
		'tests/audio-editor-export-direct-aiff.test.ts',
		'tests/audio-editor-export-direct-bw64.test.ts',
		'tests/audio-editor-export-direct-bwf.test.ts',
		'tests/audio-editor-export-direct-wav.test.ts',
		'tests/audio-editor-export-direct-wav-reference.test.ts',
		'tests/helpers/direct-pcm-export-fixture.ts',
		'tests/audio-editor-realtime-export-pcm-transform.test.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/audio-editor-pcm-sink.test.js',
		'tests/desktop-pcm-mix-save-purpose.test.js',
		'tests/browser/audio-editor-direct-wav-save.spec.js',
		'tests/desktop-direct-wav-smoke-probe.test.js',
		'tests/desktop-direct-wav-smoke.test.js',
		'tests/desktop-direct-wav-pcm-signal.test.js',
		'tests/desktop-direct-wav-workflow.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(exactDirectPcm.evidence.some((item) => item.path === path), path);
	for (const path of [
		'src/common/editor/controller/direct-aiff-export.ts',
		'src/common/editor/controller/direct-bw64-export.ts',
		'src/common/editor/controller/direct-bwf-export.ts',
		'src/common/editor/controller/direct-export-dispatch.ts',
		'src/common/editor/controller/direct-pcm-export.ts',
	]) assert.ok(controllerIoBoundary.entryPoints.includes(path), path);
	for (const path of [
		'src/common/editor/controller/direct-aiff-export.ts',
		'src/common/editor/controller/direct-bw64-export.ts',
		'src/common/editor/controller/direct-bwf-export.ts',
		'src/common/editor/controller/direct-export-dispatch.ts',
		'src/common/editor/controller/direct-pcm-export.ts',
		'tests/audio-editor-export-direct-aiff.test.ts',
		'tests/audio-editor-export-direct-bw64.test.ts',
		'tests/audio-editor-export-direct-bwf.test.ts',
		'tests/browser/audio-editor-direct-wav-save.spec.js',
		'tests/audio-editor-export-direct-wav-reference.test.ts',
		'desktop/direct-wav-smoke.js',
		'scripts/lib/desktop-direct-wav-smoke.mjs',
		'tests/desktop-direct-wav-smoke-probe.test.js',
		'tests/desktop-direct-wav-smoke.test.js',
		'tests/desktop-direct-wav-workflow.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(controllerIoBoundary.evidence.some((item) => item.path === path), path);
	assert.match(
		exactDirectPcm.summary,
		/dedicated `audio-pcm-mix` purpose.*WAV, AIFF, BWF, and authored BW64 target names.*one mix.*`realtime-stream`.*WAV.*`audio\/wav`.*`\.wav`.*65 GiB.*AIFF.*`audio\/aiff`.*`\.aiff`.*4,294,967,303.*32-bit FORM.*even.*4,294,967,302.*exact-size.*not maximum-bounded.*File System Access or Electron/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/integer AIFF.*AIFF-C float.*odd PCM padding.*trailing ID3 metadata.*same encoder geometry.*Desktop.*`\.wav`.*`\.aif`.*`\.aiff`.*canonical.*`\.aiff`/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/BWF.*`audio\/wav`.*`\.wav`.*positive safe-integer.*65 GiB.*plan and encoding.*canonical normalized version-2 BEXT.*int16.*int20.*int24.*rejects.*container.*ADM.*`preDataChunks`.*`trailingChunks`.*BW64.*opaque chunks.*standard BWF metadata.*markers.*iXML.*CART.*`measureLoudness: true`.*fails closed.*before target, preflight, or render.*bounded two-pass.*unimplemented.*no measured-loudness/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/authored BW64.*format and container.*`bw64`.*`audio\/wav`.*`\.wav`.*exact positive safe-integer.*65 GiB.*admission ceiling.*not.*scale.*int16.*int20.*int24.*canonical.*version-2 BEXT.*authored normalized ADM.*mono.*stereo.*5\.1.*bed channel order.*identity preserve mapping.*CHNA before PCM.*AXML after PCM.*byte-identical.*standard RIFF metadata.*markers.*iXML.*CART.*exact geometry.*ADM passthrough.*opaque source chunks.*deferred/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/shared PCM adapter.*16,384-frame chunks.*channel-aware.*32 MiB.*realtime progress.*resamples.*selection-only upmix.*before duplicating.*at-most-4-MiB.*serially awaits.*Exact desktop `audio-pcm-mix`.*four-MiB.*generic exact-size.*project.*one MiB/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/planned.*encoder-finalized.*destination-written.*committed-result.*four-way.*no final renderer `Blob`.*ADM passthrough.*opaque source chunks.*other PCM.*compressed.*video.*stems.*outside/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/385 MiB.*403,701,804-byte RIFF.*SHA-256.*planner.*controller.*16-packet.*32-channel.*32 MiB.*resampler.*WAV encoder.*193 16,384-frame packets.*half-sized final packet.*at most 16 pending packets.*98 destination writes.*header.*4,194,304-byte maximum.*41,943,384-byte.*64 MiB.*zero.*payload\s+retention.*first coalesced 4 MiB PCM destination write/iu,
	);
	assert.match(
		exactDirectPcm.summary,
		/Focused Node BWF.*five cases.*Focused Node authored BW64.*six cases.*closed admission.*canonical.*CHNA.*AXML.*loudness.*four-way.*cancellation.*full maintained Node suite.*382.*Chromium and Firefox.*WAV, AIFF, BWF, and BW64.*eight.*injected File System Access target.*mobile planner profile.*BW64.*33\.1-second.*384 kHz.*16-bit.*101,683,200-byte.*96 MiB.*2 KiB prefix.*8 KiB suffix.*ds64.*BEXT.*CHNA.*data.*AXML.*at-most-4-MiB.*serial.*no Object URL.*browser download.*pre-commit.*WebKit.*unqualified.*host/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/Packaged Soundscaper Linux x64.*Electron 43.*48-kHz.*two-channel.*792,000-frame.*791,999-frame.*6,335,992.*384 kHz.*16 channels.*405,503,488-byte.*384 MiB.*202,751,788 bytes/iu,
	);
	assert.match(
		exactDirectPcm.summary,
		/EOF.*diagnostic SHA-256.*at-most-one-MiB reads.*at-most-31-byte carry.*95,039,880.*zero mismatches.*tolerant signal bounds/iu,
	);
	assert.match(
		exactDirectPcm.summary,
		/33,554,476-byte staging file.*at-most-65,536-byte.*valid-RIFF.*nonzero payload.*cleanup.*no browser download.*CI.*Soundscaper Linux x64.*bypasses the native picker.*385 MiB witness and packaged claims apply to WAV only.*no BWF or BW64 scale.*AIFF, BWF, and BW64.*no packaged, native-picker, heap, RSS, or platform qualification.*65 GiB.*admission.*not.*scale.*quota.*durability.*crash or power loss.*Windows.*macOS.*ARM.*installers.*Framescaper.*other formats.*Electron-runtime-specific.*revisited.*hash is not pinned.*commit-race.*Node-only/iu,
	);

	for (const path of [
		'src/common/editor/controller/direct-aiff-export.ts',
		'src/common/editor/controller/direct-bw64-export.ts',
		'src/common/editor/controller/direct-bwf-export.ts',
		'src/common/editor/controller/direct-export-dispatch.ts',
		'src/common/editor/controller/direct-pcm-export.ts',
		'src/common/editor/controller/direct-wav-export.ts',
		'src/common/editor/controller/export-service.ts',
		'src/common/editor/engine/rendering.ts',
		'src/common/editor/file-save-stream.ts',
		'src/common/editor/pcm-sink.js',
		'desktop/save-targets.js',
		'desktop/direct-wav-smoke.js',
		'scripts/lib/desktop-direct-wav-smoke.mjs',
		'scripts/lib/desktop-direct-wav-smoke-evidence.mjs',
		'tests/audio-editor-export-direct-aiff.test.ts',
		'tests/audio-editor-export-direct-bw64.test.ts',
		'tests/audio-editor-export-direct-bwf.test.ts',
		'tests/audio-editor-export-direct-wav.test.ts',
		'tests/audio-editor-export-direct-wav-reference.test.ts',
		'tests/helpers/direct-pcm-export-fixture.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/audio-editor-pcm-sink.test.js',
		'tests/browser/audio-editor-direct-wav-save.spec.js',
		'tests/desktop-direct-wav-smoke-probe.test.js',
		'tests/desktop-direct-wav-smoke.test.js',
		'tests/desktop-direct-wav-workflow.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(directPcmRollback.evidence.some((item) => item.path === path), path);
	assert.match(
		directPcmRollback.summary,
		/direct WAV, AIFF, BWF, and authored BW64 PCM route.*target before rendering.*owned export task signal.*realtime progress.*at-most-four-MiB.*channel-aware 16,384-frame queue.*32 MiB.*Exact desktop `audio-pcm-mix`.*four-MiB.*generic.*project.*one MiB.*failure or cancellation before commit.*abort.*staging cleanup.*planned.*encoder-finalized.*destination-written.*before.*non-cancellable commit.*ownership.*lost during commit.*committed result.*stale success UI.*post-publication integrity failure.*not.*rollback/iu,
	);
	assert.match(
		directPcmRollback.summary,
		/Node.*AIFF, BWF, and BW64.*mid-stream cancellation.*one abort.*no close.*no commit.*Chromium and Firefox.*WAV, AIFF, BWF, and BW64.*after PCM.*one abort.*no close.*publication.*same pre-commit rollback.*WebKit.*unqualified.*host.*commit-race.*Node-only/isu,
	);
	assert.match(
		directPcmRollback.summary,
		/385 MiB.*first coalesced 4 MiB PCM destination write.*abort.*without close or commit.*partial.*publication/iu,
	);
	assert.match(
		directPcmRollback.summary,
		/Packaged Soundscaper Linux x64.*WAV only.*Electron 43.*33,554,476-byte staging file.*no more than 65,536 bytes.*RIFF.*nonzero payload.*destination is absent.*staging is removed.*no browser download.*bypasses the native picker.*AIFF, BWF, and BW64.*no packaged.*native-picker.*heap.*RSS.*platform qualification.*no BWF or BW64 scale.*commit-race.*Node-only.*crash.*power-loss.*durability.*other platforms.*architectures.*products.*installers.*formats.*unqualified/isu,
	);
});

test('direct PCM documentation records authored BW64 byte, buffering, rollback, and acceptance limits', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(
		documentation,
		/one exact WAV, AIFF, BWF, or authored BW64 mix.*`realtime-stream`.*WAV.*65 GiB.*AIFF.*4,294,967,303.*32-bit FORM.*4,294,967,302.*BWF.*`audio\/wav`.*`\.wav`.*positive safe-integer.*65 GiB.*authored BW64.*format and container.*`bw64`.*65 GiB.*admission ceiling.*not.*scale.*direct File System Access or Electron.*shared PCM route.*16,384-frame chunks.*pending count.*32 MiB.*Realtime progress.*selection-only upmix.*resamples.*before duplicating.*at-most-4-MiB.*serially awaits.*Exact desktop `audio-pcm-mix`.*4 MiB.*generic exact-size.*project.*one MiB/isu,
	);
	assert.match(
		documentation,
		/integer AIFF.*AIFF-C float.*odd PCM padding.*trailing ID3 metadata.*same encoder geometry.*BWF.*plan and encoding.*canonical normalized version-2 BEXT.*int16.*int20.*int24.*container.*ADM.*`preDataChunks`.*`trailingChunks`.*BW64.*opaque chunks.*standard BWF metadata.*markers.*iXML.*CART.*authored BW64.*normalized ADM.*mono.*stereo.*5\.1.*identity preserve mapping.*CHNA before PCM.*AXML after PCM.*byte-identical.*ADM passthrough.*opaque source chunks.*deferred.*`measureLoudness: true`.*fails closed.*before target, preflight, or render.*bounded two-pass.*unimplemented.*no measured-loudness.*planned.*encoder-finalized.*destination-written.*committed-result.*four-way agreement.*without a final renderer `Blob`.*other PCM.*compressed audio.*video.*stems.*existing paths.*non-cancellable commit boundary.*ownership.*lost during commit.*committed result.*stale success UI.*post-publication integrity failure.*not.*rollback/isu,
	);
	assert.match(
		documentation,
		/Focused Node BWF.*five cases.*Focused Node authored BW64.*six cases.*closed admission.*canonical.*CHNA.*AXML.*loudness.*four-way.*cancellation.*full maintained Node suite.*382.*Chromium and Firefox.*WAV, AIFF, BWF, and BW64.*eight.*injected File System Access.*33\.1-second.*384 kHz.*16-bit.*101,683,200-byte.*96 MiB.*2 KiB prefix.*8 KiB suffix.*ds64.*BEXT.*CHNA.*data.*AXML.*at-most-4-MiB.*serial.*no Object URL.*browser download.*pre-commit.*WebKit.*unqualified.*host/isu,
	);
	assert.match(
		documentation,
		/385 MiB.*403,701,804-byte RIFF.*SHA-256.*planner.*controller.*16-packet.*32-channel.*32 MiB.*resampler.*WAV.*193 16,384-frame packets.*half-sized final packet.*at most 16 pending packets.*98 destination writes.*header.*4,194,304-byte maximum.*41,943,384-byte.*64 MiB.*zero.*payload\s+retention.*first coalesced 4 MiB PCM destination write.*browser heap.*process RSS.*unqualified/isu,
	);
	assert.match(
		documentation,
		/Packaged Soundscaper Linux x64.*Electron 43.*48 kHz.*two-channel.*792,000 frames.*791,999-frame.*6,335,992.*384 kHz.*16 channels.*405,503,488-byte.*384 MiB.*202,751,788 bytes/isu,
	);
	assert.match(
		documentation,
		/EOF.*SHA-256.*no larger than one MiB.*diagnostic.*31 bytes.*95,039,880.*zero mismatches.*tolerant non-silence.*positive\/negative.*zero-crossing.*peak.*mean.*RMS/isu,
	);
	assert.match(
		documentation,
		/33,554,476-byte staging file.*no larger than 65,536 bytes.*RIFF geometry.*nonzero payload.*removal.*unpublished destination.*staging file/isu,
	);
	assert.match(
		documentation,
		/browser download.*CI runs.*Soundscaper Linux x64.*bypasses.*native OS picker/isu,
	);
	assert.match(
		documentation,
		/385 MiB witness and packaged evidence.*WAV only.*no BWF or BW64 scale.*AIFF, BWF, and BW64.*no packaged, native-picker, heap, RSS, or platform qualification.*65 GiB.*admission.*not.*scale.*quota.*durability.*crash.*power-loss.*Windows.*macOS.*ARM.*installers.*Framescaper.*other formats.*Electron upgrades.*hash is not pinned.*commit-race.*Node-only/isu,
	);
	assert.match(
		documentation,
		/desktop-write-path-capabilities.*Generic exact-size output.*project-only maximum-bounded output.*one-MiB chunks.*`audio-pcm-mix` sessions alone.*four-MiB chunks/isu,
	);

	const roadmap = await readFile(roadmapUrl, 'utf8');
	assert.match(
		roadmap,
		/Web Enhanced \/ Electron Enhanced — In progress:.*one mix.*format `wav`, `aiff`, `bwf`, or authored\s+`bw64`.*`realtime-stream`.*WAV.*65 GiB.*AIFF.*4,294,967,303.*32-bit FORM.*4,294,967,302.*BWF.*`audio\/wav`.*`\.wav`.*positive safe-integer.*65 GiB.*authored BW64.*format and container.*`bw64`.*65 GiB.*admission ceiling.*not.*scale.*File\s+System Access or Electron.*exact-size writing/isu,
	);
	assert.match(
		roadmap,
		/integer AIFF.*AIFF-C float.*odd PCM padding.*trailing ID3 metadata.*same encoder geometry.*BWF.*plan and encoding.*canonical normalized\s+version-2 BEXT.*int16.*int20.*int24.*container.*ADM.*`preDataChunks`.*`trailingChunks`.*BW64.*opaque chunks.*standard BWF metadata.*markers.*iXML.*CART.*authored BW64.*normalized ADM.*mono.*stereo.*5\.1.*bed channel order.*identity preserve\s+mapping.*CHNA before PCM.*AXML after PCM.*byte-identical.*ADM passthrough.*opaque source chunks.*deferred.*`measureLoudness: true`.*fails closed.*before\s+target,\s+preflight, or render.*bounded two-pass.*unimplemented.*no measured-loudness.*shared PCM.*16,384-frame chunks.*pending-chunk count.*32 MiB.*Realtime\s+render\s+progress.*progress UI.*selection-only upmix.*resamples.*before duplicating.*at-most-4-MiB writes.*serially awaits.*Exact `audio-pcm-mix` Electron sessions.*4 MiB.*generic exact-size.*project saves.*one MiB/isu,
	);
	assert.match(
		roadmap,
		/non-cancellable commit\s+boundary.*ownership lost during commit.*committed result.*stale\s+success UI.*post-publication\s+integrity\s+failure.*not rollback/isu,
	);
	assert.match(
		roadmap,
		/direct route.*without a final\s+renderer-sized `Blob`.*ADM passthrough.*opaque source chunks.*other\s+PCM.*compressed.*audio.*video.*stems.*browser-download.*existing final.*`Blob`/isu,
	);
	assert.match(
		roadmap,
		/Focused\s+Node BWF.*five cases.*Focused Node authored BW64.*six cases.*full maintained Node suite.*382.*Chromium and Firefox.*WAV, AIFF, BWF, and\s+BW64.*eight.*injected File\s+System Access target.*mobile\s+planner\s+profile.*33\.1-second.*384 kHz.*16-bit.*101,683,200-byte.*96 MiB.*2 KiB\s+prefix.*8 KiB\s+suffix.*BW64.*ds64.*BEXT.*CHNA.*data.*AXML.*at-most-4-MiB.*serial.*no Object\s+URL.*after\s+PCM.*abort.*without close.*WebKit.*unqualified.*host.*Packaged Soundscaper Linux x64.*WAV only.*Electron 43/isu,
	);
	assert.match(
		roadmap,
		/385 MiB.*403,701,804-byte RIFF.*SHA-256.*16-packet PCM queue.*32-channel.*32 MiB.*193 16,384-frame packets.*last half-sized.*at most 16 pending packets.*98\s+destination writes.*header.*4,194,304 bytes.*41,943,384-byte.*64 MiB.*zero.*payload\s+retention.*first.*coalesced 4 MiB PCM destination write.*renderer heap.*process RSS.*unqualified/isu,
	);
	assert.match(
		roadmap,
		/792,000 stereo frames.*48 kHz.*791,999 project frames.*6,335,992 frames.*384 kHz.*16 channels.*16-bit PCM.*405,503,488-byte.*384 MiB.*202,751,788 bytes/isu,
	);
	assert.match(
		roadmap,
		/at-most-1-MiB reads.*SHA-256 only as a\s+diagnostic.*31-byte.*95,039,880.*zero mismatches.*tolerant.*33,554,476-byte staging file.*at-most-65,536-byte prefix.*RIFF geometry.*nonzero payload.*removed.*browser download/isu,
	);
	assert.match(
		roadmap,
		/without exercising the OS picker.*385 MiB witness and packaged evidence.*WAV only.*no BWF or BW64\s+scale.*AIFF, BWF, and BW64.*no packaged.*native-picker.*heap.*RSS.*platform qualification.*65 GiB.*admission.*not.*scale.*quota.*durability.*crash.*power-loss.*Windows.*macOS.*ARM.*installers.*Framescaper.*other formats.*Electron upgrades.*hash.*not pinned.*commit-race.*Node-only/isu,
	);
});

function findControl(matrix, riskId, controlId) {
	const risk = matrix.risks.find(({ id }) => id === riskId);
	assert.ok(risk, riskId);
	const control = risk.currentControls.find(({ id }) => id === controlId);
	assert.ok(control, `${riskId}/${controlId}`);
	return control;
}
