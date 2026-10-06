/* SPDX-License-Identifier: AGPL-3.0-only */
// Operation-count probes; fake canvas calls do not measure real paint time.
import { performance } from 'node:perf_hooks';
import { createBoundarySnapIndex, resolveBoundarySnap } from '../../src/common/editor/ui/timeline/boundary-snap.ts';
import { drawAudacityWaveformChannel } from '../../src/common/editor/audacity-waveform-renderer.js';

let membershipReads = 0;
let membershipTraversals = 0;
const observeIds = (ids, record) => new Proxy(ids, { get(target, key, receiver) {
	if (/^\d+$/u.test(String(key))) record();
	return Reflect.get(target, key, receiver);
} });
const clips = Array.from({ length: 10_000 }, (_, i) => ({ id: `c${i}`, kind: 'audio', timelineStartFrame: i * 1_000, durationFrames: 500 }));
const tracks = Array.from({ length: 100 }, (_, i) => {
	const ids = observeIds(clips.slice(i * 100, (i + 1) * 100).map(c => c.id), () => { membershipTraversals++; });
	return { id: `t${i}`, get clipIds() { membershipReads++; return ids; } };
});
const project = { clips, tracks };
const index = createBoundarySnapIndex(project);
membershipReads = 0;
const input = { project, index, frame: 25_502, currentTrackId: 't0', pixelsPerSecond: 1_000, sampleRate: 1_000 };
for (let i = 0; i < 10; i++) resolveBoundarySnap(input);
membershipReads = 0;
membershipTraversals = 0;
const start = performance.now();
for (let i = 0; i < 500; i++) resolveBoundarySnap(input);
const elapsed = performance.now() - start;

let rmsReads = 0;
let fills = 0;
let strokes = 0;
const rms = new Proxy(new Float32Array(1_000).fill(0.2), { get(target, key) { if (/^\d+$/.test(String(key))) rmsReads++; return Reflect.get(target, key, target); } });
const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '', fillRect() { fills++; }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { strokes++; }, arc() {}, fill() {} };
const summary = { mode: 'summary', pixelWidth: 1_000, channels: [{ minimum: new Float32Array(1_000).fill(-0.5), maximum: new Float32Array(1_000).fill(0.5), rms }] };
drawAudacityWaveformChannel(ctx, summary, { width: 1_000, centerY: 50, maxAmplitude: 40, showRms: false });
const offRms = { rmsReads, fills };
strokes = 0;
drawAudacityWaveformChannel(ctx, { mode: 'connecting-dots', pixelWidth: 1_000, pixelsPerSample: 0.5, channels: [{ samples: new Float32Array(2_000).fill(0.5), firstSampleX: 0 }] }, { width: 1_000, centerY: 50, maxAmplitude: 40 });
const connectingStrokes = strokes;
let largeMembershipReads = 0;
let largeMembershipTraversals = 0;
const largeClips = Array.from({ length: 100_000 }, (_, i) => ({ id: `l${i}`, kind: 'audio', timelineStartFrame: i * 1_000, durationFrames: 500 }));
const largeProject = { clips: largeClips, tracks: Array.from({ length: 100 }, (_, i) => {
	const ids = observeIds(largeClips.slice(i * 1_000, (i + 1) * 1_000).map(c => c.id), () => { largeMembershipTraversals++; });
	return { id: `t${i}`, get clipIds() { largeMembershipReads++; return ids; } };
}) };
const largeIndex = createBoundarySnapIndex(largeProject);
const largeInput = { ...input, project: largeProject, index: largeIndex };
const largeDurations = [];
for (let run = 0; run < 6; run++) {
	largeMembershipReads = 0; largeMembershipTraversals = 0;
	const t = performance.now();
	for (let i = 0; i < 100; i++) resolveBoundarySnap(largeInput);
	if (run > 0) largeDurations.push(performance.now() - t);
}
largeDurations.sort((a,b) => a - b);
strokes = 0;
drawAudacityWaveformChannel(ctx, { mode: 'stem', pixelWidth: 4_000, pixelsPerSample: 4, channels: [{ samples: new Float32Array(1_000).fill(0.5), firstSampleX: 0 }] }, { width: 4_000, centerY: 50, maxAmplitude: 40, centerLineColor: '#000' });
console.log(JSON.stringify({ node: process.version, snap: { clips: clips.length, queries: 500, membershipReads, membershipTraversals, elapsedMs: elapsed }, largeSnap: { clips: 100_000, queries: 100, membershipReads: largeMembershipReads, membershipTraversals: largeMembershipTraversals, samplesMs: largeDurations, medianMs: largeDurations[2] }, waveformRmsDisabled: offRms, connectingDots: { samples: 2_000, strokes: connectingStrokes }, unitScaleSampleStems: { samples: 1_000, strokes } }, null, 2));
