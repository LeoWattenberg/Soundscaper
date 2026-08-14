/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The end-to-end assistance path against the real mirror and the real runtime:
 * catalog, download, content-addressed store, recognition, transcript in
 * sample frames, and cleanup proposals.
 *
 * It self-skips by default. It downloads roughly 630 MiB from the product
 * store and needs the optional speech runtime installed, so it cannot run in
 * the canonical gate; the unit suites cover the same logic with fixtures.
 *
 *   SOUNDSCAPER_ASSISTANCE_REFERENCE=1 node --import tsx --test \
 *     tests/desktop-assistance-speech-reference.test.ts
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSherpaRecognizerFactory } from '../desktop/assistance-sherpa-recognizer.ts';
import { createSpeechRuntimeAdapter } from '../desktop/assistance-speech-runtime.ts';
import { downloadLocalModelArtifact } from '../desktop/local-model-download.ts';
import { FileLocalModelStore } from '../desktop/local-model-store.ts';
import {
	acceptedProposalFrames,
	acceptedProposalRanges,
	findDisfluencyProposals,
} from '../src/common/editor/assistance/disfluency.ts';
import { ingestRecognitionResult } from '../src/common/editor/assistance/transcript-ingest.ts';

const ENABLED = process.env.SOUNDSCAPER_ASSISTANCE_REFERENCE === '1';
const AUDIO_PATH = process.env.SOUNDSCAPER_ASSISTANCE_REFERENCE_AUDIO ?? '';
const MODEL_ID = 'parakeet-tdt-0.6b-v2';

interface CatalogArtifact {
	readonly fileName: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly url: string;
}

test('the assistance path runs from the product mirror to cleanup proposals', {
	skip: ENABLED ? false : 'set SOUNDSCAPER_ASSISTANCE_REFERENCE=1 to run',
	timeout: 900_000,
}, async (t) => {
	assert.ok(AUDIO_PATH, 'SOUNDSCAPER_ASSISTANCE_REFERENCE_AUDIO must name a 16 kHz mono wav');

	const catalog = JSON.parse(String(await readFile(
		new URL('../config/local-model-catalog.json', import.meta.url),
	))) as { entries: { modelId: string; version: string; artifacts: CatalogArtifact[] | null }[] };
	const entry = catalog.entries.find((candidate) => candidate.modelId === MODEL_ID);
	assert.ok(entry?.artifacts, `${MODEL_ID} must be recorded as mirrored`);

	const root = await mkdtemp(join(tmpdir(), 'scape-assistance-reference-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const store = new FileLocalModelStore(root);
	await store.initialize();

	for (const artifact of entry.artifacts) {
		await downloadLocalModelArtifact({ store, artifact, url: artifact.url });
	}
	const installed = await store.commitInstall({
		modelId: entry.modelId, version: entry.version, artifacts: entry.artifacts,
	});
	assert.equal(installed.artifacts.length, entry.artifacts.length);

	const paths = Object.fromEntries(entry.artifacts.map((artifact) => [
		artifact.fileName.split('.')[0] as string, store.blobPath(artifact.sha256),
	])) as Record<string, string>;

	const adapter = createSpeechRuntimeAdapter({
		createFactory: (runtime) => createSherpaRecognizerFactory(runtime, { numThreads: 4 }),
	});
	assert.equal((await adapter.status()).available, true, 'the optional runtime must be installed');

	const recognition = await adapter.recognize({
		audioPath: AUDIO_PATH,
		model: {
			encoder: paths.encoder as string,
			decoder: paths.decoder as string,
			joiner: paths.joiner as string,
			tokens: paths.tokens as string,
		},
	});

	const { transcript, conformedBoundaries } = ingestRecognitionResult(recognition, {
		sourceId: 'reference', sampleRate: 48_000, modelId: MODEL_ID,
	});
	const [segment] = transcript.segments;
	assert.ok(segment, 'the reference clip transcribes to at least one segment');
	assert.ok(segment.words.length > 0, 'the decode carries word timing');
	assert.equal(conformedBoundaries, 0, 'a clean decode needs no conforming');
	for (const word of segment.words) {
		assert.ok(Number.isSafeInteger(word.startFrame) && word.startFrame >= 0);
		assert.ok(word.endFrame >= word.startFrame);
	}

	const proposals = findDisfluencyProposals(transcript, { fillerLexicon: ['um', 'uh'] });
	const ranges = acceptedProposalRanges(proposals, proposals.map(({ id }) => id));
	assert.equal(acceptedProposalFrames(ranges) >= 0, true);

	const reclaimed = await store.removeModel(MODEL_ID);
	assert.equal(reclaimed, installed.totalBytes, 'removal reclaims exactly what was installed');
	assert.deepEqual(await store.listInstalled(), []);
});
