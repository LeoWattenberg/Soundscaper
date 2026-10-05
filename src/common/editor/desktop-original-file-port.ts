/* SPDX-License-Identifier: AGPL-3.0-only */

export interface DesktopOriginalFile {
	readonly id: string;
	readonly name: string;
}

const originalFiles = new WeakMap<object, Readonly<DesktopOriginalFile>>();
const releaseCallbacks = new Map<string, (id: string) => PromiseLike<unknown> | unknown>();
const retainedOriginals = new Set<string>();

/** Retain only the main process's opaque capability, never a renderer filesystem path. */
export function registerDesktopOriginalFile(
	media: object, value: unknown, release?: (id: string) => PromiseLike<unknown> | unknown,
): void {
	if (!value || typeof value !== 'object') return;
	const { id, name } = value as Partial<DesktopOriginalFile>;
	if (typeof id !== 'string' || !/^[a-f0-9]{48}$/u.test(id)
		|| typeof name !== 'string' || !name || name.length > 255
		|| name === '.' || name === '..' || name.includes('/') || name.includes('\\')
		|| Array.from(name).some((character) => character.charCodeAt(0) < 32)) return;
	originalFiles.set(media, Object.freeze({ id, name }));
	if (release) releaseCallbacks.set(id, release);
}

export function desktopOriginalFileFor(media: unknown): Readonly<DesktopOriginalFile> | null {
	return media && typeof media === 'object' ? originalFiles.get(media) ?? null : null;
}

/** Retire write authority when an import fails or its project session ends. */
export async function releaseDesktopOriginalFile(original: DesktopOriginalFile): Promise<void> {
	const release = releaseCallbacks.get(original.id);
	releaseCallbacks.delete(original.id);
	retainedOriginals.delete(original.id);
	await release?.(original.id);
}

export function retainDesktopOriginalFile(original: DesktopOriginalFile): void {
	retainedOriginals.add(original.id);
}

/** A dismissed or failed import must release even the descriptors it never materialized. */
export async function withDesktopOriginalReadCleanup<Result>(
	descriptors: readonly unknown[],
	release: ((id: string) => PromiseLike<unknown> | unknown) | undefined,
	consume: () => Promise<Result>,
	releaseUnusedOnSuccess = true,
): Promise<Result> {
	let completed = false;
	try {
		const result = await consume();
		completed = true;
		return result;
	} finally {
		if (!completed || releaseUnusedOnSuccess) {
			await Promise.allSettled(descriptors.map(async (descriptor) => {
				if (!descriptor || typeof descriptor !== 'object') return;
				const original: unknown = Reflect.get(descriptor, 'originalFile');
				if (!original || typeof original !== 'object') return;
				const id: unknown = Reflect.get(original, 'id');
				if (typeof id !== 'string' || !/^[a-f0-9]{48}$/u.test(id) || retainedOriginals.has(id)) return;
				if (releaseCallbacks.has(id)) await releaseDesktopOriginalFile({ id, name: '' });
				else await release?.(id);
			}));
		}
	}
}
