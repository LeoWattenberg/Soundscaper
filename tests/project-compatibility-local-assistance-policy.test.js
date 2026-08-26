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
		/reviewed.*Parakeet transcripts and link-aware cleanup.*Silero silences.*anonymous Pyannote.*ERes2Net speaker regions.*external-FFmpeg shot markers.*unavailable.*non-authoritative/isu);
	assert.match(localAssistance.currentBehavior,
		/four.*closed operations.*Parakeet.*Silero.*Pyannote.*ERes2Net.*external FFmpeg.*remaining eleven.*typed unavailable/isu);
	assert.match(localAssistance.currentBehavior,
		/content-addressed transcript-v1.*ordinary label track.*Silences.*anonymous Speakers.*timeline annotations.*link-aware.*track-ripple-delete.*A\/V link membership.*no assistance asset/isu);
	assert.match(localAssistance.currentBehavior,
		/manual.*owner-lab qualification.*neither disables.*nor relaxes.*hard gate/isu);
	for (const reference of [
		'desktop/assistance-operation-service.ts',
		'desktop/assistance-sherpa-vad.ts',
		'desktop/assistance-sherpa-diarizer.ts',
		'desktop/assistance-external-ffmpeg-shot-runtime.ts',
		'src/common/editor/controller/local-assistance-range-label-acceptance.ts',
		'src/common/editor/controller/local-assistance-shot-acceptance.ts',
		'src/common/editor/controller/local-assistance-cleanup-acceptance.ts',
	]) assert.ok(localAssistance.evidence.includes(reference), reference);
});
