/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import {
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureSessionManifestV1,
	type FramescaperCaptureStreamManifestV1,
} from '../framescaper-capture-session-manifest.ts';
import {
	FramescaperCaptureSessionCreationRepository,
	framescaperCaptureManifestKey as manifestKey,
	framescaperCaptureManifestProjectPrefix as projectPrefix,
	hasFramescaperCaptureCreationKind,
	normalizeFramescaperCaptureSessionCreation,
	type FramescaperCaptureManifestKeyValuePort,
	type FramescaperCaptureSessionCreationV1,
} from './framescaper-capture-session-creation-repository.ts';

export type {
	FramescaperCaptureCreationStreamV1,
	FramescaperCaptureManifestKeyValuePort,
	FramescaperCaptureSessionCreationV1,
	FramescaperEncodedCaptureCreationStreamV1,
	FramescaperRawPcmCaptureCreationStreamV1,
} from './framescaper-capture-session-creation-repository.ts';

/** Durable, CAS-forward capture sessions stored in the existing analysis domain. */
export class FramescaperCaptureSessionManifestRepository {
	readonly #values: FramescaperCaptureManifestKeyValuePort;
	readonly #creations: FramescaperCaptureSessionCreationRepository;

	constructor(values: FramescaperCaptureManifestKeyValuePort) {
		this.#values = values;
		this.#creations = new FramescaperCaptureSessionCreationRepository(values);
	}

	async load(projectIdValue: string, sessionIdValue: string): Promise<FramescaperCaptureSessionManifestV1 | null> {
		const projectId = stableId(projectIdValue, 'Framescaper capture projectId');
		const sessionId = stableId(sessionIdValue, 'Framescaper capture sessionId');
		const value = await this.#values.get(manifestKey(projectId, sessionId));
		if (value === undefined || value === null) return null;
		if (hasFramescaperCaptureCreationKind(value)) {
			normalizeFramescaperCaptureSessionCreation(value);
			return null;
		}
		const manifest = normalizeFramescaperCaptureSessionManifest(value);
		if (manifest.projectFence.projectId !== projectId || manifest.sessionId !== sessionId) {
			throw new Error('Framescaper capture manifest key ownership changed.');
		}
		return manifest;
	}

	async listProject(projectIdValue: string): Promise<readonly FramescaperCaptureSessionManifestV1[]> {
		const projectId = stableId(projectIdValue, 'Framescaper capture projectId');
		const prefix = projectPrefix(projectId);
		const manifests = (await this.#values.listByPrefix(prefix)).flatMap(({ key, value }) => {
			if (hasFramescaperCaptureCreationKind(value)) {
				normalizeFramescaperCaptureSessionCreation(value);
				return [];
			}
			const manifest = normalizeFramescaperCaptureSessionManifest(value);
			if (manifest.projectFence.projectId !== projectId
				|| key !== manifestKey(projectId, manifest.sessionId)) {
				throw new Error('Framescaper capture inventory contains foreign project ownership.');
			}
			return [manifest];
		});
		return Object.freeze(manifests.sort((left, right) => compareCodeUnits(left.sessionId, right.sessionId)));
	}

	async create(value: unknown): Promise<FramescaperCaptureSessionManifestV1> {
		const manifest = normalizeFramescaperCaptureSessionManifest(value);
		if (!await this.#values.putIfAbsent(
			manifestKey(manifest.projectFence.projectId, manifest.sessionId),
			manifest,
		)) {
			throw new Error(`Framescaper capture session ${manifest.sessionId} already exists.`);
		}
		return manifest;
	}

	async publishCreation(
		expectedValue: unknown,
		value: unknown,
	): Promise<FramescaperCaptureSessionManifestV1> {
		return this.#creations.publishCreation(expectedValue, value);
	}

	async replace(
		expectedValue: unknown,
		nextValue: unknown,
	): Promise<FramescaperCaptureSessionManifestV1> {
		const expected = normalizeFramescaperCaptureSessionManifest(expectedValue);
		const next = normalizeFramescaperCaptureSessionManifest(nextValue);
		assertForwardTransition(expected, next);
		if (!await this.#values.replaceIfCurrent(
			manifestKey(expected.projectFence.projectId, expected.sessionId),
			expected,
			next,
		)) {
			throw new Error('The Framescaper capture session changed before replacement.');
		}
		return next;
	}

	async remove(expectedValue: unknown): Promise<void> {
		const expected = normalizeFramescaperCaptureSessionManifest(expectedValue);
		if (!await this.#values.deleteIfCurrent(
			manifestKey(expected.projectFence.projectId, expected.sessionId),
			expected,
		)) {
			throw new Error('The Framescaper capture session changed before removal.');
		}
	}

	async loadCreation(
		projectIdValue: string,
		sessionIdValue: string,
	): Promise<FramescaperCaptureSessionCreationV1 | null> {
		return this.#creations.loadCreation(projectIdValue, sessionIdValue);
	}

	async listProjectCreations(
		projectIdValue: string,
	): Promise<readonly FramescaperCaptureSessionCreationV1[]> {
		return this.#creations.listProjectCreations(projectIdValue);
	}

	async listCreations(): Promise<readonly FramescaperCaptureSessionCreationV1[]> {
		return this.#creations.listCreations();
	}

	async createCreation(value: unknown): Promise<FramescaperCaptureSessionCreationV1> {
		return this.#creations.createCreation(value);
	}

	async replaceCreation(
		expectedValue: unknown,
		nextValue: unknown,
	): Promise<FramescaperCaptureSessionCreationV1> {
		return this.#creations.replaceCreation(expectedValue, nextValue);
	}

	async removeCreation(expectedValue: unknown): Promise<void> {
		await this.#creations.removeCreation(expectedValue);
	}
}

function assertForwardTransition(
	expected: FramescaperCaptureSessionManifestV1,
	next: FramescaperCaptureSessionManifestV1,
): void {
	if (JSON.stringify(contractProjection(expected)) !== JSON.stringify(contractProjection(next))) {
		throw new Error('A Framescaper capture transition cannot change durable session ownership.');
	}
	if (!stateCanTransition(expected.state, next.state)) {
		throw new Error(`Framescaper capture state cannot move backward from ${expected.state} to ${next.state}.`);
	}
	if (next.updatedAt < expected.updatedAt) {
		throw new Error('Framescaper capture update time cannot move backward.');
	}
	assertPauseSpansForward(expected, next);
	assertRecoveryDecisionForward(expected, next);
	expected.streams.forEach((stream, index) => assertStreamForward(
		stream,
		next.streams[index]!,
		expected.state === 'capturing',
	));
}

function contractProjection(manifest: FramescaperCaptureSessionManifestV1): unknown {
	return {
		version: manifest.version,
		sessionId: manifest.sessionId,
		generation: manifest.generation,
		projectFence: manifest.projectFence,
		origin: manifest.origin,
		monotonicOriginMicroseconds: manifest.clock.monotonicOriginMicroseconds,
		createdAt: manifest.createdAt,
		streams: manifest.streams.map((stream) => ({
			streamId: stream.streamId,
			role: stream.role,
			required: stream.required,
			storage: stream.storage.kind === 'encoded-media'
				? {
					kind: stream.storage.kind,
					spoolId: stream.storage.spoolId,
					spoolToken: stream.storage.spoolToken,
					sourceId: stream.storage.sourceId,
					mimeType: stream.storage.mimeType,
				}
				: {
					kind: stream.storage.kind,
					spoolId: stream.storage.spoolId,
					spoolToken: stream.storage.spoolToken,
					sourceId: stream.storage.sourceId,
					sampleRate: stream.storage.sampleRate,
					channelCount: stream.storage.channelCount,
				},
		})),
	};
}

function stateCanTransition(
	from: FramescaperCaptureSessionManifestV1['state'],
	to: FramescaperCaptureSessionManifestV1['state'],
): boolean {
	if (from === to) return true;
	const transitions: Readonly<Record<typeof from, readonly typeof to[]>> = {
		capturing: ['sealed', 'discarded'],
		sealed: ['finalizing', 'discarded'],
		finalizing: ['published', 'discarded'],
		published: ['committed'],
		committed: [],
		discarded: [],
	};
	return transitions[from].includes(to);
}

function assertPauseSpansForward(
	expected: FramescaperCaptureSessionManifestV1,
	next: FramescaperCaptureSessionManifestV1,
): void {
	const prefix = next.clock.pauseSpans.slice(0, expected.clock.pauseSpans.length);
	if (JSON.stringify(prefix) !== JSON.stringify(expected.clock.pauseSpans)) {
		throw new Error('Framescaper capture pause evidence cannot move backward.');
	}
	if (expected.state !== 'capturing'
		&& next.clock.pauseSpans.length !== expected.clock.pauseSpans.length) {
		throw new Error('A sealed Framescaper capture cannot change its pause evidence.');
	}
}

function assertRecoveryDecisionForward(
	expected: FramescaperCaptureSessionManifestV1,
	next: FramescaperCaptureSessionManifestV1,
): void {
	if (expected.recoveryDecision !== null && next.recoveryDecision !== expected.recoveryDecision) {
		throw new Error('A Framescaper capture recovery decision cannot change.');
	}
}

function assertStreamForward(
	expected: FramescaperCaptureStreamManifestV1,
	next: FramescaperCaptureStreamManifestV1,
	prefixMayAdvance: boolean,
): void {
	if (!playabilityCanTransition(expected.playability, next.playability)) {
		throw new Error('Framescaper capture playability evidence cannot move backward.');
	}
	const timingChanged = JSON.stringify(expected.timing) !== JSON.stringify(next.timing);
	if (!prefixMayAdvance && timingChanged) {
		throw new Error('A sealed Framescaper capture cannot change its presentation timing.');
	}
	if (expected.timing.firstPresentationMicroseconds !== null
		&& next.timing.firstPresentationMicroseconds !== expected.timing.firstPresentationMicroseconds) {
		throw new Error('Framescaper capture first presentation timing cannot change.');
	}
	if (timingChanged && expected.timing.lastPresentationEndMicroseconds !== null
		&& next.timing.lastPresentationEndMicroseconds! <= expected.timing.lastPresentationEndMicroseconds) {
		throw new Error('Framescaper capture presentation timing cannot move backward.');
	}
	const expectedPrefix = storagePrefix(expected);
	const nextPrefix = storagePrefix(next);
	if (!prefixMayAdvance && JSON.stringify(expectedPrefix) !== JSON.stringify(nextPrefix)) {
		throw new Error('A sealed acknowledged prefix cannot change.');
	}
	for (let index = 0; index < expectedPrefix.length; index += 1) {
		if (nextPrefix[index]! < expectedPrefix[index]!) {
			throw new Error('A Framescaper capture acknowledged prefix cannot move backward.');
		}
	}
	const deltas = nextPrefix.map((value, index) => value - expectedPrefix[index]!);
	if (deltas.some((value) => value > 0) && !deltas.every((value) => value > 0)) {
		throw new Error('Framescaper capture acknowledged-prefix geometry changed inconsistently.');
	}
	const storageAdvanced = deltas.some((value) => value > 0);
	if (storageAdvanced !== timingChanged) {
		throw new Error('Framescaper capture presentation timing must advance with its storage prefix.');
	}
}

function storagePrefix(stream: FramescaperCaptureStreamManifestV1): readonly number[] {
	return stream.storage.kind === 'encoded-media'
		? [stream.storage.packetCount, stream.storage.chunkCount, stream.storage.byteLength]
		: [stream.storage.frameCount, stream.storage.chunkCount];
}

function playabilityCanTransition(
	from: FramescaperCaptureStreamManifestV1['playability'],
	to: FramescaperCaptureStreamManifestV1['playability'],
): boolean {
	return from === to || from === 'unknown';
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}
