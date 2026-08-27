/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('compatibility policy records bounded local-assistance activation', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const localAssistance = policy.rules.find(
		(rule) => rule.id === 'current-local-assistance-transcript-custody',
	);
	assert.ok(localAssistance);
	assert.match(localAssistance.requiredOutcome,
		/reviewed.*aggregate-fenced AssistanceWorkflow.*disposable derivatives.*deterministic non-assistance editing.*model.*runtime.*platform.*publication evidence non-authoritative/isu);
	assert.match(localAssistance.currentBehavior,
		/thirteen Guided recipes.*fifteen primitives.*Parakeet.*Silero VAD.*Pyannote-plus-ERes2Net.*external-FFmpeg fast shots.*remain executable/isu);
	assert.match(localAssistance.currentBehavior,
		/Whisper.*wav2vec2 alignment.*DeepFilterNet.*TIGER.*PANNs.*Beat This.*TransNetV2.*nomic.*SigLIP.*PP-OCR.*YuNet.*D-FINE.*ByteTrack.*U2-Net.*Qwen/isu);
	assert.match(localAssistance.currentBehavior,
		/aggregate fence.*revalidated before disposable publication.*before acceptance.*typed unavailability.*without implicit installation.*canonical mutation/isu);
	assert.match(localAssistance.currentBehavior,
		/transcript and caption replacement.*link-aware cleanup.*anonymous speakers.*D\/M\/E media.*beats.*tempo.*shot annotations.*crop and keyframes.*highlight sequences/isu);
	assert.match(localAssistance.currentBehavior,
		/pending-external.*gates remain fail closed.*manual and owner-lab qualification.*documentary.*nonblocking/isu);
	for (const reference of [
		'src/common/editor/assistance/workflow.ts',
		'src/common/editor/assistance/owned-highlight-workflow-transforms-v1.ts',
		'desktop/assistance-workflow-service.ts',
		'desktop/assistance-runtime-family-host.ts',
		'desktop/assistance-operation-service.ts',
		'desktop/assistance-sherpa-vad.ts',
		'desktop/assistance-sherpa-diarizer.ts',
		'desktop/assistance-external-ffmpeg-shot-runtime.ts',
		'src/common/editor/controller/local-assistance-range-label-acceptance.ts',
		'src/common/editor/controller/local-assistance-shot-acceptance.ts',
		'src/common/editor/controller/local-assistance-cleanup-acceptance.ts',
	]) assert.ok(localAssistance.evidence.includes(reference), reference);
});
