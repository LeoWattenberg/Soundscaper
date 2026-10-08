/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createExportChapterPlan } from '../src/common/editor/export-chapters.ts';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { inspectWavLayout } from '../src/common/editor/wav.js';
import type { IxmlMetadata } from '../src/common/editor/ixml.ts';
import { parseIxmlPayload } from '../src/common/editor/ixml.ts';
import { ixmlAtImportOrigin, ixmlForDeliveryRange } from '../src/common/editor/ixml-delivery-timing.ts';
import { prepareImportedWavMetadata } from '../src/common/editor/controller/import/internal/wav-import-metadata.ts';
import { freezeProjectImportOptions } from '../src/common/editor/controller/import/internal/project-import-options.ts';

const bytes = Uint8Array.from(Buffer.from(readFileSync(new URL('./fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8').trim(), 'base64'));
const descriptor = await inspectWavBlobPcm(new Blob([bytes]));
assert.ok(descriptor.ixml, 'the unchanged normal BWF MetaEdit fixture includes iXML');
const sourceIxml: IxmlMetadata = descriptor.ixml;

function productionProject() {
	const base = createSoundscaperProject({ id: 'production', now: '2026-10-08T00:00:00Z', tracks: [{ id: 'audio', type: 'audio', name: 'Boom' }] });
	return createSoundscaperProject({ ...base, mixer: undefined,
		sources: [{ id: 'recording', kind: 'audio', name: 'Production take', sampleRate: 48_000, frameCount: 48_000, channelCount: 1, sampleFormat: 'float32', storageKey: 'recording' }],
		clips: [{ id: 'take', kind: 'audio', sourceId: 'recording', timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000 }],
		tracks: [{ id: 'audio', type: 'audio', name: 'Boom', clipIds: ['take'] }],
		metadata: { ...base.metadata, ixml: sourceIxml },
		timelineAnnotations: [
			{ id: 'opening', sequenceId: base.primarySequenceId, kind: 'region', anchor: 'sample', name: 'Opening', startFrame: 0, endFrame: 12_000, color: 'auto', batchId: null, opaqueExtensions: {} },
			{ id: 'slate', sequenceId: base.primarySequenceId, kind: 'region', anchor: 'sample', name: 'Slate', startFrame: 12_000, endFrame: 48_000, color: 'auto', batchId: null, opaqueExtensions: {} },
		],
	});
}

test('a resampled production delivery keeps relative recorder sync points at the same audible time', () => {
	const plan = createExportPlan(productionProject(), { format: 'bwf', sampleRate: 96_000 });
	assert.ok(plan.ixml);
	assert.match(plan.ixml.rawXml, /<SYNC_POINT_LOW>48000<\/SYNC_POINT_LOW>/u);
	assert.match(plan.ixml.rawXml, /<DIGITIZER_SAMPLE_RATE>48000<\/DIGITIZER_SAMPLE_RATE>/u);
	assert.match(plan.ixml.rawXml, /<NOTE>Clean boom take<\/NOTE>/u);
	assert.match(sourceIxml.rawXml, /<SYNC_POINT_LOW>24000<\/SYNC_POINT_LOW>/u, 'source provenance stays unchanged');
});

test('a selected delivery expresses its slate from the beginning of the delivered audio', () => {
	const plan = createExportPlan(productionProject(), { format: 'bwf', sampleRate: 96_000, range: { startFrame: 6_000, endFrame: 48_000 } });
	assert.match(plan.ixml!.rawXml, /<SYNC_POINT_LOW>36000<\/SYNC_POINT_LOW>/u);
});

test('split deliveries carry only their own relative sync points and account for their actual metadata size', () => {
	const plan = createExportPlan(productionProject(), { format: 'bwf', mode: 'chapters', chapterSource: 'markers', sampleRate: 96_000 });
	assert.equal(plan.outputs.length, 2);
	const first = createExportChapterPlan(plan, plan.outputs[0]!);
	const second = createExportChapterPlan(plan, plan.outputs[1]!);
	assert.match(first.ixml!.rawXml, /<SYNC_POINT_COUNT>0<\/SYNC_POINT_COUNT>/u);
	assert.doesNotMatch(first.ixml!.rawXml, /<SYNC_POINT>/u);
	assert.match(second.ixml!.rawXml, /<SYNC_POINT_LOW>24000<\/SYNC_POINT_LOW>/u);
	for (const chapter of [first, second]) {
		const layout = inspectWavLayout({ sampleRate: chapter.sampleRate, channelCount: chapter.channelCount,
			totalFrames: chapter.outputFrames, bitDepth: chapter.encoding.bitDepth, float: chapter.encoding.floatingPoint,
			metadata: chapter.encoding.metadata, bext: chapter.bext, cart: chapter.cart, ixml: chapter.ixml, markers: chapter.markers });
		assert.equal(chapter.outputFileBytesPerRender, layout.byteLength);
	}
});

test('ordinary source promotion includes the receiving timeline placement without changing source metadata', () => {
	const prepared = prepareImportedWavMetadata({ descriptor, projectSampleRate: 48_000, copy: {}, freezeImportOptions: freezeProjectImportOptions,
		project: { metadata: { ixml: null, cart: null, bext: null } },
		importOptions: { destination: 'timeline', trackId: null, timelineStartFrame: 96_000, timelineStartExplicit: true },
	}) as Readonly<{ projectIxml: IxmlMetadata; sourceIxml: IxmlMetadata }>;
	assert.match(prepared.projectIxml.rawXml, /<SYNC_POINT_LOW>120000<\/SYNC_POINT_LOW>/u);
	assert.equal(prepared.sourceIxml.rawXml, sourceIxml.rawXml);
});

test('an unchanged 48 kHz 16-bit delivery preserves the complete recorder XML', () => {
	const plan = createExportPlan(productionProject(), { format: 'bwf', sampleRate: 48_000, bitDepth: 16 });
	assert.equal(plan.ixml!.rawXml, sourceIxml.rawXml);
});

test('source-rate promotion and receiving timeline placement are independent conversions', () => {
	const xml = sourceIxml.rawXml.replace('<SYNC_POINT_LOW>24000</SYNC_POINT_LOW>', '<SYNC_POINT_LOW>16000</SYNC_POINT_LOW>')
		.replace('<DIGITIZER_SAMPLE_RATE>48000</DIGITIZER_SAMPLE_RATE>', '<DIGITIZER_SAMPLE_RATE>32000</DIGITIZER_SAMPLE_RATE>');
	const promoted = ixmlAtImportOrigin(parseIxmlPayload(new TextEncoder().encode(xml)), 32_000, 48_000, 96_000);
	assert.match(promoted.rawXml, /<SYNC_POINT_LOW>120000<\/SYNC_POINT_LOW>/u);
	assert.match(promoted.rawXml, /<DIGITIZER_SAMPLE_RATE>32000<\/DIGITIZER_SAMPLE_RATE>/u);
});

test('a repeated mastering segment gets an independent file-relative slate after each gap', () => {
	const delivered = ixmlForDeliveryRange(sourceIxml, { startFrame: 0, endFrame: 48_000 }, 48_000, 96_000, 24, {
		sequenceId: 'production', totalFrames: 200_000,
		segments: [9_600, 100_000].map((outputStartFrame, index) => ({ entryId: String(index), annotationId: 'slate', title: 'Slate',
			gapBeforeFrames: 9_600, outputStartFrame, outputEndFrame: outputStartFrame + 48_000,
			sourceStartFrame: 12_000, sourceEndFrame: 36_000, fadeInFrames: 0, fadeOutFrames: 0, metadata: {} })),
	})!;
	assert.match(delivered.rawXml, /<SYNC_POINT_COUNT>2<\/SYNC_POINT_COUNT>/u);
	assert.match(delivered.rawXml, /<SYNC_POINT_LOW>33600<\/SYNC_POINT_LOW>/u);
	assert.match(delivered.rawXml, /<SYNC_POINT_LOW>124000<\/SYNC_POINT_LOW>/u);
});

test('absolute clocks, digitizer-clock group offsets, and vendor metadata retain their original XML', () => {
	const extras = '<SYNC_POINT><SYNC_POINT_TYPE>ABSOLUTE</SYNC_POINT_TYPE><SYNC_POINT_FUNCTION>SLATE_GENERIC</SYNC_POINT_FUNCTION><SYNC_POINT_LOW>123456789</SYNC_POINT_LOW><SYNC_POINT_HIGH>1</SYNC_POINT_HIGH></SYNC_POINT>'
		+ '<SYNC_POINT><SYNC_POINT_TYPE>RELATIVE</SYNC_POINT_TYPE><SYNC_POINT_FUNCTION>GROUP_OFFSET</SYNC_POINT_FUNCTION><SYNC_POINT_LOW>96000</SYNC_POINT_LOW><SYNC_POINT_HIGH>0</SYNC_POINT_HIGH></SYNC_POINT>';
	const vendor = '<VENDOR_EXTENSION checksum="original"><FILE_SAMPLE_RATE>32000</FILE_SAMPLE_RATE><NOTE>Original &amp; retained</NOTE></VENDOR_EXTENSION>';
	const xml = sourceIxml.rawXml.replace('</SYNC_POINT_LIST>', `${extras}</SYNC_POINT_LIST>`).replace('</BWFXML>', `${vendor}</BWFXML>`);
	const delivered = ixmlForDeliveryRange(parseIxmlPayload(new TextEncoder().encode(xml)), { startFrame: 0, endFrame: 48_000 }, 48_000, 96_000, 24)!;
	assert.ok(delivered.rawXml.includes(extras));
	assert.ok(delivered.rawXml.includes(vendor));
	assert.match(delivered.rawXml, /<SYNC_POINT_COUNT>3<\/SYNC_POINT_COUNT>/u);
});

test('a recorder sync event overlapping a file cut is clipped to the audio actually delivered', () => {
	const xml = sourceIxml.rawXml.replace('</SYNC_POINT>', '<SYNC_POINT_EVENT_DURATION>24000</SYNC_POINT_EVENT_DURATION></SYNC_POINT>');
	const delivered = ixmlForDeliveryRange(parseIxmlPayload(new TextEncoder().encode(xml)), { startFrame: 6_000, endFrame: 36_000 }, 48_000, 96_000, 24)!;
	assert.match(delivered.rawXml, /<SYNC_POINT_LOW>36000<\/SYNC_POINT_LOW>/u);
	assert.match(delivered.rawXml, /<SYNC_POINT_EVENT_DURATION>24000<\/SYNC_POINT_EVENT_DURATION>/u);
});

test('ordinary empty redundant encoding declarations remain well-formed when filled for delivery', () => {
	const xml = sourceIxml.rawXml.replace('<FILE_SAMPLE_RATE>48000</FILE_SAMPLE_RATE>', '<FILE_SAMPLE_RATE/>');
	const delivered = ixmlForDeliveryRange(parseIxmlPayload(new TextEncoder().encode(xml)), { startFrame: 0, endFrame: 48_000 }, 48_000, 96_000, 24)!;
	assert.match(delivered.rawXml, /<FILE_SAMPLE_RATE>96000<\/FILE_SAMPLE_RATE>/u);
});
