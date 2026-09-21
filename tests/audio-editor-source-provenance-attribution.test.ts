/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	copySourceProvenance,
	createImportedSourceProvenance,
	createNonImportedSourceProvenance,
	mergeSourceProvenance,
	normalizeSourceProvenance,
} from '../src/common/editor/source-provenance.ts';
import {
	createProjectAttributionReport,
	exportProjectAttributionCsv,
} from '../src/common/editor/project-attribution-report.ts';
import {
	deriveSourceProvenance,
	INCOMPLETE_DERIVED_ATTRIBUTION_WARNING,
} from '../src/common/editor/source-provenance-derivation.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	cloneAudioEditorProjectV17,
	createAudioEditorProjectV17,
	loadAudioEditorProjectV17,
} from '../src/common/editor/project-v17.ts';
import { validateAudioEditorProjectV17 } from '../src/common/editor/project-v17-validation.ts';

const LOCAL_CONTRIBUTION = {
	id: 'contribution-local',
	origin: {
		kind: 'local-file' as const,
		originalFileName: '=field-recording.wav',
		mimeType: 'audio/wav',
		byteLength: 4_096,
		lastModified: '2026-09-20T10:00:00.000Z',
	},
	metadata: {
		normalized: { title: 'Field recording', artist: 'Ada' },
		raw: { TIT2: 'Field recording' },
		namespaces: { info: { IART: 'Ada' } },
	},
	attachments: [{
		path: 'artwork/front', name: 'cover.jpg', mimeType: 'image/jpeg',
		description: 'Front cover', byteLength: 321,
		sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
	}],
	warnings: ['One optional tag was unavailable.'],
};

const FREESOUND_CONTRIBUTION = {
	id: 'contribution-freesound',
	origin: {
		kind: 'freesound' as const,
		soundId: 42,
		title: 'Forest recording',
		soundUrl: 'https://freesound.org/s/42/',
		creator: 'Sound Maker',
		creatorUrl: 'https://freesound.org/people/Sound_Maker/',
		license: {
			family: 'cc-by' as const,
			name: 'Attribution 4.0',
			url: 'https://creativecommons.org/licenses/by/4.0/',
		},
		importedVariant: 'preview-hq-ogg' as const,
		originalFileName: 'forest.ogg',
		mimeType: 'audio/ogg',
	},
	metadata: { normalized: { tags: ['forest', 'birds'] } },
};

test('source provenance normalizes imported metadata and rejects unsafe binary values', () => {
	const provenance = createImportedSourceProvenance(LOCAL_CONTRIBUTION);

	assert.equal(provenance.schemaVersion, 1);
	assert.equal(provenance.classification, 'imported');
	assert.deepEqual(provenance.contributions, [{
		...LOCAL_CONTRIBUTION,
		metadata: {
			normalized: { artist: 'Ada', title: 'Field recording' },
			raw: { TIT2: 'Field recording' },
			namespaces: { info: { IART: 'Ada' } },
		},
	}]);
	assert.equal(Object.isFrozen(provenance), true);
	assert.equal(Object.isFrozen(provenance.contributions[0]?.metadata.normalized), true);
	const reservedKey = createImportedSourceProvenance({
		...LOCAL_CONTRIBUTION,
		metadata: JSON.parse('{"raw":{"__proto__":{"credit":"Ada"}}}') as unknown,
	});
	const raw = reservedKey.contributions[0]?.metadata.raw;
	assert.ok(raw && Object.hasOwn(raw, '__proto__'));
	assert.deepEqual(raw.__proto__, { credit: 'Ada' });
	assert.equal(Object.getPrototypeOf(raw), Object.prototype);

	assert.throws(() => createImportedSourceProvenance({
		...LOCAL_CONTRIBUTION,
		metadata: { raw: { picture: new Uint8Array([1, 2, 3]) } },
	}), /JSON-compatible|binary/iu);
	assert.throws(() => normalizeSourceProvenance({
		schemaVersion: 1,
		classification: 'recorded',
		contributions: [LOCAL_CONTRIBUTION],
	}), /cannot carry imported contributions/iu);
});

test('source provenance copies, merges and deduplicates contributions without losing credit', () => {
	const local = createImportedSourceProvenance(LOCAL_CONTRIBUTION);
	const freesound = createImportedSourceProvenance(FREESOUND_CONTRIBUTION);
	const merged = mergeSourceProvenance([local, copySourceProvenance(local), freesound]);

	assert.equal(merged.classification, 'derived');
	assert.deepEqual(merged.contributions.map(({ id }) => id), [
		'contribution-local', 'contribution-freesound',
	]);
	assert.notEqual(copySourceProvenance(local), local);
	assert.deepEqual(createNonImportedSourceProvenance('generated'), {
		schemaVersion: 1, classification: 'generated', contributions: [],
	});
	assert.throws(() => mergeSourceProvenance([
		local,
		createImportedSourceProvenance({
			...LOCAL_CONTRIBUTION,
			origin: { ...LOCAL_CONTRIBUTION.origin, originalFileName: 'different.wav' },
		}),
	]), /conflicting contribution/iu);
});

test('source factories normalize provenance and project validation rejects malformed persisted provenance', () => {
	const source = createAudioSource({
		id: 'source-a', frameCount: 1_000, channelCount: 1,
		provenance: createImportedSourceProvenance(LOCAL_CONTRIBUTION),
	});
	const project = createAudioEditorProjectV17({
		id: 'project-a', title: 'Attribution', now: '2026-09-21T10:00:00.000Z',
		sources: [source],
		clips: [createAudioClip({
			id: 'clip-a', sourceId: source.id, timelineStartFrame: 0,
			durationFrames: 100, sourceStartFrame: 0, sourceDurationFrames: 100,
		})],
		tracks: [createAudioTrack({ id: 'track-a', clipIds: ['clip-a'] })],
	});

	assert.equal(validateAudioEditorProjectV17(project), true);
	assert.deepEqual(cloneAudioEditorProjectV17(project).sources[0]?.provenance, source.provenance);
	assert.deepEqual(loadAudioEditorProjectV17(structuredClone(project)).project, project);
	const malformed = structuredClone(project) as Record<string, unknown>;
	const sources = malformed.sources as Record<string, unknown>[];
	sources[0]!.provenance = { schemaVersion: 9, classification: 'imported', contributions: [] };
	assert.throws(() => validateAudioEditorProjectV17(malformed), /provenance\.schemaVersion/iu);
});

test('attribution report derives timeline, comp and Project Bin uses while excluding non-imported media', () => {
	const localProvenance = createImportedSourceProvenance(LOCAL_CONTRIBUTION);
	const derivedProvenance = mergeSourceProvenance([
		localProvenance,
		createImportedSourceProvenance(FREESOUND_CONTRIBUTION),
	]);
	const sources = [
		audioSource('local-source', '=Local source', localProvenance),
		audioSource('derived-source', 'Derived source', derivedProvenance),
		audioSource('legacy-source', 'Legacy source'),
		audioSource('generated-source', 'Generated source', createNonImportedSourceProvenance('generated')),
		audioSource('bin-source', 'Bin source', createImportedSourceProvenance({
			...LOCAL_CONTRIBUTION, id: 'contribution-bin',
		})),
		audioSource('take-source', 'Take source', createImportedSourceProvenance({
			...LOCAL_CONTRIBUTION, id: 'contribution-take',
		})),
	];
	const clips = [
		audioClip('local-clip', 'local-source', 48_000, 24_000),
		audioClip('derived-clip', 'derived-source', 0, 48_000),
		audioClip('legacy-clip', 'legacy-source', 96_000, 48_000),
		audioClip('generated-clip', 'generated-source', 144_000, 48_000),
	];
	const project = {
		sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', name: 'Main', trackIds: ['track-a'] }],
		sources,
		clips,
		tracks: [createAudioTrack({
			id: 'track-a', name: 'Atmosphere',
			clipIds: clips.map(({ id }) => String(id)),
		})],
		projectBin: { clips: [audioClip('bin-clip', 'bin-source', 0, 100)] },
		takeGroups: [{
			id: 'take-group', sequenceId: 'main-sequence', trackId: 'track-a',
			takes: [{
				id: 'take-a', sourceId: 'take-source', laneId: 'lane-a',
				startSample: 192_000, endSample: 240_000, sourceStartSample: 0,
			}],
			compRegions: [{ id: 'comp-a', takeId: 'take-a', startSample: 192_000, endSample: 216_000 }],
		}],
	};

	const report = createProjectAttributionReport(project);

	assert.deepEqual(report.sources.map(({ sourceId }) => sourceId), [
		'derived-source', 'local-source', 'legacy-source', 'take-source', 'bin-source',
	]);
	assert.equal(report.sources.some(({ sourceId }) => sourceId === 'generated-source'), false);
	const derived = report.sources.find(({ sourceId }) => sourceId === 'derived-source');
	assert.deepEqual(derived?.contributions.map(({ id }) => id), [
		'contribution-local', 'contribution-freesound',
	]);
	assert.deepEqual(derived?.uses[0], {
		kind: 'clip', id: 'derived-clip', title: 'derived-clip',
		sequenceId: 'main-sequence', sequenceName: 'Main',
		trackId: 'track-a', trackName: 'Atmosphere',
		startFrame: 0, endFrame: 48_000,
	});
	assert.equal(report.sources.find(({ sourceId }) => sourceId === 'legacy-source')?.classification, 'legacy');
	assert.deepEqual(report.sources.find(({ sourceId }) => sourceId === 'take-source')?.uses[0], {
		kind: 'take-comp', id: 'comp-a', title: 'Take comp',
		sequenceId: 'main-sequence', sequenceName: 'Main',
		trackId: 'track-a', trackName: 'Atmosphere',
		startFrame: 192_000, endFrame: 216_000,
	});
	assert.deepEqual(report.sources.find(({ sourceId }) => sourceId === 'bin-source')?.uses[0], {
		kind: 'project-bin', id: 'bin-clip', title: 'bin-clip',
	});
	const csv = exportProjectAttributionCsv(report);
	assert.match(csv, /"bin-source"[^\r\n]+"project-bin","bin-clip","bin-clip","","","",""/u);
});

test('attribution report exposes stored source metadata beside provenance without legacy warnings', () => {
	const source = {
		...audioSource('broadcast-source', 'Broadcast source', createImportedSourceProvenance(LOCAL_CONTRIBUTION)),
		opaqueExtensions: {
			bext: { description: 'Night ambience', timeReference: '48000' },
			ixml: { project: 'Nocturne', tracks: [{ channelIndex: 1, name: 'Mid' }] },
			cart: { title: 'City at night' },
			adm: { container: 'bw64', chna: { entries: [{ trackIndex: 1, uid: 'ATU_00000001' }] } },
			unavailableBinary: new Uint8Array([1, 2, 3]),
		},
	};
	const clip = audioClip('broadcast-clip', source.id, 0, 48_000);
	const report = createProjectAttributionReport({
		sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', name: 'Main', trackIds: ['track-a'] }],
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track-a', name: 'Audio', clipIds: [clip.id] })],
		projectBin: { clips: [] }, takeGroups: [],
	});

	const attributed = report.sources[0];
	assert.deepEqual(attributed?.sourceMetadata.namespaces, {
		adm: { chna: { entries: [{ trackIndex: 1, uid: 'ATU_00000001' }] }, container: 'bw64' },
		bext: { description: 'Night ambience', timeReference: '48000' },
		cart: { title: 'City at night' },
		ixml: { project: 'Nocturne', tracks: [{ channelIndex: 1, name: 'Mid' }] },
	});
	assert.deepEqual(attributed?.warnings, [
		'Source metadata namespace unavailableBinary is unavailable in the attribution report.',
	]);
	assert.equal(attributed?.warnings.some((warning) => /legacy|predates provenance/iu.test(warning)), false);

	const csv = exportProjectAttributionCsv(report);
	assert.match(csv, /Night ambience/u);
	assert.match(csv, /City at night/u);
	assert.match(csv, /ATU_00000001/u);
	assert.match(csv, /Source metadata namespace unavailableBinary/u);
	assert.doesNotMatch(csv, /Attribution is unavailable|Legacy metadata namespace/iu);
});

test('attribution report and CSV surface incomplete derived attribution', () => {
	const provenance = deriveSourceProvenance([
		{ provenance: createImportedSourceProvenance(LOCAL_CONTRIBUTION) },
		{},
	]);
	const source = audioSource('mixed-source', 'Mixed source', provenance);
	const clip = audioClip('mixed-clip', source.id, 0, 48_000);
	const report = createProjectAttributionReport({
		sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', name: 'Main', trackIds: ['track-a'] }],
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track-a', name: 'Audio', clipIds: [clip.id] })],
		projectBin: { clips: [] }, takeGroups: [],
	});

	assert.equal(report.sources[0]?.contributions[0]?.warnings.includes(
		INCOMPLETE_DERIVED_ATTRIBUTION_WARNING,
	), true);
	assert.match(exportProjectAttributionCsv(report), new RegExp(INCOMPLETE_DERIVED_ATTRIBUTION_WARNING, 'u'));
});

test('attribution CSV is deterministic RFC 4180 with one defended row per current occurrence', () => {
	const source = audioSource('source-a', '=SUM(A1:A2)', mergeSourceProvenance([
		createImportedSourceProvenance(LOCAL_CONTRIBUTION),
		createImportedSourceProvenance(FREESOUND_CONTRIBUTION),
	]));
	const clip = {
		...audioClip('clip-a', 'source-a', 24_000, 48_000),
		title: '\n=HYPERLINK("https://example.invalid")',
	};
	const report = createProjectAttributionReport({
		sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', name: 'Main', trackIds: ['track-a'] }],
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track-a', name: 'Audio, one', clipIds: ['clip-a'] })],
		projectBin: { clips: [] }, takeGroups: [],
	});

	const first = exportProjectAttributionCsv(report);
	const second = exportProjectAttributionCsv(report);

	assert.equal(first, second);
	assert.equal(first.startsWith('\uFEFF"project_source_id","'), true);
	assert.equal(first.endsWith('\r\n'), true);
	assert.equal(first.split('\r\n').length, 3);
	assert.match(first, /"'=SUM\(A1:A2\)"/u);
	assert.match(first, /"'\n=HYPERLINK\(""https:\/\/example\.invalid""\)"/u);
	assert.match(first, /"Audio, one"/u);
	assert.match(first, /"00:00:00\.500","00:00:01\.500"/u);
	assert.match(first, /"contribution-local"/u);
	assert.match(first, /"contribution-freesound"/u);
});

function audioSource(
	id: string,
	name: string,
	provenance?: ReturnType<typeof createImportedSourceProvenance> | ReturnType<typeof mergeSourceProvenance>
		| ReturnType<typeof createNonImportedSourceProvenance>,
) {
	return createAudioSource({
		id, name, storageKey: id, mimeType: 'audio/wav', frameCount: 480_000,
		channelCount: 1, sampleRate: 48_000, ...(provenance ? { provenance } : {}),
	});
}

function audioClip(id: string, sourceId: string, timelineStartFrame: number, durationFrames: number) {
	return createAudioClip({
		id, title: id, sourceId, timelineStartFrame, durationFrames,
		sourceStartFrame: 0, sourceDurationFrames: durationFrames,
	});
}
