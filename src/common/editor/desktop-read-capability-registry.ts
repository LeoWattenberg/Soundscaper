/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Associates renderer-side media objects with the opaque desktop
 * read-capability id they were materialized from. The renderer never holds
 * a filesystem path: the id is the only address it may hand back to main,
 * and the association dies with the object.
 */

const capabilityIds = new WeakMap<object, string>();

const CAPABILITY_ID = /^[a-f0-9]{64}$/u;

export function registerDesktopReadCapability(media: object, capabilityId: string): void {
	if (!media || typeof media !== 'object' || !CAPABILITY_ID.test(capabilityId)) return;
	capabilityIds.set(media, capabilityId);
}

export function desktopReadCapabilityIdFor(media: unknown): string | null {
	if (!media || typeof media !== 'object') return null;
	return capabilityIds.get(media) ?? null;
}
