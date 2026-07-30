/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const roadmapUrl = new URL('../roadmap.md', import.meta.url);

test('direct PCM security controls stay limited to WAV, AIFF, BWF, and admitted BW64 routes', async () => {
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
		'src/common/editor/wav.js',
		'src/common/editor/export.js',
		'src/common/editor/adm-riff-passthrough.ts',
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
		'tests/audio-editor-bwf-wav.test.js',
		'tests/audio-editor-export-direct-aiff.test.ts',
		'tests/audio-editor-export-direct-bw64.test.ts',
		'tests/audio-editor-export-direct-bw64-passthrough.test.ts',
		'tests/audio-editor-export-direct-bwf.test.ts',
		'tests/audio-editor-export-direct-wav.test.ts',
		'tests/audio-editor-export-direct-wav-reference.test.ts',
		'tests/audio-editor-rf64-wav.test.ts',
		'tests/helpers/direct-pcm-export-fixture.ts',
		'tests/audio-editor-realtime-export-pcm-transform.test.ts',
		'tests/audio-editor-file-service.test.js',
		'tests/audio-editor-pcm-sink.test.js',
		'tests/desktop-pcm-mix-save-purpose.test.js',
		'tests/browser/audio-editor-direct-wav-save.spec.js',
		'tests/browser/audio-editor-direct-bw64-passthrough.spec.js',
		'tests/browser/helpers/direct-pcm-save-target.js',
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
		'tests/audio-editor-export-direct-bw64-passthrough.test.ts',
		'tests/audio-editor-export-direct-bwf.test.ts',
		'tests/browser/audio-editor-direct-wav-save.spec.js',
		'tests/browser/audio-editor-direct-bw64-passthrough.spec.js',
		'tests/browser/helpers/direct-pcm-save-target.js',
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
		/dedicated `audio-pcm-mix` purpose.*WAV, AIFF, BWF, and BW64 target names.*one mix.*`realtime-stream`.*WAV.*`audio\/wav`.*`\.wav`.*65 GiB.*AIFF.*`audio\/aiff`.*`\.aiff`.*4,294,967,303.*32-bit FORM.*odd and unconstructible.*4,294,967,302-byte.*next mono int16 frame.*exact-size.*not maximum-bounded.*File System Access or Electron/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/Classic WAV admission requires.*explicit valid sample rate.*1–32 channels.*nonnegative safe-integer frame count.*non-array object metadata.*marker array.*null-or-object iXML.*CART exactly null.*canonical.*`sampleFormat`.*`bitDepth`.*`floatingPoint`.*`int16`.*16.*false.*`int20`.*20.*false.*`int24`.*24.*false.*`float32`.*32.*true.*automatic RIFF\/RF64 geometry.*`inspectWavLayout`.*same sample rate.*channel count.*frame count.*integer precision or float flag.*metadata.*markers.*iXML.*exact planned byte count.*Malformed or stale fields and layouts reject before target selection.*explicit container.*BEXT.*ADM.*`preDataChunks`.*`trailingChunks`.*non-null CART.*Classic RIFF.*word-aligns odd PCM.*largest constructible RIFF.*4,294,967,302 bytes.*next mono int16 frame.*RF64.*4,294,967,340 bytes.*Layout-only witnesses allocate no PCM or output bytes.*69,793,218,560-byte.*65 GiB.*rejecting the next frame.*not.*WAV scale, package, heap, or RSS qualification/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/AIFF.*Direct admission requires.*explicit valid sample rate.*1–32 channels.*zero through 4,294,967,295 output frames.*non-array object metadata.*canonical.*`sampleFormat`.*`bitDepth`.*`floatingPoint`.*`int16`.*16.*false.*`int24`.*24.*false.*`int32`.*32.*false.*`float32`.*32.*true.*`inspectAiffLayout`.*same layout-affecting encoder options.*AIFF for integer PCM.*AIFF-C for float32.*exact byte count.*plan.*Malformed or stale fields and layouts reject before target selection.*layout-only witness.*allocates no PCM or output bytes.*largest current constructible 4,294,967,302-byte layout.*next mono int16 frame/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/integer AIFF.*AIFF-C float.*odd PCM padding.*trailing ID3 metadata.*same encoder geometry.*Desktop.*`\.wav`.*`\.aif`.*`\.aiff`.*canonical.*`\.aiff`/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/BWF.*`audio\/wav`.*`\.wav`.*positive safe-integer.*65 GiB.*plan and encoding.*canonical normalized version-2 BEXT.*int16.*int20.*int24.*rejects.*container.*ADM.*`preDataChunks`.*`trailingChunks`.*BW64.*opaque chunks.*rich standard BWF metadata.*markers.*iXML.*CART.*exact geometry.*`measureLoudness: true`.*fails closed.*before target, preflight, or render.*bounded two-pass.*unimplemented.*no measured-loudness/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/BWF.*Admission requires.*explicit valid sample rate.*1–32 channels.*nonnegative safe-integer frame count.*object metadata.*marker array.*null-or-object iXML and CART.*automatic RIFF\/RF64 layout.*`inspectWavLayout`.*same encoder options used by streaming.*sample rate.*channel count.*frame count.*integer precision.*BEXT.*metadata.*markers.*iXML.*CART.*rejects malformed fields.*planned-byte mismatch.*before target selection.*layout-only witness.*allocates no PCM or output bytes.*exact constructible 69,793,218,560-byte.*65 GiB.*RF64 boundary.*rejecting the next frame.*admission ceiling.*not BWF scale, package, heap, or RSS qualification/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/authored BW64.*format and container.*`bw64`.*`audio\/wav`.*`\.wav`.*exact positive safe-integer.*65 GiB.*admission ceiling.*not.*scale.*int16.*int20.*int24.*canonical.*version-2 BEXT.*authored normalized ADM.*mono.*stereo.*5\.1.*bed channel order.*identity preserve mapping.*CHNA before PCM.*AXML after PCM.*byte-identical.*standard RIFF metadata.*markers.*iXML.*CART.*exact geometry/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/pristine-passthrough BW64.*current BW64 importer.*pristine planner.*valid warning-free ADM.*unchanged neutral full-range source path.*import revision.*nonempty complete `riffChunkSequence`.*aggregate complete nonstructural RIFF bytes.*headers and alignment bytes.*16 MiB.*1–32 channels.*int16.*int20.*int24.*non-float PCM.*exact rate, channel, frame, and precision geometry.*zero tail and dither.*full range.*identity preserve mappings.*CHNA-derived channel order.*exact compacted pre\/post bytes, order, and placement.*`plan\.adm`.*top-level plan.*`inspectWavLayout`.*65 GiB/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/preserved BEXT.*only from the sequence.*without one.*same canonical normalized version-2 BEXT.*Preserved cue\/adtl.*iXML.*CART.*ID3.*LIST\/INFO.*suppress.*collisions reject.*Legacy `opaqueRiffChunks`-only.*incomplete capture.*invalid or warning-bearing.*stale or edited projects.*sequence drift.*mapping or geometry drift.*loudness measurement.*before target selection.*byte-exact claim.*preserved nonstructural chunks only.*structural BW64 and PCM bytes are rebuilt.*not whole-file bit identity.*broad third-party BW64 qualification/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/shared PCM adapter.*16,384-frame chunks.*channel-aware.*32 MiB.*realtime progress.*resamples.*selection-only upmix.*before duplicating.*at-most-4-MiB.*serially awaits.*Exact desktop `audio-pcm-mix`.*four-MiB.*generic exact-size.*project.*one MiB/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/planned.*encoder-finalized.*destination-written.*committed-result.*four-way.*no final renderer `Blob`.*BW64 passthrough outside the exact current-import contract.*legacy opaque-only metadata.*other PCM.*compressed.*video.*stems.*outside/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/385 MiB.*403,701,804-byte RIFF.*SHA-256.*planner.*controller.*16-packet.*32-channel.*32 MiB.*resampler.*WAV encoder.*193 16,384-frame packets.*half-sized final packet.*at most 16 pending packets.*98 destination writes.*header.*4,194,304-byte maximum.*41,943,384-byte.*64 MiB.*zero.*payload\s+retention.*first coalesced 4 MiB PCM destination write/iu,
	);
	assert.match(
		exactDirectPcm.summary,
		/Focused\s+Node AIFF evidence.*four cases.*exact FORM and metadata geometry.*all four canonical encoding tuples.*malformed and stale layout refusal.*before target selection.*4,294,967,302-byte constructible boundary.*next-frame refusal.*without PCM or output allocation.*realtime direct publication.*picker cancellation.*mid-stream rollback.*Focused Node BWF.*five cases.*Focused Node authored BW64.*six cases.*closed admission.*canonical.*CHNA.*AXML.*loudness.*four-way.*cancellation.*Seven focused pristine-passthrough BW64.*real current-import-to-planner.*preserved and generated BEXT.*nonstructural chunk bytes\/order\/placement and publication.*closed admission.*modeled-metadata collision refusal.*stale or edited planning refusal.*loudness fail-closed.*383 test files/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/Focused Node WAV evidence has twelve cases.*exact RIFF\/RF64 and rich-metadata geometry.*all four canonical encoding tuples.*malformed and stale layout refusal before target selection.*required odd-PCM RIFF padding.*4,294,967,302-byte constructible RIFF boundary.*4,294,967,340-byte RF64 transition.*exact 65 GiB boundary.*next-frame refusal without PCM or output allocation.*realtime publication and Blob fallback.*shared write bounds.*cancellation.*four-way byte agreement.*cleanup.*commit ownership/isu,
	);
	assert.match(
		exactDirectPcm.summary,
		/Chromium and Firefox.*ten aggregate format\/engine cases.*injected File System Access target.*mobile planner profile.*pristine-passthrough case.*5\.1.*48 kHz.*16-bit BW64.*4,210,688 frames.*101,056,512-byte.*2 KiB prefix.*4 KiB suffix.*JUNK padding.*BEXT v2.*CHNA.*before PCM.*PEAK padding.*AXML.*after PCM.*Visible realtime progress.*close, commit, and publication.*without Object URL or browser-download fallback.*second export cancels.*one abort without close, commit, or publication.*at most 4 MiB.*serial.*1\.7 and 1\.8 minutes.*not arbitrary third-party.*legacy opaque-only BW64.*edited projects.*whole-file bit identity.*WebKit.*unqualified/isu,
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
		'tests/browser/audio-editor-direct-bw64-passthrough.spec.js',
		'tests/browser/helpers/direct-pcm-save-target.js',
		'tests/desktop-direct-wav-smoke-probe.test.js',
		'tests/desktop-direct-wav-smoke.test.js',
		'tests/desktop-direct-wav-workflow.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(directPcmRollback.evidence.some((item) => item.path === path), path);
	assert.match(
		directPcmRollback.summary,
		/direct WAV, AIFF, BWF, and admitted BW64 PCM route.*target before rendering.*owned export task signal.*realtime progress.*at-most-four-MiB.*channel-aware 16,384-frame queue.*32 MiB.*Exact desktop `audio-pcm-mix`.*four-MiB.*generic.*project.*one MiB.*failure or cancellation before commit.*abort.*staging cleanup.*planned.*encoder-finalized.*destination-written.*before.*non-cancellable commit.*ownership.*lost during commit.*committed result.*stale success UI.*post-publication integrity failure.*not.*rollback/iu,
	);
	assert.match(
		directPcmRollback.summary,
		/Node.*AIFF, BWF, and BW64.*mid-stream cancellation.*one abort.*no close.*no commit.*ten Chromium and Firefox.*WAV, AIFF, BWF, and BW64.*after PCM.*one abort.*no close, commit, or publication.*same pre-commit rollback.*current-import pristine-passthrough BW64.*visible progress.*completed publication.*without Blob fallback.*cancellation run aborts without publication.*not qualify arbitrary third-party.*legacy opaque-only BW64.*edited projects.*whole-file identity.*WebKit.*unqualified.*host.*commit-race.*Node-only/isu,
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

test('direct PCM documentation records admitted BW64 byte, buffering, rollback, and acceptance limits', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const documentation = await readFile(new URL(`../${matrix.modelDocument}`, import.meta.url), 'utf8');
	assert.match(
		documentation,
		/one exact WAV, AIFF, BWF, or BW64 mix.*`realtime-stream`.*WAV.*65 GiB.*AIFF.*4,294,967,303.*32-bit FORM.*4,294,967,302.*BWF.*`audio\/wav`.*`\.wav`.*positive safe-integer.*65 GiB.*Authored BW64.*format and container.*`bw64`.*65 GiB.*admission ceiling.*not.*scale.*direct File System Access or Electron.*shared PCM route.*16,384-frame chunks.*pending count.*32 MiB.*Realtime progress.*selection-only upmix.*resamples.*before duplicating.*at-most-4-MiB.*serially awaits.*Exact desktop `audio-pcm-mix`.*4 MiB.*generic exact-size.*project.*one MiB/isu,
	);
	assert.match(
		documentation,
		/Classic WAV admission requires.*positive safe-integer sample rate.*4,294,967,295.*1–32 channels.*nonnegative safe-integer frame count.*non-array object metadata.*marker array.*null-or-object iXML.*CART exactly null.*canonical.*`sampleFormat`.*`bitDepth`.*`floatingPoint`.*`int16`.*16.*false.*`int20`.*20.*false.*`int24`.*24.*false.*`float32`.*32.*true.*explicit container.*BEXT.*ADM.*`preDataChunks`.*`trailingChunks`.*before target selection.*`inspectWavLayout`.*automatic container selection.*same sample rate.*channel count.*frame count.*encoding.*metadata.*markers.*iXML.*Only RIFF or RF64.*exact agreement.*Odd PCM RIFF data.*word-padded.*largest constructible RIFF.*4,294,967,302 bytes.*next mono int16 frame.*RF64.*4,294,967,340 bytes.*69,793,218,560-byte.*65 GiB.*rejecting the next frame.*not WAV scale, package, heap, or RSS qualification/isu,
	);
	assert.match(
		documentation,
		/AIFF.*Direct admission requires.*explicit valid sample rate.*1–32 channels.*zero through 4,294,967,295 output frames.*non-array object metadata.*canonical.*`sampleFormat`.*`bitDepth`.*`floatingPoint`.*`int16`.*16.*false.*`int24`.*24.*false.*`int32`.*32.*false.*`float32`.*32.*true.*`inspectAiffLayout`.*same layout-affecting encoder options.*AIFF for integer PCM.*AIFF-C for float32.*exact byte count.*plan.*Malformed or stale fields and layouts reject before target selection.*4,294,967,303-byte theoretical maximum.*odd and unconstructible.*layout-only witness.*allocates no PCM or output bytes.*4,294,967,302-byte layout.*next mono int16 frame/isu,
	);
	assert.match(
		documentation,
		/integer AIFF.*AIFF-C float.*odd PCM padding.*trailing ID3 metadata.*same encoder geometry.*BWF.*plan and encoding.*canonical normalized version-2 BEXT.*int16.*int20.*int24.*container.*ADM.*`preDataChunks`.*`trailingChunks`.*BW64.*opaque chunks.*rich standard BWF metadata.*markers.*iXML.*CART.*exact geometry.*Authored BW64.*normalized ADM.*mono.*stereo.*5\.1.*identity preserve mapping.*CHNA before PCM.*AXML after PCM.*byte-identical.*`measureLoudness: true`.*fails closed.*before target, preflight, or render.*bounded two-pass.*unimplemented.*no measured-loudness.*planned.*encoder-finalized.*destination-written.*committed-result.*four-way agreement.*without a final renderer `Blob`.*BW64 passthrough outside the exact current-import contract.*legacy opaque-only metadata.*other PCM.*compressed audio.*video.*stems.*existing paths.*non-cancellable commit boundary.*ownership.*lost during commit.*committed result.*stale success UI.*post-publication integrity failure.*not.*rollback/isu,
	);
	assert.match(
		documentation,
		/BWF.*Admission requires.*explicit valid sample rate.*1–32 channels.*nonnegative safe-integer frame count.*object metadata.*marker array.*null-or-object iXML and CART.*automatic RIFF\/RF64 layout.*`inspectWavLayout`.*same encoder options used by streaming.*sample rate.*channel count.*frame count.*integer precision.*BEXT.*metadata.*markers.*iXML.*CART.*rejects malformed fields.*planned-byte mismatch.*before target selection.*layout-only witness.*allocates no PCM or output bytes.*exact constructible 69,793,218,560-byte.*65 GiB.*RF64 boundary.*rejecting the next frame.*admission ceiling.*not BWF scale, package, heap, or RSS qualification/isu,
	);
	assert.match(
		documentation,
		/pristine-passthrough BW64 route.*current BW64 importer.*pristine planner.*valid warning-free ADM.*unchanged neutral full-range source path.*import revision.*nonempty complete `riffChunkSequence`.*aggregate complete nonstructural RIFF bytes.*headers and alignment bytes.*16 MiB.*1–32 channels.*int16.*int20.*int24.*non-float PCM.*exact rate, channel, frame, and precision geometry.*zero tail and dither.*full range.*identity preserve mappings.*CHNA-derived channel order.*exact compacted pre\/post bytes, order, and placement.*`plan\.adm`.*top-level plan.*`inspectWavLayout`.*65 GiB/isu,
	);
	assert.match(
		documentation,
		/preserved BEXT.*only from the sequence.*without one.*same canonical normalized version-2 BEXT.*Preserved cue\/adtl.*iXML.*CART.*ID3.*LIST\/INFO.*suppress.*collisions reject.*Legacy `opaqueRiffChunks`-only.*incomplete capture.*invalid or warning-bearing.*stale or edited projects.*sequence drift.*mapping or geometry drift.*loudness measurement.*before target selection.*byte-exact claim.*preserved nonstructural chunks only.*structural BW64 and PCM bytes are rebuilt.*not whole-file bit identity.*broad third-party BW64 qualification/isu,
	);
	assert.match(
		documentation,
		/Focused\s+Node AIFF evidence.*four cases.*exact FORM and metadata geometry.*all four canonical encoding tuples.*malformed and stale layout refusal.*before target selection.*4,294,967,302-byte constructible boundary.*next-frame refusal.*without PCM or output allocation.*realtime direct publication.*picker cancellation.*mid-stream rollback.*Focused Node BWF.*five cases.*Focused Node authored BW64.*six cases.*closed admission.*canonical.*CHNA.*AXML.*loudness.*four-way.*cancellation.*Seven focused pristine-passthrough BW64.*real current-import-to-planner.*preserved and generated BEXT.*nonstructural chunk bytes\/order\/placement and publication.*closed admission.*modeled-metadata collision refusal.*stale or edited planning refusal.*loudness fail-closed.*383 test files/isu,
	);
	assert.match(
		documentation,
		/Focused 12-case Node WAV evidence covers exact classic RIFF\/RF64 admission and encoder geometry.*all four canonical encoding tuples.*rich metadata.*markers.*iXML.*correct odd PCM RIFF padding.*malformed or stale route refusal before target selection.*exact RIFF-to-RF64 and 65 GiB boundaries.*without PCM or output allocation.*realtime publication.*bounded writes and queueing.*Blob fallback.*cancellation.*four-way byte accounting.*cleanup.*commit ownership/isu,
	);
	assert.match(
		documentation,
		/Chromium and Firefox WAV, AIFF, BWF, and BW64.*ten aggregate format\/engine cases.*injected File System Access.*pristine-passthrough case.*5\.1.*48 kHz.*16-bit BW64.*4,210,688 frames.*101,056,512-byte.*2 KiB prefix.*4 KiB suffix.*JUNK padding.*BEXT v2.*CHNA.*before PCM.*PEAK padding.*AXML.*after PCM.*Visible realtime progress.*close, commit, and publication.*without Object URL or browser-download fallback.*second export cancels.*one abort without close, commit, or publication.*at most 4 MiB.*serial.*1\.7 and 1\.8 minutes.*not arbitrary third-party.*legacy opaque-only BW64.*edited projects.*whole-file bit identity.*WebKit.*unqualified/isu,
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
		/Web Enhanced \/ Electron Enhanced — In progress:.*one mix.*format `wav`, `aiff`, `bwf`, or `bw64`.*`realtime-stream`.*WAV.*65 GiB.*AIFF.*4,294,967,303.*32-bit FORM.*4,294,967,302.*BWF.*`audio\/wav`.*`\.wav`.*positive safe-integer.*65 GiB.*authored BW64.*format and container `bw64`.*65 GiB.*admission ceiling.*not.*scale.*File\s+System Access or Electron.*exact-size writing/isu,
	);
	assert.match(
		roadmap,
		/Classic WAV admission requires.*positive safe-integer sample rate.*4,294,967,295.*1–32\s+channels.*nonnegative safe-integer frame count.*non-array object metadata.*marker array.*null-or-object iXML.*CART exactly null.*canonical.*`sampleFormat`.*`bitDepth`.*`floatingPoint`.*`int16`.*16.*false.*`int20`.*20.*false.*`int24`.*24.*false.*`float32`.*32.*true.*explicit container.*BEXT.*ADM.*`preDataChunks`.*`trailingChunks`.*before target selection.*`inspectWavLayout`.*automatic container selection.*same sample.*channel count.*frame count.*encoding.*metadata.*markers.*iXML.*Only RIFF or RF64.*exact agreement.*Odd PCM RIFF data.*word-padded.*largest\s+constructible RIFF.*4,294,967,302 bytes.*next mono int16.*RF64.*4,294,967,340 bytes.*69,793,218,560-byte.*65 GiB.*rejecting the next frame.*not WAV scale, package, heap, or RSS\s+qualification/isu,
	);
	assert.match(
		roadmap,
		/AIFF.*Direct admission requires.*explicit valid\s+sample rate.*1–32 channels.*zero through 4,294,967,295 output frames.*non-array object metadata.*canonical.*`sampleFormat`.*`bitDepth`.*`floatingPoint`.*`int16`.*16.*false.*`int24`.*24.*false.*`int32`.*32.*false.*`float32`.*32.*true.*`inspectAiffLayout`.*same\s+layout-affecting encoder options.*AIFF for integer PCM.*AIFF-C for\s+float32.*recomputed and\s+planned byte counts.*agree.*Malformed or stale fields and layouts reject before target selection.*4,294,967,303-byte theoretical maximum.*odd and unconstructible.*layout-only witness.*allocates no PCM or output\s+bytes.*4,294,967,302-byte.*next mono int16 frame/isu,
	);
	assert.match(
		roadmap,
		/BWF.*plan and encoding.*canonical\s+normalized\s+version-2 BEXT.*int16.*int20.*int24.*container.*ADM.*`preDataChunks`.*`trailingChunks`.*BW64.*opaque chunks.*rich standard BWF metadata.*markers.*iXML.*CART.*exact\s+geometry.*authored BW64.*normalized ADM.*mono.*stereo.*5\.1.*bed channel order.*identity preserve\s+mapping.*CHNA before PCM.*AXML after PCM.*byte-identical.*`measureLoudness: true`.*fails closed.*before\s+target,\s+preflight, or render.*bounded two-pass.*unimplemented.*no measured-loudness.*shared PCM.*16,384-frame chunks.*pending-chunk count.*32 MiB.*Realtime\s+render\s+progress.*progress UI.*selection-only upmix.*resamples.*before duplicating.*at-most-4-MiB writes.*serially awaits.*Exact `audio-pcm-mix` Electron sessions.*4 MiB.*generic exact-size.*project saves.*one MiB/isu,
	);
	assert.match(
		roadmap,
		/BWF.*Admission requires.*explicit valid sample rate.*1–32 channels.*nonnegative safe-integer frame count.*object metadata.*marker array.*null-or-object iXML and CART.*automatic RIFF\/RF64 layout.*`inspectWavLayout`.*same encoder options used by streaming.*sample\s+rate.*channel count.*frame count.*integer precision.*BEXT.*metadata.*markers.*iXML.*CART.*rejects malformed fields.*planned-byte mismatch.*before\s+target selection.*layout-only witness.*allocates no PCM or output bytes.*exact\s+constructible 69,793,218,560-byte.*65 GiB.*RF64\s+boundary.*rejecting the next frame.*admission ceiling.*not\s+BWF scale, package, heap, or RSS qualification/isu,
	);
	assert.match(
		roadmap,
		/pristine-passthrough BW64 route.*current BW64 importer.*pristine\s+planner.*valid warning-free ADM.*unchanged neutral full-range source path.*import revision.*nonempty complete `riffChunkSequence`.*aggregate complete nonstructural RIFF chunk bytes.*headers and\s+alignment bytes.*16 MiB.*1–32\s+channels.*int16.*int20.*int24.*non-float PCM.*sample-rate, channel,\s+frame, and precision geometry.*zero tail and dither.*full range.*identity\s+preserve mappings.*CHNA-derived channel order.*exact\s+compacted pre\/post chunk bytes, order, and placement.*`plan\.adm`.*top-level plan.*`inspectWavLayout`.*65 GiB/isu,
	);
	assert.match(
		roadmap,
		/preserved BEXT.*only from the sequence.*without one.*same canonical normalized\s+version-2 BEXT.*Preserved cue\/adtl.*iXML.*CART.*ID3.*LIST\/INFO.*suppress.*collisions reject.*Legacy\s+`opaqueRiffChunks`-only.*incomplete capture.*invalid or warning-bearing.*stale or edited projects.*sequence drift.*mapping or geometry drift.*loudness measurement.*before target selection.*Byte exactness.*preserved nonstructural chunks only.*BW64 structure and PCM are rebuilt.*not whole-file bit identity.*broad third-party BW64 qualification/isu,
	);
	assert.match(
		roadmap,
		/non-cancellable commit\s+boundary.*ownership lost during commit.*committed result.*stale\s+success UI.*post-publication\s+integrity\s+failure.*not rollback/isu,
	);
	assert.match(
		roadmap,
		/direct route.*without a final\s+renderer-sized `Blob`.*BW64 passthrough outside the exact current-import\s+contract.*legacy opaque-only metadata.*other\s+PCM.*compressed.*audio.*video.*stems.*browser-download.*existing final.*`Blob`/isu,
	);
	assert.match(
		roadmap,
		/Focused\s+Node AIFF evidence.*four cases.*exact FORM and metadata geometry.*all four canonical encoding tuples.*malformed and\s+stale layout refusal.*before target selection.*4,294,967,302-byte\s+constructible boundary.*next-frame refusal.*without PCM or output\s+allocation.*realtime direct publication.*picker cancellation.*mid-stream\s+rollback.*Focused\s+Node BWF.*five cases.*Focused Node authored BW64.*six cases.*seven focused pristine-passthrough BW64 cases.*real\s+current-import-to-planner route.*preserved and generated BEXT.*nonstructural chunk bytes\/order\/placement and publication.*modeled-metadata collision refusal.*stale or edited planning refusal.*383 test files.*Chromium and Firefox.*WAV, AIFF, BWF, and\s+BW64.*ten format\/engine cases.*injected File\s+System Access target.*pristine-passthrough case.*5\.1.*48 kHz.*16-bit BW64.*4,210,688 frames.*101,056,512-byte.*2 KiB prefix.*4 KiB suffix.*JUNK padding.*BEXT v2.*CHNA.*before PCM.*PEAK padding.*AXML.*after PCM.*Visible realtime progress.*close, commit, and publication.*no Object URL.*second export cancels.*one abort without close, commit, or publication.*1\.7 and 1\.8 minutes.*WebKit.*unqualified.*host.*arbitrary third-party.*legacy opaque-only BW64.*edited\s+projects.*whole-file bit identity/isu,
	);
	assert.match(
		roadmap,
		/Focused\s+12-case Node WAV evidence covers exact classic RIFF\/RF64 admission.*all four canonical encoding tuples.*rich metadata.*markers.*iXML.*correct odd PCM RIFF padding.*malformed or stale route\s+refusal before target selection.*exact RIFF-to-RF64 and 65 GiB.*without PCM or output allocation.*realtime publication.*bounded\s+writes and queueing.*Blob fallback.*cancellation.*four-way byte accounting.*cleanup.*commit ownership/isu,
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
