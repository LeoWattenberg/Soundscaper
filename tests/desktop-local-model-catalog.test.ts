/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { canonicalJson, localModelEvidenceSha256 } from '../desktop/local-model-catalog-signature.ts';
import {
	catalogEntryDownloadBytes,
	describeModelAvailability,
	LOCAL_MODEL_CATALOG_SCHEMA_VERSION,
	plannedMirrorLocation,
	validateLocalModelCatalog as validateCatalog,
} from '../desktop/local-model-catalog.ts';

const catalogUrl = new URL('../config/local-model-catalog.json', import.meta.url);
const matrixUrl = new URL('../config/production-licensing-matrix.json', import.meta.url);

const GIB = 1024 ** 3;
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const TEST_KEY_ID = 'local-model-catalog-test';
const TEST_SIGNATURE_OPTIONS = Object.freeze({
	trustedKeys: Object.freeze({
		[TEST_KEY_ID]: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
	}),
});

async function readJson(url: URL): Promise<Record<string, unknown>> {
	return JSON.parse(String(await readFile(url)));
}

function evidenceFor(id: string, distributionStatus = 'permitted'): Record<string, unknown> {
	return {
		id,
		distributionStatus,
		blockedBy: distributionStatus === 'permitted' ? [] : ['weights-and-code-license-review'],
		requirements: {
			'weights-and-code-license-review': { status: 'recorded', summary: 'Test evidence.' },
		},
		evidence: ['tests/desktop-local-model-catalog.test.ts'],
	};
}

const UPSTREAM_ARTIFACT = Object.freeze({
	fileName: 'model.onnx',
	byteLength: 1_000,
	sha256: 'a'.repeat(64),
	url: 'https://upstream.invalid/model.onnx',
});

function upstreamOf(artifacts: unknown[] = [UPSTREAM_ARTIFACT]): unknown {
	return { source: 'https://upstream.invalid/repo', revision: 'abc123', artifacts };
}

/** Loosely typed on purpose: these fixtures probe runtime rejection. */
function entry(overrides: Record<string, unknown> = {}): unknown {
	const modelId = typeof overrides.modelId === 'string' ? overrides.modelId : 'silero-vad-v6';
	const record = evidenceFor(modelId);
	return {
		modelId,
		version: '6.2.1',
		task: 'voice-activity-detection',
		platforms: ['linux-x64'],
		minimumMemoryBytes: 2 * GIB,
		licensingEvidence: { id: modelId, sha256: localModelEvidenceSha256(record) },
		upstream: upstreamOf(),
		distribution: { kind: 'identity-mirrored' },
		artifacts: [{ ...UPSTREAM_ARTIFACT, url: `https://assets.soundscaper.org/models/${modelId}/6.2.1/model.onnx` }],
		...overrides,
	};
}

function binding(overrides: { evidenceIds?: string[]; refusedIds?: string[] } = {}) {
	const ids = overrides.evidenceIds ?? ['silero-vad-v6', 'parakeet-tdt-0.6b-v2'];
	return {
		licensingEvidence: ids.map((id) => evidenceFor(id)),
		refusedIds: ['crisperwhisper'],
		...(overrides.refusedIds === undefined ? {} : { refusedIds: overrides.refusedIds }),
	};
}

const PUBLICATION = Object.freeze({
	bucket: 'soundscaper-assets',
	prefix: 'models',
	publicBaseUrl: 'https://assets.soundscaper.org/models/',
	jurisdiction: 'eu',
});

function catalogOf(
	entries: unknown[],
	publication: unknown = PUBLICATION,
	schemaVersion: unknown = LOCAL_MODEL_CATALOG_SCHEMA_VERSION,
): unknown {
	const payload = { schemaVersion, publication, entries };
	return {
		...payload,
		signature: {
			algorithm: 'Ed25519',
			keyId: TEST_KEY_ID,
			value: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
		},
	};
}

function validateLocalModelCatalog(value: unknown, catalogBinding: Parameters<typeof validateCatalog>[1]) {
	return validateCatalog(value, catalogBinding, TEST_SIGNATURE_OPTIONS);
}

test('the checked-in catalog agrees with the licensing register', async () => {
	const matrix = await readJson(matrixUrl) as {
		localModelEvidence: { id: string }[];
		refusedLocalModels: { id: string }[];
	};
	const catalog = validateLocalModelCatalog(await readJson(catalogUrl), {
		licensingEvidence: matrix.localModelEvidence,
		refusedIds: matrix.refusedLocalModels.map(({ id }) => id),
	});

	assert.ok(catalog.entries.length > 0, 'the catalog offers the audio launch set');
	for (const candidate of catalog.entries) {
		assert.ok(
			matrix.localModelEvidence.some(({ id }) => id === candidate.modelId),
			`${candidate.modelId} must carry an evidence record`,
		);
	}
});

test('every offered catalog model is installable because V2 requires pinned artifacts', async () => {
	const matrix = await readJson(matrixUrl) as { localModelEvidence: { id: string }[] };
	const catalog = validateLocalModelCatalog(await readJson(catalogUrl), {
		licensingEvidence: matrix.localModelEvidence,
	});

	const availability = (candidate: (typeof catalog.entries)[number]) => describeModelAvailability(candidate, {
		platform: 'linux-x64',
		totalMemoryBytes: 64 * GIB,
		installedModelIds: [],
	});

	const silero = catalog.entries.find(({ modelId }) => modelId === 'silero-vad-v6');
	assert.ok(silero, 'the mirrored model stays cataloged');
	assert.equal(availability(silero), 'installable');
	assert.equal(catalogEntryDownloadBytes(silero), 2_327_524);
	assert.equal(
		silero.artifacts?.[0]?.url,
		'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
	);

	assert.ok(catalog.entries.every((candidate) => catalogEntryDownloadBytes(candidate) > 0));
	assert.ok(catalog.entries.every((candidate) => availability(candidate) === 'installable'));
});

test('a model without a licensing evidence record cannot be cataloged', () => {
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({ modelId: 'unreviewed-model' })]), binding()),
		/needs exactly one licensing evidence record/iu,
	);
});

test('a refused model cannot be cataloged even with an evidence record', () => {
	assert.throws(
		() => validateLocalModelCatalog(
			catalogOf([entry({ modelId: 'crisperwhisper' })]),
			binding({ evidenceIds: ['crisperwhisper'], refusedIds: ['crisperwhisper'] }),
		),
		/refused models cannot be cataloged/iu,
	);
});

test('availability reflects the machine, and installation outranks capability', () => {
	const [pinned] = validateLocalModelCatalog(catalogOf([entry({
		platforms: ['linux-x64'],
		minimumMemoryBytes: 8 * GIB,
		upstream: upstreamOf(),
		artifacts: [{ ...UPSTREAM_ARTIFACT, url: 'https://assets.soundscaper.org/models/x.onnx' }],
	})]), binding()).entries;

	assert.ok(pinned);
	assert.equal(catalogEntryDownloadBytes(pinned), 1_000);
	assert.equal(
		describeModelAvailability(pinned, { platform: 'linux-x64', totalMemoryBytes: 16 * GIB, installedModelIds: [] }),
		'installable',
	);
	assert.equal(
		describeModelAvailability(pinned, { platform: 'win32-arm64', totalMemoryBytes: 16 * GIB, installedModelIds: [] }),
		'unsupported-platform',
	);
	assert.equal(
		describeModelAvailability(pinned, { platform: 'linux-x64', totalMemoryBytes: 4 * GIB, installedModelIds: [] }),
		'insufficient-memory',
	);
	assert.equal(
		describeModelAvailability(pinned, {
			platform: 'win32-arm64',
			totalMemoryBytes: 1 * GIB,
			installedModelIds: ['silero-vad-v6'],
		}),
		'installed',
		'a model already on disk stays usable on a machine that could no longer install it',
	);
});

test('the catalog refuses entries it cannot offer safely', () => {
	assert.throws(() => validateLocalModelCatalog(catalogOf([entry(), entry()]), binding()), /duplicate catalog entry/iu);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({ task: 'summarization' })]), binding()),
		/task is unrecognised/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({ platforms: [] })]), binding()),
		/at least one supported platform/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({ platforms: ['solaris-sparc'] })]), binding()),
		/at least one supported platform/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({ minimumMemoryBytes: 0 })]), binding()),
		/minimumMemoryBytes must be a positive integer/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([], PUBLICATION, 3), binding()),
		/schema version is unsupported/iu,
	);
});

test('a pinned artifact must be hashed and fetched over https', () => {
	const artifact = { ...UPSTREAM_ARTIFACT, url: 'https://assets.soundscaper.org/models/model.onnx' };

	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({ upstream: upstreamOf(), artifacts: [{ ...artifact, sha256: 'nope' }] })]), binding()),
		/lowercase SHA-256 digest/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(
			catalogOf([entry({ upstream: upstreamOf(), artifacts: [{ ...artifact, url: 'http://models.invalid/model.onnx' }] })]),
			binding(),
		),
		/must be downloaded over https/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(
			catalogOf([entry({ upstream: upstreamOf(), artifacts: [{ ...artifact, fileName: '../escape.onnx' }] })]),
			binding(),
		),
		/plain relative file name/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({ upstream: upstreamOf(), artifacts: [] })]), binding()),
		/distribution artifacts must be a non-empty array/iu,
	);
});

test('the audio launch models pin their upstream bytes at an immutable revision', async () => {
	const matrix = await readJson(matrixUrl) as { localModelEvidence: { id: string }[] };
	const catalog = validateLocalModelCatalog(await readJson(catalogUrl), {
		licensingEvidence: matrix.localModelEvidence,
	});
	const byId = new Map(catalog.entries.map((candidate) => [candidate.modelId, candidate]));

	const silero = byId.get('silero-vad-v6');
	assert.equal(silero?.upstream?.revision, '7e30209a3e901f9842f81b225f3e93d8199902b1');
	assert.deepEqual(
		silero?.upstream?.artifacts.map(({ fileName, byteLength }) => [fileName, byteLength]),
		[['silero_vad.onnx', 2_327_524]],
	);

	const parakeet = byId.get('parakeet-tdt-0.6b-v2');
	assert.equal(parakeet?.upstream?.revision, '1ab9323565ddb038682214b292f588070a538ce2');
	for (const artifact of parakeet?.upstream?.artifacts ?? []) {
		assert.match(artifact.sha256, /^[a-f\d]{64}$/u, `${artifact.fileName} is pinned by digest`);
		assert.ok(artifact.url.includes('/resolve/1ab93235'), 'upstream URLs pin the revision, never a branch');
	}
});

test('a speech-recognition model ships the three graphs the runtime loads', async () => {
	const matrix = await readJson(matrixUrl) as { localModelEvidence: { id: string }[] };
	const catalog = validateLocalModelCatalog(await readJson(catalogUrl), {
		licensingEvidence: matrix.localModelEvidence,
	});

	// The transducer is encoder, decoder and joiner as separate graphs. Exports
	// that fuse the decoder and joiner exist and are common; the runtime cannot
	// load one, and the failure reads as a config error rather than a packaging
	// one, so the shape is pinned here.
	for (const entry of catalog.entries) {
		if (entry.task !== 'speech-recognition') continue;
		const names = (entry.upstream?.artifacts ?? []).map(({ fileName }) => fileName);
		if (names.length === 0) continue;
		if (names.some((name) => name.endsWith('.bin'))) continue;
		for (const required of ['encoder', 'decoder', 'joiner', 'tokens']) {
			assert.ok(
				names.some((name) => name.startsWith(required)),
				`${entry.modelId} must ship a ${required} artifact, found ${names.join(', ')}`,
			);
		}
		assert.ok(
			!names.some((name) => name.includes('decoder_joint')),
			`${entry.modelId} pins a fused decoder-joiner export this runtime cannot load`,
		);
	}
});

test('a recognised-text model ships the dictionary its recogniser was built against', async () => {
	const matrix = await readJson(matrixUrl) as { localModelEvidence: { id: string }[] };
	const catalog = validateLocalModelCatalog(await readJson(catalogUrl), {
		licensingEvidence: matrix.localModelEvidence,
	});

	// The recogniser emits one class per dictionary entry plus a blank and a
	// space. A dictionary from a different build has the wrong length, and the
	// result is not an error but confidently decoded nonsense, so the pairing
	// is pinned rather than left to whoever next refreshes the model.
	for (const entry of catalog.entries) {
		if (entry.task !== 'optical-character-recognition') continue;
		const names = (entry.upstream?.artifacts ?? []).map(({ fileName }) => fileName);
		for (const required of ['text_detection.onnx', 'text_recognition.onnx', 'character_dictionary.txt']) {
			assert.ok(names.includes(required), `${entry.modelId} must ship ${required}, found ${names.join(', ')}`);
		}
	}
});

test('an image-text model ships both towers so its two embedding spaces can meet', async () => {
	const matrix = await readJson(matrixUrl) as { localModelEvidence: { id: string }[] };
	const catalog = validateLocalModelCatalog(await readJson(catalogUrl), {
		licensingEvidence: matrix.localModelEvidence,
	});

	// Searching frames by text needs both towers projecting into one space, and
	// a single fused graph cannot embed a query without also embedding an image.
	for (const entry of catalog.entries) {
		if (entry.task !== 'image-text-embedding') continue;
		const names = (entry.upstream?.artifacts ?? []).map(({ fileName }) => fileName);
		for (const required of ['vision_model', 'text_model', 'tokenizer']) {
			assert.ok(
				names.some((name) => name.startsWith(required)),
				`${entry.modelId} must ship a ${required} artifact, found ${names.join(', ')}`,
			);
		}
	}
});

test('the video models pin their upstream bytes at an immutable revision', async () => {
	const matrix = await readJson(matrixUrl) as { localModelEvidence: { id: string }[] };
	const catalog = validateLocalModelCatalog(await readJson(catalogUrl), {
		licensingEvidence: matrix.localModelEvidence,
	});
	const videoTasks = new Set([
		'face-detection', 'object-detection', 'saliency-detection',
		'optical-character-recognition', 'image-text-embedding', 'text-embedding',
	]);
	const video = catalog.entries.filter(({ task }) => videoTasks.has(task));

	assert.equal(video.length, 6, 'the video track pins six models');
	for (const entry of video) {
		assert.ok(entry.upstream, `${entry.modelId} must pin an upstream to mirror`);
		for (const artifact of entry.upstream?.artifacts ?? []) {
			assert.match(artifact.sha256, /^[a-f\d]{64}$/u, `${artifact.fileName} is pinned by digest`);
			assert.ok(
				!/\/(?:resolve|raw)\/(?:main|master)\//u.test(artifact.url),
				`${entry.modelId}: ${artifact.fileName} pins a branch rather than a revision`,
			);
		}
	}
});

test('a mirror copies bytes rather than re-encoding them', () => {
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({
			upstream: upstreamOf(),
			artifacts: [{ ...UPSTREAM_ARTIFACT, sha256: 'b'.repeat(64), url: 'https://assets.soundscaper.org/models/x.onnx' }],
		})]), binding()),
		/does not match its upstream bytes/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({
			upstream: upstreamOf(),
			artifacts: [{ ...UPSTREAM_ARTIFACT, fileName: 'other.onnx', url: 'https://assets.soundscaper.org/models/other.onnx' }],
		})]), binding()),
		/has no upstream artifact/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({
			upstream: null,
			artifacts: [{ ...UPSTREAM_ARTIFACT, url: 'https://assets.soundscaper.org/models/x.onnx' }],
		})]), binding()),
		/offered models need pinned upstream provenance/iu,
	);
});

test('upstream provenance must pin an immutable point over https', () => {
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({ upstream: { ...upstreamOf() as object, revision: '' } })]), binding()),
		/must pin an immutable point/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(
			catalogOf([entry({ upstream: { ...upstreamOf() as object, source: 'http://upstream.invalid/repo' } })]),
			binding(),
		),
		/source must be an https URL/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([entry({ upstream: upstreamOf([]) })]), binding()),
		/needs at least one artifact/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(
			catalogOf([entry({ upstream: upstreamOf([UPSTREAM_ARTIFACT, UPSTREAM_ARTIFACT]) })]),
			binding(),
		),
		/repeats model\.onnx/iu,
	);
});

test('the publication block names the bucket and public host', async () => {
	const matrix = await readJson(matrixUrl) as { localModelEvidence: { id: string }[] };
	const catalog = validateLocalModelCatalog(await readJson(catalogUrl), {
		licensingEvidence: matrix.localModelEvidence,
	});

	assert.deepEqual(catalog.publication, {
		bucket: 'soundscaper-assets',
		prefix: 'models',
		publicBaseUrl: 'https://assets.soundscaper.org/models/',
		jurisdiction: 'eu',
	});

	const [entryUnderTest] = catalog.entries;
	assert.ok(entryUnderTest);
	assert.deepEqual(plannedMirrorLocation(catalog, entryUnderTest, 'silero_vad.onnx'), {
		key: 'models/silero-vad-v6/6.2.1/silero_vad.onnx',
		url: 'https://assets.soundscaper.org/models/silero-vad-v6/6.2.1/silero_vad.onnx',
	});
});

test('an unusable publication block is refused', () => {
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([], { ...PUBLICATION, bucket: 'Not A Bucket' }), binding()),
		/bucket name is invalid/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([], { ...PUBLICATION, prefix: '../models' }), binding()),
		/plain lowercase path segment/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([], { ...PUBLICATION, publicBaseUrl: 'https://assets.soundscaper.org/models' }), binding()),
		/ending in a slash/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([], null), binding()),
		/needs a publication block/iu,
	);
	assert.throws(
		() => validateLocalModelCatalog(catalogOf([], { ...PUBLICATION, jurisdiction: 'atlantis' }), binding()),
		/jurisdiction is unrecognised/iu,
	);
	const { jurisdiction: _jurisdiction, ...publicationWithoutJurisdiction } = PUBLICATION;
	assert.equal(
		validateLocalModelCatalog(catalogOf([], publicationWithoutJurisdiction), binding())
			.publication.jurisdiction,
		null,
		'an absent jurisdiction means the default one, not a missing field',
	);
});
