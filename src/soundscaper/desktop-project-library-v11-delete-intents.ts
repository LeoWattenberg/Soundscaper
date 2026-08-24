/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	validateSoundscaperDesktopV11Bundle,
	validateSoundscaperDesktopV11CatalogSnapshot,
	validateSoundscaperDesktopV11ProjectId,
	snapshotSoundscaperDesktopV11Project,
	type SoundscaperDesktopV11RendererBridge,
} from './desktop-project-library-v11-renderer-contract.ts';
import type { SoundscaperDesktopV11CurrentWitness } from './desktop-project-library-v11-renderer-lifecycle.ts';

const PREFIX = 'soundscaper.desktop-v11.delete-intent.v1:';
const FIELDS = [
	'kind', 'version', 'projectId', 'metadataRevision', 'projectRevision', 'projectSha256',
] as const;

export interface SoundscaperDesktopV11DeleteIntentStore {
	putIfAbsent(key: string, value: unknown): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
	listByPrefix(prefix: string): PromiseLike<readonly Readonly<{ key: string; value: unknown }>[]> |
		readonly Readonly<{ key: string; value: unknown }>[];
}

export interface SoundscaperDesktopV11DeleteIntentShadowStore {
	loadProject(projectId: string): PromiseLike<unknown> | unknown;
	readonly projectRepository: Readonly<{
		deleteExact(project: unknown): PromiseLike<boolean> | boolean;
	}>;
	readonly linkedOriginalStoreService: Readonly<{
		deleteProject<Value>(projectId: string, operation: () => PromiseLike<Value> | Value): Promise<Value>;
	}>;
}

export interface SoundscaperDesktopV11DeleteIntent {
	readonly kind: 'soundscaper-desktop-v11-delete-intent';
	readonly version: 1;
	readonly projectId: string;
	readonly metadataRevision: number;
	readonly projectRevision: number;
	readonly projectSha256: string;
}

export async function reconcileSoundscaperDesktopV11DeleteIntents(options: Readonly<{
	profile: EditorProjectRuntimeProfile;
	bridge: SoundscaperDesktopV11RendererBridge;
	shadow: SoundscaperDesktopV11DeleteIntentShadowStore;
	intents: SoundscaperDesktopV11DeleteIntents;
}>): Promise<void> {
	for (const intent of await options.intents.list()) {
		const raw = await options.bridge.readProjectBundle(intent.projectId);
		if (raw !== null) {
			validateSoundscaperDesktopV11Bundle(options.profile, raw, intent.projectId);
			await options.intents.remove(intent);
			continue;
		}
		const catalog = validateSoundscaperDesktopV11CatalogSnapshot(await options.bridge.listProjects());
		if (catalog.projects.some(({ id }) => id === intent.projectId)) {
			throw new Error('A pending desktop V11 delete is catalogued without a readable bundle.');
		}
		if (catalog.metadataRevision < intent.metadataRevision + 1) {
			throw new Error('A pending desktop V11 delete lacks a newer authoritative catalog tombstone.');
		}
		await options.shadow.linkedOriginalStoreService.deleteProject(intent.projectId, async () => {
			const currentValue = await options.shadow.loadProject(intent.projectId);
			if (currentValue === null || currentValue === undefined) return;
			const current = snapshotSoundscaperDesktopV11Project(options.profile, currentValue);
			if (Number(current.project.revision) !== intent.projectRevision
				|| current.sha256 !== intent.projectSha256
				|| !await options.shadow.projectRepository.deleteExact(current.project)) {
				throw new Error('A pending desktop V11 delete shadow changed before exact cleanup.');
			}
		});
		if (await options.shadow.loadProject(intent.projectId) !== null) {
			throw new Error('A pending desktop V11 delete shadow remained after restart cleanup.');
		}
		await options.intents.remove(intent);
	}
}

export class SoundscaperDesktopV11DeleteIntents {
	readonly #store: SoundscaperDesktopV11DeleteIntentStore;

	constructor(store: SoundscaperDesktopV11DeleteIntentStore) { this.#store = store; }

	async create(witness: SoundscaperDesktopV11CurrentWitness): Promise<SoundscaperDesktopV11DeleteIntent> {
		const intent = Object.freeze({
			kind: 'soundscaper-desktop-v11-delete-intent' as const,
			version: 1 as const,
			projectId: validateSoundscaperDesktopV11ProjectId(String(witness.project.id)),
			metadataRevision: witness.expectedMetadataRevision,
			projectRevision: witness.expectedProject.projectRevision,
			projectSha256: witness.expectedProject.projectSha256,
		});
		if (!await this.#store.putIfAbsent(key(intent.projectId), intent)) {
			throw new Error('A desktop V11 delete intent already owns this project.');
		}
		return intent;
	}

	async remove(intent: SoundscaperDesktopV11DeleteIntent): Promise<void> {
		if (!await this.#store.deleteIfCurrent(key(intent.projectId), intent)) {
			throw new Error('The desktop V11 delete intent changed before cleanup.');
		}
	}

	async list(): Promise<readonly SoundscaperDesktopV11DeleteIntent[]> {
		const rows = await this.#store.listByPrefix(PREFIX);
		const projectIds = new Set<string>();
		return Object.freeze(rows.map((row) => {
			const intent = validate(row.value);
			if (row.key !== key(intent.projectId)) throw new Error('A desktop V11 delete intent key drifted.');
			if (projectIds.has(intent.projectId)) throw new Error('Desktop V11 delete intents contain a duplicate project.');
			projectIds.add(intent.projectId);
			return intent;
		}));
	}
}

function key(projectId: string): string { return `${PREFIX}${encodeURIComponent(projectId)}`; }

function validate(value: unknown): SoundscaperDesktopV11DeleteIntent {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| JSON.stringify(Reflect.ownKeys(value).sort()) !== JSON.stringify([...FIELDS].sort())) {
		throw new TypeError('A closed desktop V11 delete intent is required.');
	}
	const raw = value as Record<(typeof FIELDS)[number], unknown>;
	if (raw.kind !== 'soundscaper-desktop-v11-delete-intent' || raw.version !== 1
		|| !Number.isSafeInteger(raw.metadataRevision) || Number(raw.metadataRevision) < 0
		|| !Number.isSafeInteger(raw.projectRevision) || Number(raw.projectRevision) < 0
		|| typeof raw.projectSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.projectSha256)) {
		throw new TypeError('The desktop V11 delete intent is invalid.');
	}
	return Object.freeze({
		...raw,
		projectId: validateSoundscaperDesktopV11ProjectId(raw.projectId),
	}) as SoundscaperDesktopV11DeleteIntent;
}
