/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	presentProjectAttributionReport,
	saveProjectAttributionCsv,
} from '../src/common/editor/ui/workspace/project-attribution-presentation.ts';
import type { ProjectAttributionReport } from '../src/common/editor/project-attribution-report.ts';

const report: ProjectAttributionReport = {
	sampleRate: 48_000,
	sources: [{
		sourceId: 'source-a', sourceName: 'Derived ambience', sourceKind: 'audio',
		mimeType: 'audio/ogg', classification: 'derived', sourceMetadata: {
			normalized: {}, raw: {}, namespaces: { bext: { description: 'Imported broadcast master' } },
		}, warnings: ['One source namespace was unavailable.'],
		uses: [{
			kind: 'clip', id: 'clip-a', title: 'Forest bed',
			sequenceId: 'main', sequenceName: 'Main', trackId: 'track-a', trackName: 'Ambience',
			startFrame: 24_000, endFrame: 72_000,
		}],
		contributions: [{
			id: 'credit-a',
			origin: {
				kind: 'freesound', soundId: 42, soundUrl: 'https://freesound.org/s/42/',
				title: 'Rain in the forest',
				creator: 'Ada', creatorUrl: 'https://freesound.org/people/Ada/',
				license: {
					family: 'cc-by', name: 'Attribution 4.0',
					url: 'https://creativecommons.org/licenses/by/4.0/',
				},
				importedVariant: 'preview-hq-ogg', originalFileName: 'forest.ogg', mimeType: 'audio/ogg',
			},
			metadata: {
				normalized: { artist: 'Ada' }, raw: { TITLE: 'Rain' },
				namespaces: { vorbis: { location: 'Forest' } },
			},
			attachments: [{
				path: 'images[0]', kind: 'front-cover', name: 'cover.png', mimeType: 'image/png', byteLength: 3,
				sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
			}],
			warnings: ['One tag was truncated.'],
		}],
	}],
};

test('attribution presentation expands every current use and all stored metadata', () => {
	const presented = presentProjectAttributionReport(report);

	assert.equal(presented.occurrences.length, 1);
	assert.deepEqual(presented.occurrences[0], {
		key: 'source-a:clip:main:clip-a', clipName: 'Forest bed', trackName: 'Ambience',
		sequenceId: 'main', sequenceName: 'Main',
		useTimeLabel: '00:00:00.500–00:00:01.500',
		sources: [{
			key: 'source-a:credit-a', name: 'Rain in the forest', url: 'https://freesound.org/s/42/',
			creator: 'Ada', creatorUrl: 'https://freesound.org/people/Ada/',
			licenseName: 'Attribution 4.0',
			licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
			metadata: [
				{ key: 'origin.kind', label: 'origin.kind', value: 'freesound' },
				{ key: 'origin.soundId', label: 'origin.soundId', value: '42' },
				{ key: 'origin.license.family', label: 'origin.license.family', value: 'cc-by' },
				{ key: 'origin.importedVariant', label: 'origin.importedVariant', value: 'preview-hq-ogg' },
				{ key: 'origin.originalFileName', label: 'origin.originalFileName', value: 'forest.ogg' },
				{ key: 'origin.mimeType', label: 'origin.mimeType', value: 'audio/ogg' },
				{ key: 'normalized.artist', label: 'normalized.artist', value: 'Ada' },
				{ key: 'raw.TITLE', label: 'raw.TITLE', value: 'Rain' },
				{ key: 'namespaces.vorbis.location', label: 'namespaces.vorbis.location', value: 'Forest' },
				{ key: 'attachment:images[0]', label: 'attachment: images[0]', value: 'front-cover · cover.png · image/png · 3 bytes · SHA-256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
				{ key: 'warning:0', label: 'warning', value: 'One tag was truncated.' },
				{ key: 'source.namespaces.bext.description', label: 'source.namespaces.bext.description', value: 'Imported broadcast master' },
				{ key: 'source.warning:0', label: 'warning', value: 'One source namespace was unavailable.' },
			],
			modified: true,
		}],
	});
});

test('attribution presentation distinguishes the same clip use in multiple sequences', () => {
	const firstSource = report.sources[0]!;
	const firstUse = firstSource.uses[0]!;
	assert.notEqual(firstUse.kind, 'project-bin');
	if (firstUse.kind === 'project-bin') return;
	const presented = presentProjectAttributionReport({
		...report,
		sources: [{
			...firstSource,
			uses: [firstUse, { ...firstUse, sequenceId: 'alternate', sequenceName: 'Alternate' }],
		}],
	});

	assert.deepEqual(presented.occurrences.map(({ key, sequenceId, sequenceName }) => ({
		key, sequenceId, sequenceName,
	})), [{
		key: 'source-a:clip:main:clip-a', sequenceId: 'main', sequenceName: 'Main',
	}, {
		key: 'source-a:clip:alternate:clip-a', sequenceId: 'alternate', sequenceName: 'Alternate',
	}]);
});

test('attribution presentation emits source metadata and source warnings once for a derived source', () => {
	const firstSource = report.sources[0]!;
	const firstContribution = firstSource.contributions[0]!;
	const withTwoContributions: ProjectAttributionReport = {
		...report,
		sources: [{
			...firstSource,
			contributions: [firstContribution, {
				...firstContribution,
				id: 'credit-b',
				origin: {
					kind: 'local-file', originalFileName: 'second.wav', mimeType: 'audio/wav',
					byteLength: 12_345, lastModified: '2026-09-21T12:34:56.000Z',
				},
			}],
		}],
	};

	const fields = presentProjectAttributionReport(withTwoContributions)
		.occurrences[0]!.sources.flatMap(({ metadata }) => metadata);
	assert.equal(fields.filter(({ key }) => key === 'source.namespaces.bext.description').length, 1);
	assert.equal(fields.filter(({ value }) => value === 'One source namespace was unavailable.').length, 1);
	assert.deepEqual(fields.filter(({ key }) => key.startsWith('origin.')).slice(-5), [
		{ key: 'origin.kind', label: 'origin.kind', value: 'local-file' },
		{ key: 'origin.originalFileName', label: 'origin.originalFileName', value: 'second.wav' },
		{ key: 'origin.mimeType', label: 'origin.mimeType', value: 'audio/wav' },
		{ key: 'origin.byteLength', label: 'origin.byteLength', value: '12345' },
		{ key: 'origin.lastModified', label: 'origin.lastModified', value: '2026-09-21T12:34:56.000Z' },
	]);
});

test('attribution presentation identifies Project Bin sources without inventing a timeline timestamp', () => {
	const firstSource = report.sources[0]!;
	const presented = presentProjectAttributionReport({
		...report,
		sources: [{
			...firstSource,
			uses: [{ kind: 'project-bin', id: 'bin-clip', title: 'Unused ambience' }],
		}],
	});

	assert.deepEqual(presented.occurrences[0], {
		key: 'source-a:project-bin:bin-clip',
		clipName: 'Unused ambience',
		trackName: '',
		useTimeLabel: '',
		projectBin: true,
		sources: presentProjectAttributionReport(report).occurrences[0]!.sources,
	});
});

test('attribution CSV export uses the reserved purpose and a safe project filename', async () => {
	const requests: Readonly<Record<string, unknown>>[] = [];
	await saveProjectAttributionCsv(report, '= Rain / field ', {
		saveFile: async (request) => { requests.push(request); return { cancelled: false }; },
	});

	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.purpose, 'attribution-csv');
	assert.equal(requests[0]?.suggestedName, 'Rain-field-attribution.csv');
	assert.equal(requests[0]?.mimeType, 'text/csv;charset=utf-8');
	assert.match(String(requests[0]?.text), /"clip-a"/u);
});
