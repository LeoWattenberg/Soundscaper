/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION = 2;

// New manifest metadata for these previously unavailable commands is not a
// former installed default, even in the legacy table derived from the manifest.
const VERSION_TWO_ADDITIONS = ['play-cut-preview', 'play-stop-select'] as const;

type ShortcutMap = Readonly<Record<string, readonly string[]>>;
type MutableShortcutMap = Record<string, string[]>;

interface ShortcutDefaultMigrationOptions {
	readonly shortcuts: ShortcutMap;
	readonly currentDefaults: ShortcutMap;
	readonly formerDefaults: ShortcutMap;
	readonly shortcutDefaultsVersion: number;
	readonly normalizedKey: (binding: string) => string;
	readonly conflictKey?: (binding: string) => string;
	readonly reservedBindings?: readonly string[];
}

function defineShortcut(
	shortcuts: MutableShortcutMap,
	actionId: string,
	bindings: readonly string[],
): void {
	Object.defineProperty(shortcuts, actionId, {
		value: [...bindings],
		enumerable: true,
		writable: true,
		configurable: true,
	});
}

function equivalentBindings(
	left: readonly string[],
	right: readonly string[],
	normalizedKey: (binding: string) => string,
): boolean {
	if (left.length !== right.length) return false;
	return left.every((binding, index) => (
		normalizedKey(binding) === normalizedKey(right[index])
	));
}

/**
 * Upgrade only bindings that are provably untouched defaults. Missing v0
 * actions are explicit removals, while actions absent from v0 are newly
 * available defaults. Custom bindings own their chords when a new default
 * would otherwise collide with one.
 */
export function migrateAudioEditorShortcutDefaults({
	shortcuts,
	currentDefaults,
	formerDefaults,
	shortcutDefaultsVersion,
	normalizedKey,
	conflictKey = normalizedKey,
	reservedBindings = [],
}: ShortcutDefaultMigrationOptions): MutableShortcutMap {
	const reservedKeys = new Set(reservedBindings.map(conflictKey));
	const availableShortcuts = {} as MutableShortcutMap;
	for (const [actionId, bindings] of Object.entries(shortcuts)) {
		defineShortcut(availableShortcuts, actionId, bindings.filter((binding) => (
			!reservedKeys.has(conflictKey(binding))
		)));
	}
	if (shortcutDefaultsVersion >= 1) {
		const current = {} as MutableShortcutMap;
		for (const [actionId, bindings] of Object.entries(availableShortcuts)) {
			defineShortcut(current, actionId, bindings);
		}
		// The Audacity profile already owns every other missing action at v1:
		// those omissions are user removals. Only these newly available commands
		// receive defaults, and a customized chord still owns its binding.
		if (shortcutDefaultsVersion < AUDIO_EDITOR_SHORTCUT_DEFAULTS_VERSION) {
			const occupied = new Set(Object.values(current).flat().map(conflictKey));
			for (const actionId of VERSION_TWO_ADDITIONS) {
				if (Object.hasOwn(current, actionId)) continue;
				const bindings = currentDefaults[actionId]?.filter((binding) => (
					!occupied.has(conflictKey(binding)) && !reservedKeys.has(conflictKey(binding))
				)) ?? [];
				if (!bindings.length) continue;
				defineShortcut(current, actionId, bindings);
				for (const binding of bindings) occupied.add(conflictKey(binding));
			}
		}
		return current;
	}

	const migrated = {} as MutableShortcutMap;
	const customBindingOwners = new Map<string, string>();
	for (const [actionId, bindings] of Object.entries(availableShortcuts)) {
		const formerDefault = !VERSION_TWO_ADDITIONS.some((id) => id === actionId) && Object.hasOwn(formerDefaults, actionId)
			? formerDefaults[actionId]
			: undefined;
		if (formerDefault && equivalentBindings(bindings, formerDefault, normalizedKey)) continue;
		defineShortcut(migrated, actionId, bindings);
		for (const binding of bindings) {
			const key = conflictKey(binding);
			if (!customBindingOwners.has(key)) customBindingOwners.set(key, actionId);
		}
	}

	const installedBindingOwners = new Map(customBindingOwners);
	for (const [actionId, bindings] of Object.entries(currentDefaults)) {
		const formerDefault = !VERSION_TWO_ADDITIONS.some((id) => id === actionId) && Object.hasOwn(formerDefaults, actionId)
			? formerDefaults[actionId]
			: undefined;
		const savedBindings = availableShortcuts[actionId];
		const wasUntouchedDefault = Boolean(
			formerDefault
			&& savedBindings
			&& equivalentBindings(savedBindings, formerDefault, normalizedKey),
		);
		const isNewDefault = !formerDefault && savedBindings === undefined;
		if (!wasUntouchedDefault && !isNewDefault) continue;

		const availableBindings = bindings.filter((binding) => {
			const owner = installedBindingOwners.get(conflictKey(binding));
			return owner === undefined || owner === actionId;
		});
		if (!availableBindings.length) continue;
		defineShortcut(migrated, actionId, availableBindings);
		for (const binding of availableBindings) {
			installedBindingOwners.set(conflictKey(binding), actionId);
		}
	}

	return migrated;
}
