/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { useClipPropertiesSelection, useImageClipPropertiesTarget } from '../src/common/editor/ui/inspector/useClipPropertyPresentation.ts';
import { useSpectrumPlotPoints, spectrumPlotPoints } from '../src/common/editor/ui/dialogs/spectrum-plot-points.ts';
import { useMasteringEntryKeys } from '../src/common/editor/ui/dialogs/mastering-entry-form-keys.ts';
import type { DocumentMasteringSequenceEntrySnapshot } from '../src/common/editor/controller/document/document-mastering-sequence-snapshot.ts';

void test('inspector membership, image targeting, spectrum geometry and mastering keys skip unrelated publications', async () => {
	const dom = installReactTestDom(); const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	let membershipReads = 0, imageReads = 0, binReads = 0, metadataReads = 0;
	const clips = [{ get id() { membershipReads++; return 'clip'; }, sourceId: 'source', title: 'Clip' }];
	const sources = [{ id: 'source', name: 'Source' }]; const ids = ['clip'];
	let project = { id: 'project', clips, sources }; const snapshot = { project, selectedClipId: 'clip', selectedClipIds: ids };
	const image = { schemaVersion: 1, kind: 'image', id: 'image', sourceId: 'source', sequenceId: 'main', sequenceStartFrame: 5, sequenceFrameCount: 25, sourceStartTicks: '0' };
	const imageProject = { clips: [{ get id() { imageReads++; return 'other'; } }, image], sources, tracks: [{ id: 'track', clipIds: ['image'] }], sequences: [{ id: 'main', rate: { num: 25, den: 1 } }], sampleRate: 48000 };
	let bins: { db: number }[] = Array.from({ length: 2048 }, (_, index) => ({ get db() { binReads++; return index === 100 ? -3 : -100; } }));
	const entry = { id: 'entry', annotationId: 'region', title: 'Region', titleOverride: null, durationFrames: 100, gapBeforeFrames: 1, fadeInFrames: 2, fadeOutFrames: 3,
		metadata: { get title() { metadataReads++; return 'Title'; } } } as unknown as DocumentMasteringSequenceEntrySnapshot;
	let entries = [entry]; let result: readonly unknown[] = [];
	function Harness({ revision }: { revision: number }) {
		result = [useClipPropertiesSelection({ ...snapshot, project }, 'Fallback'), useImageClipPropertiesTarget(imageProject, 'image'), useSpectrumPlotPoints(bins), useMasteringEntryKeys('sequence', entries)];
		return <span>{revision}</span>;
	}
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness revision={0} />)); const first = result; const work = { membershipReads, imageReads, binReads, metadataReads };
		for (let revision = 1; revision <= 30; revision++) { project = { ...project }; await act(async () => root.render(<Harness revision={revision} />)); }
		assert.deepEqual({ membershipReads, imageReads, binReads, metadataReads }, work); result.forEach((value, index) => assert.equal(value, first[index]));
		assert.equal(result[2], spectrumPlotPoints(bins));
		bins = [{ db: -60 }]; entries = [{ ...entry, title: 'Changed' }]; await act(async () => root.render(<Harness revision={31} />));
		assert.notEqual(result[2], first[2]); assert.notEqual(result[3], first[3]);
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); }
});
