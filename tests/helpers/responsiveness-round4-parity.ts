/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { removeSource, reprobeSource, rewriteSourceMedia, updateSource } from '../../src/common/editor/commands/project-source-record-runtime.js';
import { createEffectsVideoRuntimeHandlers } from '../../src/common/editor/commands/effects-video-runtime.js';
import { createTrackMixerLabelRuntimeHandlers, removeTracksAndDependents } from '../../src/common/editor/commands/track-mixer-label-runtime.js';
import { installAudioTrackFreezeCandidateV21, removeAudioTrackFreezeCandidateV21, commitAudioTrackFreezeCandidateV21 } from '../../src/common/editor/audio-track-freeze-lifecycle-v21.ts';
import { createAudioSource, createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createEffect } from '../../src/common/editor/effects.js';
import { createVideoEffect } from '../../src/common/editor/video-effects.js';
import { commandFixture } from './round3-command-fixtures.ts';
import { freezeWorkFixture } from './responsiveness-round4-fixtures.ts';

import { applySoundscaperMixerSurfaceCommand } from '../../src/soundscaper/editor-project-mixer-surface.ts';
import { applySoundscaperProjectCommand } from '../../src/soundscaper/editor-project-commands.ts';
import { mixerSurfaceFixture } from './responsiveness-round4-surface-fixtures.ts';

type Data = Record<string, unknown>;
export interface ParityCase { readonly name: string; readonly hash: string; readonly captured: unknown }
function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
	return value;
}
export function editingParityCases(): ParityCase[] {
	const output: ParityCase[] = [];
	const capture = (name: string, draft: unknown, invoke: () => unknown) => {
		let result: unknown, error: { name: string; message: string } | null = null;
		try { result = invoke(); } catch (failure) {
			if (!(failure instanceof Error)) throw failure;
			error = { name: failure.name, message: failure.message };
		}
		const captured = canonical({ draft, result: result === undefined ? { undefinedResult: true } : result, error });
		output.push({ name, captured, hash: createHash('sha256').update(JSON.stringify(captured)).digest('hex') });
	};
	const effects = createEffectsVideoRuntimeHandlers(), mixer = createTrackMixerLabelRuntimeHandlers();
	for (const video of [false, true]) for (const count of [1, 4, 12]) for (const variant of ['valid', 'missing', 'duplicate-source', 'missing-move', 'bounds', 'duplicate-move', 'bin-only', 'sparse-move', 'custom-map']) {
		const source = video ? createVideoSource({ id: 'source', storageKey: 'original', frameCount: 48_000, sampleRate: 48_000, width: 640, height: 360,
			frameRate: { num: 30, den: 1 }, sourceFrameCount: 30, hasAudio: false, videoCodec: 'vp9', audioCodec: null })
			: createAudioSource({ id: 'source', storageKey: 'original', frameCount: 100, channelCount: 1, sampleRate: 48_000 });
		const clips = Array.from({ length: count }, (_, index) => ({ id: `clip-${String(index)}`, sourceId: 'source', kind: video ? 'video' : 'audio', sourceStartFrame: 0, sourceDurationFrames: 5, durationFrames: 5 }));
		const project = { sampleRate: 48_000, sources: [{ ...source, id: 'other' }, { ...source }], clips: variant === 'bin-only' ? [] : clips.slice(0, 1), projectBin: { clips: variant === 'bin-only' ? clips : clips.slice(1) } };
		if (variant === 'duplicate-source') project.sources.push({ ...source });
		const moves = clips.map(clip => video ? { clipId: clip.id, sourceInFrame: 0, sourceFrameCount: variant === 'bounds' ? 31 : 5 } : { clipId: clip.id, sourceStartFrame: variant === 'bounds' ? 51 : 0 });
		if (variant === 'sparse-move') moves.length += 1;
		if (variant === 'custom-map') Object.defineProperty(moves, 'map', { value: () => [] });
		if (variant === 'missing-move') moves.pop();
		if (variant === 'duplicate-move') moves.push(video ? { clipId: 'clip-0', sourceInFrame: 1, sourceFrameCount: 4 } : { clipId: 'clip-0', sourceStartFrame: 1 });
		capture(`source-${video ? 'reprobe' : 'rewrite'}-${String(count)}-${variant}`, project, () => video
			? reprobeSource(project, { sourceId: variant === 'missing' ? 'absent' : 'source', changes: {}, clips: moves })
			: rewriteSourceMedia(project, { sourceId: variant === 'missing' ? 'absent' : 'source', changes: { storageKey: 'rewritten', frameCount: 50 }, clips: moves }));
	}
	for (const variant of ['timeline', 'bin', 'unused', 'unknown', 'sparse-bin', 'custom-iterator']) {
		const project = { sources: [{ id: 'source' }], clips: variant === 'timeline' ? [{ sourceId: 'source' }] : [], projectBin: { clips: variant === 'bin' ? [{ sourceId: 'source' }] : [] as { sourceId: string }[] } };
		if (variant === 'sparse-bin') project.projectBin.clips.length = 1;
		if (variant === 'custom-iterator') Object.defineProperty(project.projectBin.clips, Symbol.iterator, { value: function* () { yield { sourceId: 'source' }; } });
		capture(`source-remove-${variant}`, project, () => removeSource(project, variant === 'unknown' ? 'absent' : 'source'));
	}
	for (const video of [false, true]) for (const operation of ['add', 'remove', 'reorder']) for (const variant of ['valid', 'same', 'missing', 'duplicate', 'negative', 'frozen', 'custom-splice']) {
		const project = commandFixture(2, 2);
		const first = video ? createVideoEffect('pixelate', { id: 'first' }) : createEffect('highpass', { id: 'first' });
		const last = video ? createVideoEffect('pixelate', { id: 'last' }) : createEffect('highpass', { id: 'last' });
		const rack = [first, last];
		if (variant === 'frozen') Object.freeze(rack);
		if (variant === 'custom-splice') Object.defineProperty(rack, 'splice', { value: function (start: number, count: number, ...items: unknown[]) { return Reflect.apply(Array.prototype.splice, this, [start, count, ...items]) as unknown[]; } });
		if (video) Object.assign(project.clips[0]!, { kind: 'video', videoEffects: rack, videoKeyframes: { curves: [{ target: { kind: 'video-effect', effectId: 'first' } }, { target: { kind: 'composition', parameterId: 'opacity' } }] } });
		else (project.master as { effects: unknown[] }).effects = rack;
		const added = video ? createVideoEffect('pixelate', { id: variant === 'duplicate' ? 'first' : 'added' }) : createEffect('highpass', { id: variant === 'duplicate' ? 'first' : 'added' });
		const command = { scope: 'master', clipId: 'clip-0', effectId: variant === 'missing' ? 'absent' : 'first', effect: added, toIndex: variant === 'negative' ? -1 : variant === 'same' ? 0 : 1 };
		capture(`effect-${video ? 'video' : 'audio'}-${operation}-${variant}`, project, () => effects[`${video ? 'video-effect' : 'effect'}/${operation}` as keyof typeof effects](project, command));
	}
	for (const count of [2, 4, 8]) for (let index = 0; index < count; index++) for (const duplicate of [false, true]) {
		const project = commandFixture(count, count);
		project.tracks.forEach((track, ordinal) => { track.laneGroupId = `group-${String(Math.floor(ordinal / 2))}`; });
		if (duplicate) project.tracks.at(-1)!.id = 'track-0';
		capture(`lane-${String(count)}-${String(index)}-${String(duplicate)}`, project, () => mixer['track/reorder'](project, { trackId: 'track-0', index }));
	}
	for (const variant of ['ordered', 'reverse', 'unknown', 'invalid-duck', 'aliased-rack', 'missing-effects', 'sparse-membership']) {
		const project = commandFixture(6, 6);
		for (let index = 2; index < 6; index++) project.tracks[index]!.effects = [createEffect('audacity-auto-duck', { id: `duck-${String(index)}`, context: { controlTrackId: index % 2 ? 'track-1' : 'track-0' } })];
		if (variant === 'invalid-duck') (project.tracks[3]!.effects as Data[])[0]!.params = { duckAmountDb: Infinity };
		if (variant === 'aliased-rack') (project.master as { effects: unknown }).effects = project.tracks[2]!.effects;
		if (variant === 'missing-effects') project.mixer = { groups: [{ id: 'bad' }], sends: [], routes: { 'track-0': {}, 'track-1': {} } };
		if (variant === 'sparse-membership') { project.tracks[0]!.clipIds.length = 2; delete project.tracks[0]!.clipIds[0]; }
		capture(`track-remove-${variant}`, project, () => removeTracksAndDependents(project, variant === 'reverse' ? ['track-1', 'track-0'] : variant === 'unknown' ? ['absent'] : ['track-0', 'track-1']));
	}
	for (const variant of ['valid', 'duplicate-existing', 'duplicate-new', 'late-null', 'empty']) {
		const project = commandFixture(2);
		(project.master as { effects: unknown[] }).effects = [createEffect('highpass', { id: 'existing' })];
		if (variant === 'late-null') project.tracks[0]!.effects = [null];
		const inserted = variant === 'empty' ? [] : [createEffect('highpass', { id: variant === 'duplicate-existing' || variant === 'late-null' ? 'existing' : 'new' }), createEffect('highpass', { id: variant === 'duplicate-new' ? 'new' : 'second' })];
		capture(`bus-add-${variant}`, project, () => mixer['mixer/bus-add'](project, { busType: 'group', bus: { id: 'bus', effects: inserted } }));
	}
	for (const variant of ['valid', 'missing', 'invalid', 'delete', 'duplicate-id', 'getter-changes-bus', 'conversion-changes-bus']) {
		const project = commandFixture(1);
		const sends = [{ id: 'send-0', effects: [] }, { id: 'send-1', effects: [] }];
		if (variant === 'duplicate-id') sends.push({ ...sends[0]! });
		project.mixer = { groups: [], sends, routes: {} };
		const values: Data = { 'send-0': variant === 'delete' ? null : variant === 'invalid' ? Infinity : 1, 'send-1': 1 };
		if (variant === 'missing') values.absent = 1;
		if (variant === 'getter-changes-bus') Object.defineProperty(values, 'send-0', { enumerable: true, get() { sends.pop(); return 1; } });
		if (variant === 'conversion-changes-bus') values['send-0'] = { valueOf() { sends.pop(); return 1; } };
		capture(`route-${variant}`, project, () => mixer['mixer/route-update'](project, { trackId: 'track-0', changes: { sends: values } }));
	}
	for (const operation of ['install', 'remove', 'commit']) for (const count of [1, 3, 8]) for (const variant of ['valid', 'stale', 'missing-target', 'duplicate-clip', 'duplicate-source', 'bad-later-record', 'duplicate-before-bad', 'extra-unrelated-duplicate', 'missing-input']) {
		const fixture = freezeWorkFixture(count, operation !== 'install');
		const { project, freeze, digests, derivedClip, derivedSource, sourceContentIdentities } = fixture;
		if (variant === 'duplicate-clip' || variant === 'duplicate-before-bad') project.clips.push({ ...project.clips[0]! });
		if (variant === 'duplicate-source') project.sources.push({ ...project.sources[0]! });
		if (variant === 'bad-later-record' || variant === 'duplicate-before-bad') project.clips.push(null as unknown as typeof project.clips[number]);
		if (variant === 'extra-unrelated-duplicate') project.clips.push({ ...project.clips[0]!, id: 'unrelated' }, { ...project.clips[0]!, id: 'unrelated' });
		if (variant === 'missing-input') project.tracks[0]!.clipIds = ['absent'];
		const expected = variant === 'stale' ? { ...freeze, derivedSourceId: 'other' } : freeze;
		const trackId = variant === 'missing-target' ? 'absent' : 'target';
		capture(`freeze-${operation}-${String(count)}-${variant}`, project, () => operation === 'install'
			? installAudioTrackFreezeCandidateV21(project, { trackId, expectedFreeze: null, replacementFreeze: freeze, derivedSource, sourceContentIdentities })
			: operation === 'remove' ? removeAudioTrackFreezeCandidateV21(project, { trackId, expectedFreeze: expected })
				: commitAudioTrackFreezeCandidateV21(project, { trackId, expectedFreeze: expected, operationDigests: digests, derivedSourceContentSha256: 'a'.repeat(64), derivedClip }));
	}
	for (const variant of ['valid', 'forbidden', 'missing', 'invalid-name']) {
		const project = { sources: [createAudioSource({ id: 'source', storageKey: 'source', frameCount: 100, channelCount: 1, sampleRate: 48_000 })] };
		capture(`source-update-${variant}`, project, () => updateSource(project, variant === 'missing' ? 'absent' : 'source', variant === 'forbidden' ? { frameCount: 1 } : { name: variant === 'invalid-name' ? {} : 'renamed' }));
	}
	for (const kind of ['audio', 'video', 'label']) for (const variant of ['valid', 'forbidden', 'missing', 'invalid']) {
		const project = commandFixture(1);
		Object.assign(project.tracks[0]!, { type: kind, ...(kind === 'label' ? { labels: [] } : {}) });
		capture(`track-update-${kind}-${variant}`, project, () => mixer['track/update'](project, { trackId: variant === 'missing' ? 'absent' : 'track-0', changes: variant === 'forbidden' ? { unsupported: 1 } : { name: variant === 'invalid' ? {} : 'renamed' } }));
	}
	for (const changes of [{ gain: 0.5 }, { unsupported: 1 }, { gain: Infinity }, { gain: -1 }, {}]) {
		const project = commandFixture(1);
		capture(`master-update-${String(output.length)}`, project, () => mixer['master/update'](project, { changes }));
	}
	for (const variant of ['sparse-removed', 'appended-removed', 'custom-flat-map']) {
		const project = commandFixture(2, 2), tracks = project.tracks;
		const removed = variant === 'sparse-removed' ? Object.assign(new Array<typeof tracks[number]>(2), { 0: tracks[0]! }) : [tracks[0]!];
		if (variant === 'appended-removed') Object.defineProperty(tracks[0]!, 'clipIds', { get() { removed.push(tracks[1]!); return ['clip-0']; } });
		if (variant === 'custom-flat-map') Object.defineProperty(removed, 'flatMap', { value: () => ['clip-1'] });
		let calls = 0;
		Object.defineProperty(tracks, 'filter', { value: function (callback: (value: unknown, index: number, array: unknown[]) => unknown) {
			if (calls++ === 0) return removed; return Array.prototype.filter.call(this, callback) as unknown[];
		} });
		capture(`track-remove-${variant}`, project, () => removeTracksAndDependents(project, ['track-0']));
	}
	for (const count of [1, 4, 12]) for (const variant of ['bus-add', 'bus-duplicate-group', 'bus-duplicate-send', 'group-route', 'group-clear', 'group-missing', 'sends-new', 'sends-delete', 'sends-invalid', 'sends-missing']) {
		const project = mixerSurfaceFixture(count);
		const command = variant.startsWith('bus') ? { type: 'mixer/bus-add' as const, busType: 'group' as const,
			bus: { id: variant === 'bus-duplicate-group' ? 'group-0' : variant === 'bus-duplicate-send' ? 'send-0' : 'added' } }
			: { type: 'mixer/route-update' as const, trackId: 'track', changes: variant.startsWith('group')
				? { groupId: variant === 'group-clear' ? null : variant === 'group-missing' ? 'absent' : `group-${String(count - 1)}` }
				: { sends: Object.fromEntries(project.mixer.sends.map(send => [variant === 'sends-missing' ? 'absent' : send.id, variant === 'sends-delete' ? null : variant === 'sends-invalid' ? '1' : 1])) } };
		capture(`soundscaper-surface-${String(count)}-${variant}`, project, () => applySoundscaperMixerSurfaceCommand(project, command));
	}
	for (const variant of ['new-send', 'existing-send', 'delete-send', 'advanced-send', 'duplicate-send']) {
		const initial = mixerSurfaceFixture(2);
		const edge = { id: 'send:track:track:mixer-node:send-0', kind: 'send' as const, source: { kind: 'track' as const, id: 'track' },
			destination: { kind: 'mixer-node' as const, id: 'send-0' }, position: variant === 'advanced-send' ? 'pre-fader' as const : 'post-fader' as const,
			level: 1, enabled: true, channelMap: [0, 1] };
		const project = variant === 'new-send' ? initial : { ...initial, mixer: { ...initial.mixer, edges: [...initial.mixer.edges, edge,
			...(variant === 'duplicate-send' ? [{ ...edge, id: 'other-send' }] : [])] } };
		capture(`soundscaper-surface-${variant}`, project, () => applySoundscaperMixerSurfaceCommand(project, { type: 'mixer/route-update', trackId: 'track', changes: { sends: { 'send-0': variant === 'delete-send' ? null : 0.5 } } }));
	}
	for (const variant of ['bus-add', 'group-route', 'sends-new', 'sends-missing']) {
		const project = mixerSurfaceFixture(2);
		const command = variant === 'bus-add' ? { type: 'mixer/bus-add' as const, busType: 'group' as const, bus: { id: 'added' } }
			: { type: 'mixer/route-update' as const, trackId: 'track', changes: variant === 'group-route'
				? { groupId: 'group-1' } : { sends: { [variant === 'sends-missing' ? 'absent' : 'send-0']: 1 } } };
		capture(`soundscaper-public-${variant}`, project, () => applySoundscaperProjectCommand(project, command, { now: '2026-10-07T00:00:00.000Z' }));
	}
	for (const mode of ['reprobe', 'rewrite']) for (const variant of ['accessor-slot', 'changes-first-authority']) {
		const first = createVideoSource({ id: 'target', storageKey: 'target', frameCount: 480_000, sampleRate: 48_000, width: 640, height: 360,
			frameRate: { num: 30, den: 1 }, sourceFrameCount: 300, hasAudio: false, videoCodec: 'vp9', audioCodec: null });
		const audio = createAudioSource({ id: 'target', storageKey: 'target', frameCount: 1000, channelCount: 1, sampleRate: 48_000 });
		const initial = mode === 'reprobe' ? first : audio;
		const project = { sampleRate: 48_000, sources: [{ ...initial, id: 'other', storageKey: 'other' }, { ...initial }], clips: [], projectBin: { clips: [] } };
		let changes: Data = mode === 'reprobe' ? {} : { storageKey: 'trimmed', frameCount: 100 };
		if (variant === 'accessor-slot') { let reads = 0, stored: unknown;
			Object.defineProperty(project.sources, '1', { enumerable: true, configurable: true, get() { return stored || (reads++ === 0 ? initial : audio); }, set(value: unknown) { stored = value; } });
		} else changes = Object.defineProperty({}, mode === 'reprobe' ? 'width' : 'storageKey', { enumerable: true, get() { project.sources[0]!.id = 'target'; return mode === 'reprobe' ? 641 : 'trimmed'; } });
		capture(`source-${mode}-${variant}`, project, () => mode === 'reprobe' ? reprobeSource(project, { sourceId: 'target', changes, clips: [] }) : rewriteSourceMedia(project, { sourceId: 'target', changes, clips: [] }));
	}
	for (const variant of ['inherited-clip-bound', 'coercing-clip-bound', 'custom-source-find', 'inherited-source-kind', 'mapped-species']) {
		const source = createVideoSource({ id: 'target', storageKey: 'target', frameCount: 480_000, sampleRate: 48_000, width: 640, height: 360,
			frameRate: { num: 30, den: 1 }, sourceFrameCount: 300, hasAudio: false, videoCodec: 'vp9', audioCodec: null });
		const project = { sampleRate: 48_000, sources: [{ ...source, id: 'other', sourceFrameCount: 1 }, { ...source }],
			clips: Array.from({ length: 20 }, (_, index) => ({ id: `clip-${String(index)}`, sourceId: 'target', sourceStartFrame: 0, sourceDurationFrames: 10, durationFrames: 10 })), projectBin: { clips: [] } };
		let payload: unknown[] = [];
		if (variant === 'inherited-clip-bound') { delete (project.clips[0]! as { sourceStartFrame?: unknown }).sourceStartFrame; Object.setPrototypeOf(project.clips[0]!, { get sourceStartFrame() { project.sources[0]!.id = 'target'; return 0; } }); }
		if (variant === 'coercing-clip-bound') Object.assign(project.clips[0]!, { sourceStartFrame: { valueOf() { project.sources[0]!.id = 'target'; return 0; } } });
		if (variant === 'custom-source-find') { let calls = 0; Object.defineProperty(project.sources, 'find', { value: () => project.sources[calls++ < 2 ? 1 : 0] }); }
		if (variant === 'inherited-source-kind') { const selected: Data = { ...source }; delete selected.kind; Object.setPrototypeOf(selected, { get kind() { project.sources[0]!.id = 'target'; return 'video'; } }); Object.defineProperty(payload, 'map', { value: () => { project.sources[1] = selected as typeof source; return []; } }); }
		if (variant === 'mapped-species') { payload = project.clips.map(clip => ({ clipId: clip.id, sourceInFrame: 1, sourceFrameCount: 9 })); Object.defineProperty(payload, 'constructor', { value: { [Symbol.species]: class extends Array<unknown> { [Symbol.iterator]() { return ([] as unknown[]).values(); } } } }); }
		capture(`source-reprobe-${variant}`, project, () => reprobeSource(project, { sourceId: 'target', changes: {}, clips: payload }));
	}
	{ const project = commandFixture(4, 4); project.tracks.forEach((track, index) => { track.laneGroupId = `lane-${String(Math.floor(index / 2))}`; });
		Object.defineProperty(project.tracks, 'filter', { value: function (predicate: (value: unknown, index: number, array: unknown[]) => unknown) { return (Array.prototype.filter.call(this, predicate) as unknown[]).reverse(); } });
		capture('lane-custom-filter', project, () => mixer['track/reorder'](project, { trackId: 'track-0', index: 3 }));
	}
	return output;
}
