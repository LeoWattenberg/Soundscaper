/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';

/**
 * DAWproject acceptance: our project.xml and metadata.xml validate against the
 * schemas Bitwig publishes, checked by a validator that is not ours.
 *
 * The in-tree tests prove the writer agrees with the reader beside it. A writer
 * and its own reader can share a misunderstanding indefinitely, so the file is
 * additionally held to `Project.xsd` and `MetaData.xsd` from the reference
 * repository (vendored under tests/fixtures/dawproject with their MIT notice),
 * validated by the xmlschema package `scripts/provision-interchange-conformance.mjs`
 * provisions beside the OpenTimelineIO readers. If it is not provisioned the
 * test fails with the command to run rather than skipping.
 *
 * The XSD is generated from the reference Java model, so what it checks is
 * exactly what Bitwig's own reader will accept: element names, the order of
 * children, attribute types (`xs:int` where we might have written `4.0`), the
 * enumerations, and that every IDREF resolves to an xs:ID in the file.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..');
const REFERENCE_ROOT = resolve(REPO_ROOT, 'vendor/interchange-conformance');
const SCHEMA_ROOT = resolve(REPO_ROOT, 'tests/fixtures/dawproject');
const SAMPLE_RATE = 48_000;

const VALIDATOR = `
import sys, xmlschema
schema = xmlschema.XMLSchema(sys.argv[1])
errors = list(schema.iter_errors(sys.argv[2]))
for error in errors:
    print(str(error).replace("\\n", " "))
sys.exit(1 if errors else 0)
`;

function pythonExecutable(): string {
	return process.env.SOUNDSCAPER_PYTHON || 'python3';
}

let provisionChecked = false;

function ensureProvisioned(): void {
	if (provisionChecked) return;
	try {
		execFileSync(pythonExecutable(), ['-c', 'import xmlschema'], {
			stdio: 'ignore',
			env: { ...process.env, PYTHONPATH: REFERENCE_ROOT },
		});
	} catch {
		throw new Error(
			'The DAWproject schema validator is not provisioned.\n'
			+ '  Run: node scripts/provision-interchange-conformance.mjs\n'
			+ 'This suite proves our files against the published schema with a validator that is not ours, '
			+ 'so it refuses to pass without one rather than skipping.',
		);
	}
	provisionChecked = true;
}

/** Validate one document against one schema; the failure carries every violation the validator found. */
function validate(schema: 'Project' | 'MetaData', xml: string): void {
	ensureProvisioned();
	const directory = mkdtempSync(join(tmpdir(), 'soundscaper-dawproject-'));
	const file = join(directory, `${schema.toLowerCase()}.xml`);
	try {
		writeFileSync(file, xml);
		execFileSync(pythonExecutable(), ['-c', VALIDATOR, resolve(SCHEMA_ROOT, `${schema}.xsd`), file], {
			encoding: 'utf8',
			env: { ...process.env, PYTHONPATH: REFERENCE_ROOT },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (error) {
		const detail = error as { stdout?: string; stderr?: string };
		throw new Error(`${schema}.xsd rejected our ${schema.toLowerCase()}.xml:\n${detail.stdout || ''}${detail.stderr || ''}`, { cause: error });
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

/** Every feature the writer can emit, so the schema sees each element at least once. */
function fullProject() {
	return {
		id: 'p', title: 'Conformance', sampleRate: SAMPLE_RATE, masterChannels: 2, primarySequenceId: 'main-sequence',
		tempoMap: { mode: 'musical', events: [
			{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 30_000, den: 251 } },
			{ id: 'tempo-2', beat: { num: 16, den: 1 }, bpm: { num: 90, den: 1 } },
		] },
		signatureMap: { events: [
			{ id: 'sig-1', bar: 0, numerator: 4, denominator: 4 },
			{ id: 'sig-2', bar: 4, numerator: 7, denominator: 8 },
		] },
		metadata: { title: 'Conformance', artist: 'Someone & Someone', album: 'Album', year: '2026', comments: 'a <b> "c"' },
		sources: [
			{ kind: 'audio', id: 'src-a', name: 'Take 1.wav', frameCount: 96_000, channelCount: 2, sampleRate: SAMPLE_RATE },
			{ kind: 'audio', id: 'src-b', name: 'Loop.wav', frameCount: 44_100, channelCount: 1, sampleRate: 44_100 },
			{ kind: 'video', id: 'cam', name: 'cam.mp4', mimeType: 'video/mp4', sampleFrameCount: 2 * SAMPLE_RATE, sampleRate: SAMPLE_RATE, hasAudio: true },
		],
		clips: [
			{ kind: 'audio', id: 'c1', sourceId: 'src-a', title: 'Verse', timelineStartFrame: 4_801, durationFrames: 44_099, sourceStartFrame: 2_103, sourceDurationFrames: 44_099, fadeInFrames: 480, fadeOutFrames: 960, gain: 0.5 },
			{ kind: 'audio', id: 'c2', sourceId: 'src-b', title: 'Loop', timelineStartFrame: 0, durationFrames: 2 * SAMPLE_RATE, sourceStartFrame: 0, sourceDurationFrames: 44_100, speedRatio: 0.5 },
			{ kind: 'audio', id: 'c3', sourceId: 'src-a', title: 'Warped', timelineStartFrame: 3 * SAMPLE_RATE, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE,
				warpMap: { feature: 'audio-warp', points: [{ outer: 0, source: 0, mode: 'forward' }, { outer: 24_000, source: 12_000, mode: 'forward' }, { outer: SAMPLE_RATE, source: SAMPLE_RATE, mode: 'forward' }] } },
			{ kind: 'video', id: 'v1', sourceId: 'cam', title: 'Wide', timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: SAMPLE_RATE, speedRatio: 1 },
		],
		tracks: [
			{ type: 'audio', id: 't1', name: 'Vocals', clipIds: ['c1', 'c3'], gain: 0.8, pan: -0.5, mute: false, solo: true, effects: [], envelope: [{ frame: 0, value: 1 }, { frame: 2 * SAMPLE_RATE, value: 0.5 }] },
			{ type: 'audio', id: 't2', name: 'Loops', clipIds: ['c2'], gain: 1, pan: 0, mute: true, solo: false, effects: [] },
			{ type: 'video', id: 'vt', name: 'V1', clipIds: ['v1'], hidden: false },
			{ type: 'label', id: 'l1', name: 'Sections', labels: [{ id: 'lab1', title: 'Chorus', startFrame: 2 * SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE }] },
		],
		trackFolders: [{ id: 'f1', name: 'Band' }, { id: 'f2', name: 'Inner' }],
		sequences: [{ id: 'main-sequence', trackNodes: [
			{ kind: 'folder', id: 'f1', parentFolderId: null },
			{ kind: 'folder', id: 'f2', parentFolderId: 'f1' },
			{ kind: 'track', id: 't1', parentFolderId: 'f2' },
			{ kind: 'track', id: 't2', parentFolderId: null },
			{ kind: 'track', id: 'vt', parentFolderId: null },
			{ kind: 'track', id: 'l1', parentFolderId: null },
		] }],
		mixer: {
			groups: [{ id: 'f1', name: 'Band', gain: 0.9, pan: 0 }, { id: 'g1', name: 'Drums bus', gain: 1, pan: 0.25 }],
			sends: [{ id: 'fx1', name: 'Reverb', gain: 1, pan: 0 }],
			routes: { t1: { groupId: 'f1', sends: { fx1: 0.25 } }, t2: { groupId: 'g1', sends: {} } },
		},
		master: { gain: 1, pan: 0, mute: false, solo: false, effects: [] },
		automationLanes: [
			{ id: 'lane-pan', address: { kind: 'strip', strip: { kind: 'track', id: 't2' }, parameterId: 'pan' }, timebase: 'absolute-samples', points: [{ id: 'p1', position: 0, value: -1 }, { id: 'p2', position: SAMPLE_RATE, value: 1 }], segments: [{ kind: 'hold' }] },
			{ id: 'lane-mute', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'mute' }, timebase: 'absolute-samples', points: [{ id: 'p1', position: 0, value: 1 }, { id: 'p2', position: 10, value: 0 }], segments: [{ kind: 'hold' }] },
		],
		timelineAnnotations: [
			{ id: 'm1', kind: 'marker', name: 'Drop', timelineStartFrame: SAMPLE_RATE, timelineEndFrame: SAMPLE_RATE },
			{ id: 'r1', kind: 'region', name: 'Bridge', timelineStartFrame: 3 * SAMPLE_RATE, timelineEndFrame: 4 * SAMPLE_RATE },
		],
	};
}

test('a project exercising every emitted element validates against Project.xsd and MetaData.xsd', () => {
	const result = createDawprojectExport({
		project: fullProject(),
		application: { name: 'Soundscaper', version: '1.0.0-rc.1' },
		embeddableVideoSourceIds: ['cam'],
	});
	validate('Project', result.projectXml);
	validate('MetaData', result.metadataXml);
	assert.ok(result.projectXml.includes('<Warps'), 'the fixture reached the warp vocabulary');
	assert.ok(result.projectXml.includes('<Video'), 'the fixture reached the video vocabulary');
	assert.ok(result.projectXml.includes('<BoolPoint'), 'the fixture reached mute automation');
});

test('the smallest project — no tracks, no clips — still validates', () => {
	const result = createDawprojectExport({ project: { id: 'p', title: 'Empty', sampleRate: SAMPLE_RATE } });
	validate('Project', result.projectXml);
	validate('MetaData', result.metadataXml);
});

test('a project at an NTSC-style tempo and awkward sample counts validates with full-precision doubles', () => {
	const project = fullProject();
	const result = createDawprojectExport({ project: { ...project, sampleRate: 44_100 } });
	validate('Project', result.projectXml);
	assert.doesNotMatch(result.projectXml, /="-?[\d.]+[eE][+-]?\d+"/u, 'no exponent notation reaches the file');
});
