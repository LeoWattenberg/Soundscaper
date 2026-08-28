/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	parseCubeLutV1,
	VIDEO_COLOR_LIMITS_V1,
	type VideoColorGradeV1,
	type VideoCubeLutReferenceV1,
} from '../common/editor/video-color-management-v27.ts';
import {
	normalizeVideoFinishingPresetV1,
	normalizeVideoVisualPresentationV1,
	type VideoFinishingPresetV1,
	type VideoVisualPresentationV1,
} from '../common/editor/video-visual-presentation-v27.ts';
import { snapshotFramescaperOwnedFinishingCommandFinishing } from './editor-project-finishing-finishing-command.ts';
import { assertFramescaperProjectIdentity } from './editor-project-identity.ts';

export type FramescaperCubeLutTarget = FramescaperCubeLutTargetFinishing;
export const framescaperCubeLutActionsFor = framescaperCubeLutActionsFinishingFor;

export type FramescaperCubeLutTargetKindFinishing = 'presentation' | 'preset';

export interface FramescaperCubeLutTargetFinishing {
	readonly kind: FramescaperCubeLutTargetKindFinishing;
	readonly id: string;
	readonly label: string;
}

export interface FramescaperCubeLutActionsFinishing {
	targets(): readonly FramescaperCubeLutTargetFinishing[];
	importCubeLut(request: Readonly<{
		readonly target: Readonly<{ readonly kind: FramescaperCubeLutTargetKindFinishing; readonly id: string }>;
		readonly file: Blob;
		readonly signal?: AbortSignal;
	}>): Promise<VideoCubeLutReferenceV1>;
}

interface CubeLutOwnerFinishing {
	readonly project: unknown;
	readonly actions: Readonly<{
		readonly edit: Readonly<{ commit(command: unknown): PromiseLike<unknown> | unknown }>;
	}>;
}

interface CubeLutStoreFinishing {
	getMediaAssetMetadata(key: string): PromiseLike<Readonly<Record<string, unknown>> | null>;
	writeMediaAsset(
		key: string,
		body: Blob,
		metadata: Readonly<Record<string, unknown>>,
		options?: Readonly<{ readonly signal?: AbortSignal }>,
	): PromiseLike<unknown>;
	deleteMediaAsset(key: string): PromiseLike<unknown>;
}

type TargetSnapshot = Readonly<
	| { readonly kind: 'presentation'; readonly value: VideoVisualPresentationV1 }
	| { readonly kind: 'preset'; readonly value: VideoFinishingPresetV1 }
>;

const RUNTIMES = new WeakMap<object, FramescaperCubeLutActionsFinishing>();
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export function createFramescaperCubeLutActionsFinishing(options: Readonly<{
	readonly owner: CubeLutOwnerFinishing;
	readonly store: CubeLutStoreFinishing;
}>): FramescaperCubeLutActionsFinishing {
	assertOptions(options);
	let active = false;
	return Object.freeze({
		targets: () => targets(options.owner.project),
		importCubeLut: async (request: Parameters<FramescaperCubeLutActionsFinishing['importCubeLut']>[0]) => {
			if (active) throw new Error('A selected finishing cube LUT import is already running.');
			active = true;
			try { return await importCubeLut(options, request); }
			finally { active = false; }
		},
	});
}

export function bindFramescaperCubeLutActionsFinishing(
	owner: object,
	runtime: FramescaperCubeLutActionsFinishing,
): void {
	if (!owner || typeof owner !== 'object') throw new TypeError('A finishing cube LUT owner is required.');
	RUNTIMES.set(owner, runtime);
}

export function framescaperCubeLutActionsFinishingFor(owner: unknown): FramescaperCubeLutActionsFinishing | null {
	return owner && (typeof owner === 'object' || typeof owner === 'function')
		? RUNTIMES.get(owner as object) ?? null : null;
}

async function importCubeLut(
	options: Readonly<{ readonly owner: CubeLutOwnerFinishing; readonly store: CubeLutStoreFinishing }>,
	request: Parameters<FramescaperCubeLutActionsFinishing['importCubeLut']>[0],
): Promise<VideoCubeLutReferenceV1> {
	throwIfAborted(request.signal);
	const fileName = cubeFileName(request.file);
	const bytes = await cubeBytes(request.file);
	throwIfAborted(request.signal);
	let text: string;
	try { text = UTF8.decode(bytes); }
	catch (error) { throw new TypeError('The cube LUT must be strict UTF-8.', { cause: error }); }
	const parsed = parseCubeLutV1(text);
	if (parsed.byteLength !== bytes.byteLength) {
		throw new TypeError('The cube LUT must have an exact UTF-8 byte representation without a byte-order mark.');
	}
	const reference = Object.freeze({
		storageKey: `lut-sha256:${parsed.sha256}`,
		sha256: parsed.sha256,
		byteLength: parsed.byteLength,
		size: parsed.size,
		domainMin: parsed.domainMin,
		domainMax: parsed.domainMax,
	});
	const expected = targetSnapshot(options.owner.project, request.target);
	const replacement = attachReference(expected, reference);
	const metadata = await options.store.getMediaAssetMetadata(reference.storageKey);
	throwIfAborted(request.signal);
	let created = false;
	if (metadata === null) {
		await options.store.writeMediaAsset(
			reference.storageKey,
			new Blob([bytes], { type: 'text/plain' }),
			{ name: fileName, mimeType: 'text/plain', sha256: reference.sha256 },
			request.signal ? { signal: request.signal } : {},
		);
		created = true;
	} else assertExistingBody(metadata, reference);
	try {
		throwIfAborted(request.signal);
		assertCurrent(options.owner.project, expected);
		if (same(expected.value, replacement.value)) return reference;
		await options.owner.actions.edit.commit(command(expected, replacement));
		assertReplacement(options.owner.project, replacement);
		return reference;
	} catch (error) {
		if (created) await rollbackBody(options.store, reference.storageKey, error);
		throw error;
	}
}

function command(expected: TargetSnapshot, replacement: TargetSnapshot): unknown {
	if (expected.kind === 'presentation' && replacement.kind === 'presentation') {
		return snapshotFramescaperOwnedFinishingCommandFinishing({
			type: 'video-visual-presentation/set', presentationId: expected.value.id,
			expectedPresentation: expected.value, presentation: replacement.value,
		});
	}
	if (expected.kind === 'preset' && replacement.kind === 'preset') {
		return snapshotFramescaperOwnedFinishingCommandFinishing({
			type: 'video-finishing-preset/set', finishingPresetId: expected.value.id,
			expectedFinishingPreset: expected.value, finishingPreset: replacement.value,
		});
	}
	throw new TypeError('The cube LUT target kind changed before command publication.');
}

function attachReference(
	target: TargetSnapshot,
	reference: VideoCubeLutReferenceV1,
): TargetSnapshot {
	if (target.kind === 'presentation') return Object.freeze({
		kind: 'presentation' as const,
		value: normalizeVideoVisualPresentationV1({
			...target.value, grade: { ...(target.value.grade ?? defaultGrade()), lut: reference },
		}),
	});
	return Object.freeze({
		kind: 'preset' as const,
		value: normalizeVideoFinishingPresetV1({
			...target.value,
			template: {
				...target.value.template,
				grade: { ...(target.value.template.grade ?? defaultGrade()), lut: reference },
			},
		}),
	});
}

function targetSnapshot(
	projectValue: unknown,
	target: Readonly<{ readonly kind: FramescaperCubeLutTargetKindFinishing; readonly id: string }>,
): TargetSnapshot {
	const project = projectRecord(projectValue);
	const id = stableId(target?.id, 'cube LUT target ID');
	if (target?.kind === 'presentation') {
		const value = records(project.videoVisualPresentations, 'finishing visual presentations')
			.find((item) => item.id === id);
		if (!value) throw new ReferenceError(`finishing visual presentation ${id} is unavailable.`);
		return Object.freeze({ kind: 'presentation', value: normalizeVideoVisualPresentationV1(value) });
	}
	if (target?.kind === 'preset') {
		const value = records(project.videoFinishingPresets, 'finishing finishing presets')
			.find((item) => item.id === id);
		if (!value) throw new ReferenceError(`finishing finishing preset ${id} is unavailable.`);
		return Object.freeze({ kind: 'preset', value: normalizeVideoFinishingPresetV1(value) });
	}
	throw new RangeError('The finishing cube LUT target kind is unsupported.');
}

function targets(projectValue: unknown): readonly FramescaperCubeLutTargetFinishing[] {
	const project = projectRecord(projectValue);
	return Object.freeze([
		...records(project.videoVisualPresentations, 'finishing visual presentations').map((value) => {
			const presentation = normalizeVideoVisualPresentationV1(value);
			return Object.freeze({ kind: 'presentation' as const, id: presentation.id,
				label: `Presentation ${presentation.id}` });
		}),
		...records(project.videoFinishingPresets, 'finishing finishing presets').map((value) => {
			const preset = normalizeVideoFinishingPresetV1(value);
			return Object.freeze({ kind: 'preset' as const, id: preset.id, label: `Preset ${preset.name}` });
		}),
	]);
}

function assertCurrent(project: unknown, expected: TargetSnapshot): void {
	const current = targetSnapshot(project, { kind: expected.kind, id: expected.value.id });
	if (!same(current.value, expected.value)) {
		throw new Error('The selected finishing cube LUT target changed before publication.');
	}
}

function assertReplacement(project: unknown, replacement: TargetSnapshot): void {
	const current = targetSnapshot(project, { kind: replacement.kind, id: replacement.value.id });
	if (!same(current.value, replacement.value)) {
		throw new Error('The selected finishing cube LUT history command did not publish its exact target.');
	}
}

function assertExistingBody(
	metadata: Readonly<Record<string, unknown>>,
	reference: VideoCubeLutReferenceV1,
): void {
	if ((metadata.size ?? metadata.byteLength) !== reference.byteLength
		|| metadata.sha256 !== reference.sha256) {
		throw new Error('The existing digest-addressed cube LUT body is corrupt or conflicting.');
	}
}

async function rollbackBody(store: CubeLutStoreFinishing, key: string, error: unknown): Promise<void> {
	try {
		const deleted = await store.deleteMediaAsset(key);
		if (deleted === false) throw new Error('The new cube LUT body was not removed.');
	} catch (cleanupError) {
		throw new AggregateError(
			[error, cleanupError], 'Cube LUT publication and body rollback both failed.', { cause: error },
		);
	}
}

async function cubeBytes(value: Blob): Promise<Uint8Array<ArrayBuffer>> {
	if (!(value instanceof Blob)) throw new TypeError('The selected cube LUT is not a pathless file body.');
	if (!Number.isSafeInteger(value.size) || value.size < 1
		|| value.size > VIDEO_COLOR_LIMITS_V1.maximumCubeLutBytes) {
		throw new RangeError('The cube LUT exceeds its 16 MiB byte limit.');
	}
	return new Uint8Array(await value.arrayBuffer());
}

function cubeFileName(value: Blob): string {
	const name = (value as Blob & Readonly<{ name?: unknown }>).name;
	if (typeof name !== 'string' || name.length < 6 || name.length > 512
		|| !name.toLowerCase().endsWith('.cube') || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) {
		throw new TypeError('The selected LUT requires a safe .cube file name.');
	}
	return name;
}

function defaultGrade(): VideoColorGradeV1 {
	return Object.freeze({
		schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: Object.freeze([0, 0, 0] as const), gamma: Object.freeze([1, 1, 1] as const),
		gain: Object.freeze([1, 1, 1] as const), saturation: 1, lut: null,
	});
}

function projectRecord(value: unknown): Readonly<Record<string, unknown>> {
	assertFramescaperProjectIdentity(value);
	const project = record(value, 'Selected finishing cube LUT project');
	return project;
}

function records(value: unknown, name: string): Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item) => record(item, name));
}

function record(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Readonly<Record<string, unknown>>;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} is invalid.`);
	}
	return value;
}

function same(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function assertOptions(options: Readonly<{ readonly owner: CubeLutOwnerFinishing; readonly store: CubeLutStoreFinishing }>): void {
	if (!options.owner || typeof options.owner !== 'object'
		|| typeof options.owner.actions?.edit?.commit !== 'function') {
		throw new TypeError('Selected finishing cube LUT import requires a controller owner.');
	}
	if (!options.store || typeof options.store.getMediaAssetMetadata !== 'function'
		|| typeof options.store.writeMediaAsset !== 'function'
		|| typeof options.store.deleteMediaAsset !== 'function') {
		throw new TypeError('Selected finishing cube LUT import requires an exact asset store.');
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason ?? new DOMException('Cube LUT import was cancelled.', 'AbortError');
}
