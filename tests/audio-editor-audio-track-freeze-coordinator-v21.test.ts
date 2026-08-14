/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	createAudioTrackFreezeCoordinatorV21,
	type AudioTrackFreezeCoordinatorCommandV21,
	type AudioTrackFreezeCoordinatorPortsV21,
} from '../src/common/editor/audio-track-freeze-coordinator-v21.ts';
import { createAudioClipV10, createAudioSourceV10, createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { collectHistorySourceIds, editorHistoryProjects } from '../src/common/editor/retention.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	createSoundscaperProjectHistoryV21,
	executeSoundscaperProjectCommandV21,
	undoSoundscaperProjectCommandV21,
} from '../src/soundscaper/editor-project-v21-history.ts';
import { createSoundscaperProjectV21, type SoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21.ts';

const NOW = '2026-08-14T14:00:00.000Z';
const LIVE_BYTES = new Uint8Array([10, 20, 30, 40]);
const LIVE_DIGEST = digest(LIVE_BYTES);

test('freeze renders, hashes, verifies, persists, and CAS-installs only after every currentness check', async () => {
	const fixture = coordinatorFixture();
	const result = await fixture.coordinator.freeze({
		trackId: 'voice', renderStartFrame: 0, renderFrameCount: 1_024,
	});

	assert.equal(result.mode, 'install');
	assert.equal(result.freeze.derivedSourceId, 'voice-freeze-1');
	assert.deepEqual(track(result.project).audioFreeze, result.freeze);
	assert.equal(fixture.published.has('voice-freeze-1'), true);
	assert.deepEqual(fixture.commands.map(({ type }) => type), ['audio-freeze/install']);
	assert.deepEqual(fixture.log.filter((entry) => entry !== 'current'), [
		'capture', 'hash-source:voice-live', 'render', 'hash-render',
		'stage', 'verify', 'publish', 'execute:audio-freeze/install',
	]);
	assert.ok(fixture.log.filter((entry) => entry === 'current').length >= 7);
	assert.doesNotMatch(
		JSON.stringify(result.project),
		/"(?:pcm|base64|channelData|audioBuffer|payload|chunks|bytes|blob|data)":/u,
	);
});

test('a second freeze is refresh, unfreeze retains history-owned bytes, and all commands use exact expected state', async () => {
	const fixture = coordinatorFixture();
	const installed = await fixture.coordinator.freeze({
		trackId: 'voice', renderStartFrame: 0, renderFrameCount: 1_024,
	});
	const refreshed = await fixture.coordinator.freeze({
		trackId: 'voice', renderStartFrame: 0, renderFrameCount: 1_024,
	});

	assert.equal(installed.mode, 'install');
	assert.equal(refreshed.mode, 'refresh');
	assert.equal(refreshed.freeze.derivedSourceId, 'voice-freeze-2');
	assert.equal(refreshed.project.sources.some(({ id }) => id === 'voice-freeze-1'), false);
	assert.equal(fixture.published.has('voice-freeze-1'), true, 'history still owns the old body');
	assert.equal(fixture.published.has('voice-freeze-2'), true);
	const removed = await fixture.coordinator.unfreeze({ trackId: 'voice' });
	assert.equal(Object.hasOwn(track(removed.project), 'audioFreeze'), false);
	assert.equal(removed.project.sources.some(({ id }) => id === 'voice-freeze-2'), false);
	assert.equal(fixture.published.has('voice-freeze-2'), true, 'unfreeze never guesses history reachability');
	assert.deepEqual(fixture.commands.map(({ type }) => type), [
		'audio-freeze/install', 'audio-freeze/install', 'audio-freeze/remove',
	]);
	assert.deepEqual(
		(fixture.commands[1] as Extract<AudioTrackFreezeCoordinatorCommandV21, { type: 'audio-freeze/install' }>).expectedFreeze,
		installed.freeze,
	);
});

test('the real source repository deletes derived PCM only after its last bounded-history owner is evicted', async () => {
	const fixture = coordinatorFixture({ historyLimit: 2 });
	const installed = await fixture.coordinator.freeze({
		trackId: 'voice', renderStartFrame: 0, renderFrameCount: 1_024,
	});
	await fixture.coordinator.unfreeze({ trackId: 'voice' });
	const sourceId = installed.freeze.derivedSourceId;
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `freeze-history-eviction-${Date.now()}-${Math.random()}`,
	});
	try {
		const writer = await store.beginSourceWrite(sourceId, {
			sampleRate: 48_000, channelCount: 2, derivedKind: 'audio-track-freeze-v1',
		});
		await writer.write([Float32Array.of(0.25), Float32Array.of(-0.25)]);
		await writer.commit();
		const pruneNow = Date.now() + 2 * 24 * 60 * 60 * 1_000;

		assert.equal(collectHistorySourceIds(fixture.history()).has(sourceId), true);
		let result = await store.pruneUnreferencedSources({
			protectedProjects: editorHistoryProjects(fixture.history()),
			minimumAgeMs: 0,
			now: pruneNow,
		});
		assert.deepEqual(result.deletedSourceIds, []);
		assert.equal(await store.getSourceMetadata(sourceId) !== null, true);

		fixture.rename('Retire frozen history 1');
		fixture.rename('Retire frozen history 2');
		assert.equal(fixture.history().undoStack.length, 2);
		assert.equal(collectHistorySourceIds(fixture.history()).has(sourceId), false);
		result = await store.pruneUnreferencedSources({
			protectedProjects: editorHistoryProjects(fixture.history()),
			minimumAgeMs: 0,
			now: pruneNow,
		});
		assert.deepEqual(result.deletedSourceIds, [sourceId]);
		assert.equal(await store.getSourceMetadata(sourceId), null);
		await assert.rejects(async () => {
			for await (const _chunk of store.readSourceChunks(sourceId)) { /* consume */ }
		}, /could not be found/iu);
	} finally {
		await store.close();
	}
});

test('commit rehashes live inputs and the derived body before one undoable freeze-boundary bake', async () => {
	const fixture = coordinatorFixture();
	const installed = await fixture.coordinator.freeze({
		trackId: 'voice', renderStartFrame: 0, renderFrameCount: 1_024,
	});
	fixture.log.length = 0;
	const committed = await fixture.coordinator.commit({
		trackId: 'voice',
		derivedClip: committedClip(installed.freeze.derivedSourceId),
	});

	assert.deepEqual(fixture.log.filter((entry) => entry.startsWith('hash-source:')), [
		'hash-source:voice-live', `hash-source:${installed.freeze.derivedSourceId}`,
	]);
	const baked = track(committed.project);
	assert.deepEqual(baked.clipIds, ['voice-committed']);
	assert.deepEqual(baked.effects, []);
	assert.equal(Object.hasOwn(baked, 'audioFreeze'), false);
	assert.deepEqual(committed.project.automationLanes.map(({ id }) => id), ['voice-gain']);
	assert.equal(fixture.commands.at(-1)?.type, 'audio-freeze/commit');
	const undone = undoSoundscaperProjectCommandV21(fixture.history());
	assert.deepEqual(track(undone.present).audioFreeze, installed.freeze);
});

test('freeze cancellation is checked at every awaited coordinator boundary', async () => {
	const boundaries = [
		'capture', 'hash-source:voice-live', 'render', 'hash-render',
		'stage', 'verify', 'publish', 'execute:audio-freeze/install',
	] as const;
	for (const boundary of boundaries) {
		const fixture = coordinatorFixture();
		const cancellation = new AbortController();
		fixture.afterAwait = (actual) => {
			if (actual === boundary) cancellation.abort(new DOMException(`cancelled at ${boundary}`, 'AbortError'));
		};
		await assert.rejects(fixture.coordinator.freeze({
			trackId: 'voice', renderStartFrame: 0, renderFrameCount: 1_024,
			signal: cancellation.signal,
		}), /cancelled|abort/iu, boundary);
		assert.equal(fixture.commands.length, 0, boundary);
		assert.equal(fixture.published.size, 0, boundary);
		assert.equal(
			fixture.log.includes('rollback'),
			['stage', 'verify', 'publish', 'execute:audio-freeze/install'].includes(boundary),
			boundary,
		);
	}
});

test('unfreeze and commit cancellation cover every operation-specific awaited boundary', async () => {
	for (const boundary of ['capture', 'execute:audio-freeze/remove'] as const) {
		const fixture = coordinatorFixture();
		const installed = await fixture.coordinator.freeze({
			trackId: 'voice', renderStartFrame: 0, renderFrameCount: 1_024,
		});
		const cancellation = new AbortController();
		fixture.afterAwait = (actual) => {
			if (actual === boundary) cancellation.abort(new DOMException(`cancelled at ${boundary}`, 'AbortError'));
		};
		await assert.rejects(fixture.coordinator.unfreeze({
			trackId: 'voice', signal: cancellation.signal,
		}), /cancelled|abort/iu, boundary);
		assert.equal(fixture.commands.length, 1, boundary);
		assert.deepEqual(track(fixture.history().present).audioFreeze, installed.freeze, boundary);
		assert.equal(fixture.published.has(installed.freeze.derivedSourceId), true, boundary);
	}

	for (const boundary of [
		'capture', 'hash-source:voice-live', 'hash-source:voice-freeze-1',
		'execute:audio-freeze/commit',
	] as const) {
		const fixture = coordinatorFixture();
		const installed = await fixture.coordinator.freeze({
			trackId: 'voice', renderStartFrame: 0, renderFrameCount: 1_024,
		});
		const cancellation = new AbortController();
		fixture.afterAwait = (actual) => {
			if (actual === boundary) cancellation.abort(new DOMException(`cancelled at ${boundary}`, 'AbortError'));
		};
		await assert.rejects(fixture.coordinator.commit({
			trackId: 'voice', derivedClip: committedClip(installed.freeze.derivedSourceId),
			signal: cancellation.signal,
		}), /cancelled|abort/iu, boundary);
		assert.equal(fixture.commands.length, 1, boundary);
		assert.deepEqual(track(fixture.history().present).audioFreeze, installed.freeze, boundary);
		assert.equal(fixture.published.has(installed.freeze.derivedSourceId), true, boundary);
	}
});

test('late currentness loss and CAS refusal roll verified publication back', async (context) => {

	await context.test('generation loss after publication removes only the operation body', async () => {
		const fixture = coordinatorFixture();
		fixture.afterAwait = (boundary) => {
			if (boundary === 'publish') fixture.loseCurrentness();
		};
		await assert.rejects(fixture.coordinator.freeze({
			trackId: 'voice', renderStartFrame: 0, renderFrameCount: 1_024,
		}), /current|stale|generation/iu);
		assert.equal(fixture.commands.length, 0);
		assert.equal(fixture.published.size, 0);
		assert.deepEqual(fixture.log.slice(-3), ['publish', 'current', 'rollback']);
	});

	await context.test('command CAS refusal rolls a verified publication back', async () => {
		const fixture = coordinatorFixture();
		fixture.refuseCommand = true;
		await assert.rejects(fixture.coordinator.freeze({
			trackId: 'voice', renderStartFrame: 0, renderFrameCount: 1_024,
		}), /CAS refusal/);
		assert.equal(fixture.published.size, 0);
		assert.equal(fixture.log.at(-1), 'rollback');
	});
});

interface Ticket { readonly generation: number }
interface RenderBody { readonly bytes: Uint8Array }
interface Stage {
	readonly sourceId: string;
	readonly digest: string;
	readonly frameCount: number;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly body: RenderBody;
}

function coordinatorFixture(options: Readonly<{ historyLimit?: number }> = {}) {
	let history = createSoundscaperProjectHistoryV21(
		projectFixture(),
		options.historyLimit === undefined ? {} : { limit: options.historyLimit },
	);
	let generation = 0;
	let nextDerived = 0;
	const log: string[] = [];
	const commands: AudioTrackFreezeCoordinatorCommandV21[] = [];
	const published = new Map<string, RenderBody>();
	const fixture = {
		log,
		commands,
		published,
		afterAwait: null as ((boundary: string) => void) | null,
		refuseCommand: false,
		loseCurrentness() { generation += 1; },
		rename(title: string) {
			history = executeSoundscaperProjectCommandV21(history, { type: 'project/rename', title }, { now: NOW });
			generation += 1;
		},
		history: () => history,
		coordinator: null as unknown as ReturnType<typeof createAudioTrackFreezeCoordinatorV21<
			SoundscaperProjectV21, Ticket, RenderBody, Stage
		>>,
	};
	const ports: AudioTrackFreezeCoordinatorPortsV21<SoundscaperProjectV21, Ticket, RenderBody, Stage> = {
		controller: {
			async capture() {
				log.push('capture');
				fixture.afterAwait?.('capture');
				return { project: history.present, ticket: { generation } };
			},
			assertCurrent(ticket) {
				log.push('current');
				if (ticket.generation !== generation) throw new Error('Project generation is no longer current.');
			},
			async executeIfCurrent(ticket, command, { signal }) {
				log.push(`execute:${command.type}`);
				fixture.afterAwait?.(`execute:${command.type}`);
				if (signal?.aborted) throw signal.reason;
				if (fixture.refuseCommand) throw new Error('CAS refusal');
				if (ticket.generation !== generation) throw new Error('Project generation is stale.');
				commands.push(command);
				history = executeSoundscaperProjectCommandV21(history, command, { now: NOW });
				generation += 1;
				return history.present;
			},
		},
		allocateDerivedSourceId({ trackId }) {
			nextDerived += 1;
			return `${trackId}-freeze-${String(nextDerived)}`;
		},
		async hashSourceContent({ source }) {
			const sourceId = String((source as Readonly<Record<string, unknown>>).id);
			log.push(`hash-source:${sourceId}`);
			if (sourceId === 'voice-live') {
				fixture.afterAwait?.(`hash-source:${sourceId}`);
				return LIVE_DIGEST;
			}
			const body = published.get(sourceId);
			if (!body) throw new Error(`Missing persisted source ${sourceId}.`);
			fixture.afterAwait?.(`hash-source:${sourceId}`);
			return digest(body.bytes);
		},
		async render({ renderFrameCount, sampleRate }) {
			log.push('render');
			fixture.afterAwait?.('render');
			return {
				body: { bytes: new Uint8Array([nextDerived, 7, 11, 13]) },
				frameCount: renderFrameCount,
				sampleRate,
				channelCount: 2,
			};
		},
		async hashRenderedBody({ body }) {
			log.push('hash-render');
			fixture.afterAwait?.('hash-render');
			return digest(body.bytes);
		},
		async stageDerivedSource({ sourceId, contentSha256, frameCount, sampleRate, channelCount, body }) {
			log.push('stage');
			fixture.afterAwait?.('stage');
			return { sourceId, digest: contentSha256, frameCount, sampleRate, channelCount, body };
		},
		async verifyStagedSource({ stage }) {
			log.push('verify');
			fixture.afterAwait?.('verify');
			return createAudioSourceV10({
				id: stage.sourceId, storageKey: stage.sourceId,
				contentSha256: stage.digest, frameCount: stage.frameCount,
				channelCount: stage.channelCount, sampleRate: stage.sampleRate,
				originalSampleRate: stage.sampleRate, sampleFormat: 'float32', chunkFrames: 65_536,
			});
		},
		async publishStagedSource({ stage }) {
			log.push('publish');
			published.set(stage.sourceId, stage.body);
			fixture.afterAwait?.('publish');
		},
		async rollbackStagedSource({ stage }) {
			log.push('rollback');
			published.delete(stage.sourceId);
		},
	};
	fixture.coordinator = createAudioTrackFreezeCoordinatorV21(ports);
	return fixture;
}

function projectFixture(): SoundscaperProjectV21 {
	const liveSource = createAudioSourceV10({
		id: 'voice-live', storageKey: 'pcm:voice-live', contentSha256: LIVE_DIGEST,
		frameCount: 512, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClipV10({
		id: 'voice-clip', sourceId: liveSource.id, title: 'Voice', timelineStartFrame: 0,
		durationFrames: 512, sourceStartFrame: 0, sourceDurationFrames: 512,
	});
	const effect = {
		id: 'voice-fx', type: 'limiter', enabled: true,
		params: { ceiling: -1, lookahead: 0.005, release: 0.1 },
	};
	const automationEffect = {
		id: 'voice-filter', type: 'highpass', enabled: true,
		params: { frequency: 1_000, q: 1 },
	};
	const trackValue = createAudioTrackV10({
		id: 'voice', name: 'Voice', gain: 0.75, pan: -0.1, clipIds: [clip.id],
		effects: [effect, automationEffect],
	});
	return createSoundscaperProjectV21({
		id: 'freeze-coordinator-project', title: 'Freeze coordinator', now: NOW,
		sources: [liveSource], clips: [clip], tracks: [trackValue],
		sequences: [{ id: 'main-sequence', trackIds: [trackValue.id] }],
		primarySequenceId: 'main-sequence',
		automationLanes: [{
			id: 'voice-effect-frequency',
			address: {
				kind: 'effect', strip: { kind: 'track', id: trackValue.id },
				effectId: automationEffect.id, parameterId: 'frequency',
			},
			timebase: 'absolute-samples', points: [{ id: 'effect-start', position: 0, value: 1_000 }], segments: [],
		}, {
			id: 'voice-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: trackValue.id }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'gain-start', position: 0, value: 0.75 }], segments: [],
		}],
	});
}

function committedClip(sourceId: string): Readonly<Record<string, unknown>> {
	return createAudioClipV10({
		id: 'voice-committed', sourceId, title: 'Committed voice', anchor: 'sample',
		timelineStartFrame: 0, durationFrames: 1_024, sourceStartFrame: 0,
		sourceDurationFrames: 1_024, trimStartFrames: 0, trimEndFrames: 0,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false, envelope: [],
		pitchCents: 0, speedRatio: 1,
	});
}

function track(project: SoundscaperProjectV21): Readonly<Record<string, unknown>> {
	return project.tracks.find(({ id }) => id === 'voice') as unknown as Readonly<Record<string, unknown>>;
}

function digest(value: Uint8Array): string {
	return bytesToHex(sha256(value));
}
