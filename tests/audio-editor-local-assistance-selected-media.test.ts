/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceSelectedMediaPreparation,
} from '../src/common/editor/controller/local-assistance-selected-media.ts';

const SOURCE_SHA256 = 'ab'.repeat(32);

function project(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'project-1', schemaVersion: 30, revision: 4, sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		selection: { startFrame: 48_000, endFrame: 96_000, clipIds: ['voice-clip'], trackIds: ['voice-track'] },
		sources: [{ id: 'voice-source', name: 'Interview', kind: 'audio',
			contentSha256: SOURCE_SHA256, sampleRate: 48_000, frameCount: 192_000 }],
		clips: [{ id: 'voice-clip', title: 'Interview clip', kind: 'audio', sourceId: 'voice-source',
			timelineStartFrame: 24_000, durationFrames: 144_000,
			sourceStartFrame: 12_000, sourceDurationFrames: 144_000,
			reversed: false, speedRatio: 1, pitchCents: 0, stretchToTempo: false,
			anchor: 'sample', warpMap: null, avLinkId: 'linked-1' },
			{ id: 'camera-clip', title: 'Camera', kind: 'video', sourceId: 'camera-source',
				sequenceId: 'main-sequence', avLinkId: 'linked-1' }],
		tracks: [{ id: 'voice-track', type: 'audio', name: 'Voice', clipIds: ['voice-clip'] },
			{ id: 'video-track', type: 'video', name: 'Camera', clipIds: ['camera-clip'] }],
		...overrides,
	};
}

function fixture(projectValue = project()) {
	let current = projectValue;
	const rendered: unknown[][] = [];
	const preparation = createLocalAssistanceSelectedMediaPreparation({
		getProject: () => current,
		getSelectedClipId: () => 'voice-clip',
		captureProject: () => ({ id: current.id, revision: current.revision }),
		assertProject: (token) => {
			assert.deepEqual(token, { id: current.id, revision: current.revision });
		},
		renderDryTrackRange: async (...args) => {
			rendered.push(args);
			const length = Number(args[2]) - Number(args[1]);
			return [Float32Array.from({ length }, (_, index) => index % 2 ? 0.5 : -0.5),
				Float32Array.from({ length }, () => 0.25)];
		},
	});
	return { preparation, rendered, setProject(value: ReturnType<typeof project>) { current = value; } };
}

test('selected-media inventory exposes only operations with an exact audio input', async () => {
	const { preparation, rendered } = fixture();
	const inventory = await preparation.listSelectedMedia();
	assert.deepEqual(inventory, { sources: [{
		sourceId: 'voice-source', label: 'Interview clip', mediaKind: 'audio',
		operations: [
			'voice-activity-detection', 'speech-recognition', 'speaker-diarization',
			'speech-enhancement', 'source-separation', 'audio-tagging', 'beat-tracking',
		],
	}] });
	assert.deepEqual(rendered, []);
});

test('speech preparation reads only the selected occurrence and emits bounded 16 kHz mono WAV', async () => {
	const { preparation, rendered } = fixture();
	const result = await preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'speech-recognition',
	});
	assert.deepEqual(rendered, [['voice-track', 48_000, 96_000, null, ['voice-clip']]]);
	assert.equal(result.sourceId, 'voice-source');
	assert.equal(result.operation, 'speech-recognition');
	assert.equal(result.inputs.length, 1);
	assert.equal(result.inputs[0]?.role, 'audio');
	assert.equal(result.inputs[0]?.mediaType, 'audio/wav');
	assert.equal(result.inputs[0]?.bytes.type, 'audio/wav');
	const bytes = new Uint8Array(await result.inputs[0]!.bytes.arrayBuffer());
	assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	assert.equal(view.getUint16(22, true), 1);
	assert.equal(view.getUint32(24, true), 16_000);
	assert.equal(view.getUint16(34, true), 32);
	assert.equal(view.getUint16(20, true), 3);
	assert.deepEqual(result.outputs, [{ role: 'transcript',
		mediaType: 'application/vnd.soundscaper.transcript+json', maximumByteLength: 64 * 1024 * 1024 }]);
	assert.deepEqual(result.selectionFence.occurrenceIds, ['camera-clip', 'voice-clip']);
	assert.equal(result.selectionFence.sourceStartFrame, 36_000);
	assert.equal(result.selectionFence.sourceEndFrame, 84_000);
	assert.match(result.selectionFence.linkMembershipSha256, /^[a-f\d]{64}$/u);
	assert.match(result.selectionFence.timingAuthoritySha256, /^[a-f\d]{64}$/u);
});

test('audio preparation conforms each inference family without discarding required channels', async () => {
	const expected = [
		['voice-activity-detection', 16_000, 1],
		['speech-recognition', 16_000, 1],
		['speaker-diarization', 16_000, 1],
		['speech-enhancement', 48_000, 2],
		['source-separation', 44_100, 2],
		['audio-tagging', 32_000, 1],
		['beat-tracking', 22_050, 1],
	] as const;
	for (const [operation, sampleRate, channelCount] of expected) {
		const { preparation } = fixture();
		const result = await preparation.prepareSelectedMedia({
			sourceId: 'voice-source', operation,
		});
		const bytes = new Uint8Array(await result.inputs[0]!.bytes.arrayBuffer());
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		assert.equal(view.getUint16(22, true), channelCount, operation);
		assert.equal(view.getUint32(24, true), sampleRate, operation);
		assert.equal(view.getUint32(40, true), sampleRate * channelCount * 4, operation);
	}
});

test('enhancement and TIGER preparation reserve their closed publication slots', async () => {
	const enhancement = await fixture().preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'speech-enhancement',
	});
	assert.deepEqual(enhancement.outputs, [{
		slotId: 'enhanced-audio', role: 'enhanced-audio', mediaType: 'audio/wav',
		maximumByteLength: 64 * 1024 * 1024,
	}]);
	const separation = await fixture().preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'source-separation',
	});
	assert.deepEqual(separation.outputs, ['dialogue', 'music', 'effects'].map((slotId) => ({
		slotId, role: 'separated-audio', mediaType: 'audio/wav',
		maximumByteLength: 64 * 1024 * 1024,
	})));
});

test('selection fences change with link and timing authority and preparation rechecks currentness', async () => {
	const base = fixture();
	const first = await base.preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'speech-recognition',
	});
	const changedLink = project({ clips: project().clips.map((clip) => (
		clip.id === 'camera-clip' ? { ...clip, avLinkId: 'other-link' } : clip
	)) });
	const linked = fixture(changedLink);
	const second = await linked.preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'speech-recognition',
	});
	assert.notEqual(second.selectionFence.linkMembershipSha256,
		first.selectionFence.linkMembershipSha256);
	const changedTiming = project({ clips: project().clips.map((clip) => (
		clip.id === 'voice-clip' ? { ...clip, gain: 0.75 } : clip
	)) });
	const timed = fixture(changedTiming);
	const third = await timed.preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'speech-recognition',
	});
	assert.notEqual(third.selectionFence.timingAuthoritySha256,
		first.selectionFence.timingAuthoritySha256);

	const stale = fixture();
	stale.preparation = createLocalAssistanceSelectedMediaPreparation({
		getProject: () => project(), getSelectedClipId: () => 'voice-clip',
		captureProject: () => ({ id: 'project-1', revision: 4 }),
		assertProject: () => { throw new DOMException('stale', 'AbortError'); },
		renderDryTrackRange: async () => [new Float32Array(48_000)],
	});
	await assert.rejects(stale.preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'speech-recognition',
	}), { name: 'AbortError' });
});

test('selected-media preparation forwards cancellation into the dry render', async () => {
	const controller = new AbortController();
	let renderStarted: (() => void) | null = null;
	const started = new Promise<void>((resolve) => { renderStarted = resolve; });
	const preparation = createLocalAssistanceSelectedMediaPreparation({
		getProject: () => project(), getSelectedClipId: () => 'voice-clip',
		captureProject: () => ({ id: 'project-1', revision: 4 }), assertProject: () => undefined,
		renderDryTrackRange: async (_trackId, _start, _end, _channels, _clipIds, signal) => {
			assert.equal(signal, controller.signal);
			renderStarted?.();
			return new Promise((_resolve, reject) => signal?.addEventListener(
				'abort', () => reject(signal.reason), { once: true },
			));
		},
	});
	const pending = preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'speech-recognition', signal: controller.signal,
	});
	await started;
	controller.abort(new DOMException('cancelled', 'AbortError'));
	await assert.rejects(pending, { name: 'AbortError' });
});

test('selected-media preparation yields to cancellation while conforming rendered audio', async () => {
	const frameCount = 3 * 65_536;
	const extended = project({
		selection: { startFrame: 24_000, endFrame: 24_000 + frameCount,
			clipIds: ['voice-clip'], trackIds: ['voice-track'] },
		sources: project().sources.map((source) => ({ ...source, frameCount: 24_000 + frameCount })),
		clips: project().clips.map((clip) => clip.id === 'voice-clip'
			? { ...clip, durationFrames: frameCount, sourceDurationFrames: frameCount }
			: clip),
	});
	const controller = new AbortController();
	const preparation = createLocalAssistanceSelectedMediaPreparation({
		getProject: () => extended, getSelectedClipId: () => 'voice-clip',
		captureProject: () => ({ id: 'project-1', revision: 4 }), assertProject: () => undefined,
		renderDryTrackRange: async () => [new Float32Array(frameCount)],
	});
	const pending = preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'speech-recognition', signal: controller.signal,
	});
	setTimeout(() => controller.abort(new DOMException('cancelled', 'AbortError')), 0);
	await assert.rejects(pending, { name: 'AbortError' });
});

test('ambiguous, transformed, unsupported, and oversized selections refuse before rendering', async () => {
	for (const [name, changed, pattern] of [
		['no selected clip', project(), /selected audio occurrence/iu],
		['reverse', project({ clips: project().clips.map((clip) => clip.id === 'voice-clip'
			? { ...clip, reversed: true } : clip) }), /forward identity timing/iu],
		['warp', project({ clips: project().clips.map((clip) => clip.id === 'voice-clip'
			? { ...clip, warpMap: { feature: 'audio-warp', points: [] } } : clip) }), /forward identity timing/iu],
		['outside', project({ selection: { startFrame: 0, endFrame: 12_000,
			clipIds: ['voice-clip'], trackIds: ['voice-track'] } }), /inside the selected occurrence/iu],
		['large', project({ selection: { startFrame: 24_000, endFrame: 24_000 + 48_000 * 601,
			clipIds: ['voice-clip'], trackIds: ['voice-track'] }, clips: project().clips.map((clip) => (
				clip.id === 'voice-clip' ? { ...clip, durationFrames: 48_000 * 700,
					sourceDurationFrames: 48_000 * 700 } : clip)) }), /ten minutes/iu],
	] as const) {
		const selectedClipId = name === 'no selected clip' ? null : 'voice-clip';
		let renderCount = 0;
		const preparation = createLocalAssistanceSelectedMediaPreparation({
			getProject: () => changed, getSelectedClipId: () => selectedClipId,
			captureProject: () => null, assertProject: () => undefined,
			renderDryTrackRange: async () => { renderCount += 1; return [new Float32Array(1)]; },
		});
		await assert.rejects(preparation.prepareSelectedMedia({
			sourceId: 'voice-source', operation: 'speech-recognition',
		}), pattern);
		assert.equal(renderCount, 0, name);
	}
	const { preparation, rendered } = fixture();
	await assert.rejects(preparation.prepareSelectedMedia({
		sourceId: 'voice-source', operation: 'shot-detection',
	}), /selected audio input/iu);
	assert.deepEqual(rendered, []);
});

test('selected-media preparation exposes only an explicitly supplied acceptance owner', async () => {
	const accepted: unknown[] = [];
	const preparation = createLocalAssistanceSelectedMediaPreparation({
		getProject: () => project(), getSelectedClipId: () => 'voice-clip',
		captureProject: () => ({ id: 'project-1', revision: 4 }), assertProject: () => undefined,
		renderDryTrackRange: async () => [new Float32Array(48_000)],
		acceptValidatedResult: (request) => { accepted.push(request); return Promise.resolve(); },
	});
	const request = Object.freeze({ reviewed: true });
	assert.equal(typeof preparation.acceptValidatedResult, 'function');
	await preparation.acceptValidatedResult?.(request);
	assert.deepEqual(accepted, [request]);

	const withoutOwner = fixture().preparation;
	assert.equal(withoutOwner.acceptValidatedResult, undefined);
});
