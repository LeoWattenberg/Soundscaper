/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBwfExportMetadata } from '../src/common/editor/broadcast-wave-project.ts';
import { normalizeProjectBextMetadata, type ProjectBextMetadata } from '../src/common/editor/project-bext-metadata.ts';
import { prepareImportedWavMetadata } from '../src/common/editor/controller/import/internal/wav-import-metadata.ts';
import { freezeProjectImportOptions } from '../src/common/editor/controller/import/internal/project-import-options.ts';

function importMetadata(options: Readonly<{
	reference?: string; sourceRate?: number; start?: number; explicit?: boolean;
	destination?: 'timeline' | 'project-bin'; existing?: ProjectBextMetadata;
}> = {}) {
	const sourceBext = normalizeProjectBextMetadata({ description: 'Location take', timeReference: options.reference ?? '320000' });
	const result = prepareImportedWavMetadata({
		descriptor: { bext: sourceBext, sampleRate: options.sourceRate ?? 32_000 },
		projectSampleRate: 48_000, copy: {}, freezeImportOptions: freezeProjectImportOptions,
		project: { metadata: { bext: options.existing ?? null } },
		importOptions: { destination: options.destination ?? 'timeline', trackId: null,
			timelineStartFrame: options.start ?? 96_000, timelineStartExplicit: options.explicit ?? true },
	}) as Readonly<{
		projectBext: ProjectBextMetadata | null; sourceBext: ProjectBextMetadata;
		importOptions: Readonly<{ timelineStartFrame: number }>; warnings: readonly Readonly<{ code: string }>[];
	}>;
	assert.deepEqual(result.sourceBext, sourceBext);
	return result;
}

test('explicit BWF placement derives project zero before selected-range timestamp export', () => {
	const imported = importMetadata();
	assert.equal(imported.projectBext?.timeReference, '384000');
	const delivered = createBwfExportMetadata({ sampleRate: 48_000, metadata: { bext: imported.projectBext } }, {
		outputSampleRate: 96_000, bitDepth: 24, channelCount: 1, rangeStartFrame: 108_000,
	});
	assert.equal(delivered.timeReference, '984000');
	assert.equal(imported.importOptions.timelineStartFrame, 96_000);
});

test('ordinary file import and bin import seed the source origin without applying an unplaced cursor', () => {
	const automatic = importMetadata({ explicit: false });
	assert.equal(automatic.projectBext?.timeReference, '480000');
	assert.equal(automatic.importOptions.timelineStartFrame, 0);
	assert.equal(importMetadata({ destination: 'project-bin' }).projectBext?.timeReference, '480000');
});

test('later broadcast recordings keep the established project origin and automatic spotting', () => {
	const imported = importMetadata({ explicit: false, existing: normalizeProjectBextMetadata({ timeReference: '432000' }) });
	assert.equal(imported.projectBext, null);
	assert.equal(imported.importOptions.timelineStartFrame, 48_000);
});

test('an unrepresentable negative project origin warns without changing the source timestamp', () => {
	const imported = importMetadata({ reference: '0' });
	assert.equal(imported.projectBext, null);
	assert.equal(imported.sourceBext.timeReference, '0');
	assert.equal(imported.importOptions.timelineStartFrame, 96_000);
	assert.ok(imported.warnings.some(warning => warning.code === 'bext-project-origin-conversion'));
});

test('source timestamps above numeric precision retain their exact placed origin', () => {
	const imported = importMetadata({ reference: '9007199254740993', sourceRate: 48_000, start: 12_000 });
	assert.equal(imported.projectBext?.timeReference, '9007199254728993');
});
