/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createVideoEffectService, type VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createVideoClip } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createSetVideoKeyframesCommand } from '../src/common/editor/commands.js';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { cloneVideoKeyframeCarrierFields } from '../src/common/editor/commands/video-keyframe-carrier.ts';

const REF = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 73, size: 2,
	domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const cube = (lut: unknown = REF, enabled = true) => ({ id: 'cube', type: 'cube-lut-profile-v1', enabled, params: { lut } });
const view = (value: unknown) => value as VideoEffectProject;
function options() {
	const base = framescaperV20Options();
	return { ...base, clips: (base.clips as readonly Readonly<Record<string, unknown>>[]).map(clip => clip.id === 'video-clip' ? { ...clip, videoEffects: [cube()] } : clip) };
}

test('current Frame construction and clone retain explicit resource leaves while old foundation and no-context fixtures refuse them', () => {
	const current = createFramescaperProjectFinishing(PROFILE, options());
	const restored = cloneFramescaperProjectFinishing(PROFILE, current);
	const clip = view(restored).clips.find(row => row.id === 'video-clip');
	assert.deepEqual(clip?.videoEffects, [cube()]);
	assert.throws(() => createAudioEditorProjectV17(options()), /Unsupported|unsupported/u);
	assert.throws(() => createVideoClip({ id: 'fixture', sourceId: 'video-source', durationFrames: 10, videoEffects: [cube(null)] }), /Unsupported|unsupported/u);
	assert.throws(() => cloneVideoKeyframeCarrierFields(clip), /Unsupported|unsupported/u);
	assert.throws(() => createFramescaperProjectFinishing(PROFILE, { ...options(), clips: options().clips.map(row => row.id === 'video-clip'
		? { ...row, videoEffects: [cube({ ...REF, body: 'smuggled' }, false)] } : row) }));
});

test('the real current Frame effect service adds null, attaches an exact reference, toggles and reorders through owning commands', () => {
	let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options());
	const generation = new EditorProjectGeneration(); generation.activate(view(project).id);
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() },
		copy: { projectReadOnly: 'Read only' }, getProject: () => view(project), captureProject: () => generation.capture(view(project).id),
		assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
		commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return view(project); }, publishDocumentSnapshot() {},
	});
	assert.equal(service.addVideoClipEffect('video-clip', 'cube-lut-profile-v1', { id: 'cube' }), 'cube');
	service.updateVideoClipEffect('video-clip', 'cube', { params: { lut: REF } });
	service.addVideoClipEffect('video-clip', 'tone-ladder-v1', { id: 'tone', params: { exposure: 1 } });
	service.reorderVideoClipEffect('video-clip', 'cube', 1); service.toggleVideoClipEffect('video-clip', 'cube', false);
	const clip = view(cloneFramescaperProjectFinishing(PROFILE, project)).clips.find(row => row.id === 'video-clip');
	assert.deepEqual(clip?.videoEffects?.map(effect => effect.type), ['tone-ladder-v1', 'cube-lut-profile-v1']);
	assert.deepEqual(clip?.videoEffects?.[1], cube(REF, false));
	assert.throws(() => service.beginVideoEffectGesture('video-clip', 'cube'), /discrete|resource|numeric/iu);
});

test('current Frame composition keyframe commands retain the discrete LUT and reject interpolation of its reference', () => {
	const project = createFramescaperProjectFinishing(PROFILE, options());
	const clip = view(project).clips.find(row => row.id === 'video-clip') as unknown as Readonly<Record<string, unknown>>;
	const expected = clip.videoKeyframes as Readonly<{ timeDomain: Readonly<{ viewDuration: Readonly<{ num: number; den: number }> }> }>;
	const next = { ...expected, curves: [{ target: { kind: 'composition', parameterId: 'opacity' },
		curve: { anchors: [{ position: { num: 0, den: 1 }, value: 0.25 }, { position: expected.timeDomain.viewDuration, value: 0.75 }],
			segments: [{ kind: 'linear' }] } }] };
	const edited = applyFramescaperProjectCommandFinishing(PROFILE, project,
		createSetVideoKeyframesCommand('video-clip', expected, next));
	const restored = view(cloneFramescaperProjectFinishing(PROFILE, edited)).clips.find(row => row.id === 'video-clip') as unknown as Readonly<Record<string, unknown>>;
	assert.deepEqual(restored.videoEffects, [cube()]); assert.deepEqual(restored.videoKeyframes, next);
	assert.throws(() => applyFramescaperProjectCommandFinishing(PROFILE, project,
		createSetVideoKeyframesCommand('video-clip', expected, { ...next, curves: [{ ...next.curves[0],
			target: { kind: 'video-effect', effectId: 'cube', parameterId: 'lut' } }] })), /numeric|interpol/iu);
});

test('current Frame splitting retains the discrete resource and partitions keyframe views with independent effect IDs', () => {
	const project = createFramescaperProjectFinishing(PROFILE, options());
	const split = applyFramescaperProjectCommandFinishing(PROFILE, project, {
		type: 'clip/split', clipId: 'video-clip', atFrame: 24_000,
		rightClipId: 'right-video', rightVideoEffectIds: ['right-cube'],
	});
	const clips = view(cloneFramescaperProjectFinishing(PROFILE, split)).clips.filter(row => row.kind === 'video');
	assert.equal(clips.length, 2);
	assert.deepEqual(clips[0]?.videoEffects, [cube()]);
	assert.deepEqual(clips[1]?.videoEffects, [{ ...cube(), id: 'right-cube' }]);
	assert.notStrictEqual(clips[0]?.videoEffects?.[0]?.params.lut, clips[1]?.videoEffects?.[0]?.params.lut);
	for (const clip of clips) {
		const value = clip as unknown as { videoKeyframes: { timeDomain: { viewDuration: { num: number; den: number } } } };
		assert.deepEqual(value.videoKeyframes.timeDomain.viewDuration, { num: 5, den: 1 });
	}
	const joined = applyFramescaperProjectCommandFinishing(PROFILE, split, { type: 'clip/join', clipIds: ['video-clip', 'right-video'] });
	assert.deepEqual(view(joined).clips.find(row => row.id === 'video-clip')?.videoEffects, [cube()]);
	const result = view(joined).clips.find(row => row.id === 'video-clip') as unknown as { videoKeyframes: { timeDomain: { viewDuration: { num: number; den: number } } } };
	assert.deepEqual(result.videoKeyframes.timeDomain.viewDuration, { num: 10, den: 1 });
	assert.deepEqual(view(project).clips.find(row => row.id === 'video-clip')?.videoEffects, [cube()]);
});

test('current Frame bin move and placement preserve resource custody and detach the regenerated leaf', () => {
	const project = createFramescaperProjectFinishing(PROFILE, options());
	const moved = applyFramescaperProjectCommandFinishing(PROFILE, project, {
		type: 'project-bin/move-from-timeline', clipIds: ['video-clip'],
	});
	const placed = applyFramescaperProjectCommandFinishing(PROFILE, moved, {
		type: 'project-bin/place', binClipId: 'video-clip', timelineStartFrame: 0,
		placements: [{ binClipId: 'video-clip', trackId: 'video-track', clipId: 'placed-video', videoEffectIds: ['placed-cube'] }],
	});
	const restored = cloneFramescaperProjectFinishing(PROFILE, placed);
	assert.deepEqual(view(restored).clips.find(row => row.id === 'placed-video')?.videoEffects, [{ ...cube(), id: 'placed-cube' }]);
	const bin = restored.projectBin as { clips: VideoEffectProject['clips'] };
	assert.deepEqual(bin.clips.find(row => row.id === 'video-clip')?.videoEffects, [cube()]);
});
