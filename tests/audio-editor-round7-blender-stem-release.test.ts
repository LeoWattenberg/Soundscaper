/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { publishBlenderTracks, type BlenderRenderProject } from '../src/common/editor/controller/export/blender-publication.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createAudioTrack, createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import type { BlenderBridge, BlenderBeginRequest } from '../src/common/editor/blender-contract.ts';

const RATE = 48_000;
function fixture(mute: boolean, soloElsewhere = false, delayed = true, busMuted = false) {
	let project = createSoundscaperProject({ id: 'blender-release', title: 'Blender release', now: '2026-10-10T00:00:00.000Z',
		tracks: [createAudioTrack({ id: 'delayed', name: 'Delayed', mute, clipIds: ['recording'],
			effects: delayed ? [createEffect('delay', { params: { time: 1, feedback: 0, mix: 1 } })] : [] }),
			...(soloElsewhere ? [createAudioTrack({ id: 'other', name: 'Other', solo: true, clipIds: [] })] : [])],
		sources: [createAudioSource({ id: 'source', name: 'Recording', sampleRate: RATE, channelCount: 2, frameCount: RATE })],
		clips: [createAudioClip({ id: 'recording', sourceId: 'source', durationFrames: RATE,
			sourceDurationFrames: RATE, timelineStartFrame: 0 })],
	});
	if (busMuted) {
		project = applySoundscaperProjectCommand(project, { type: 'mixer/bus-add', busType: 'group',
			bus: { id: 'bus', name: 'Muted group', mute: true } });
		const mixer = project.mixer;
		project = applySoundscaperProjectCommand(project, { type: 'mixer-graph/set', expected: mixer as unknown as Readonly<Record<string, unknown>>,
			mixer: { ...mixer, edges: mixer.edges.map(edge => edge.source.kind === 'track'
				? { ...edge, destination: { kind: 'mixer-node', id: 'bus' } } : edge) } });
	}
	return project;
}

for (const [name, mute, soloElsewhere, delayed, busMuted] of [['dry', false, false, false, false],
	['delayed', false, false, true, false], ['muted', true, false, true, false],
	['unsoloed', false, true, true, false], ['muted bus', true, false, true, true]] as const) {
	test(`Blender publishes its ${name} stem using the engine's source range and release contract`, async context => {
		const project = fixture(mute, soloElsewhere, delayed, busMuted);
		const before = structuredClone(project);
		const expectedFrames = RATE * (delayed && !busMuted ? 2 : 1);
		let begin: BlenderBeginRequest | null = null;
		let rendered: BlenderRenderProject | null = null;
		const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null,
			softwareRenderer: ({ captureStartFrame, endFrame, tailFrames, sampleRate }) => ({ sampleRate,
				channels: [new Float32Array(Number(endFrame) - Number(captureStartFrame) + Number(tailFrames))] }),
		});
		context.after(async () => { await engine.dispose(); });
		const bridge: BlenderBridge = {
			select: async () => ({ sessionId: 'session' }),
			begin: async value => { begin = value; return { publicationId: 'publication' }; },
			write: async () => undefined, commit: async () => ({ revision: 1 }),
			abort: async () => undefined, stop: async () => undefined,
		};
		await publishBlenderTracks({ getProject: () => project,
			renderSnapshot: async (snapshot, range) => {
				rendered = snapshot;
				engine.loadProject(snapshot as typeof project);
				return await engine.renderMix(range);
			},
		}, { bridge, sessionId: 'session', projectId: project.id, revision: project.revision });
		const publication = begin as BlenderBeginRequest | null;
		const snapshot = rendered as BlenderRenderProject | null;
		assert.ok(publication && snapshot);
		assert.equal(publication.tracks[0]?.durationSeconds, expectedFrames / RATE);
		assert.equal(publication.tracks[0]?.mute, mute || soloElsewhere);
		assert.equal(snapshot.tracks[0]?.mute, false);
		assert.equal(snapshot.tracks[0]?.solo, false);
		assert.deepEqual(project, before);
	});
}
