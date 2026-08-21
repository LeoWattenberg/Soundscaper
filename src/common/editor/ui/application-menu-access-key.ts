/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ApplicationMenuAccessKeyEvent {
	readonly key: string;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
	readonly target: unknown;
	preventDefault(): void;
}

export interface ApplicationMenuAccessKeyController {
	onKeyDown(event: ApplicationMenuAccessKeyEvent): void;
	onKeyUp(event: ApplicationMenuAccessKeyEvent): void;
	cancel(): void;
}

interface ApplicationMenuAccessKeyOptions {
	focusFileMenu(): void;
	openMenuByAccessKey(key: string): boolean;
}

type AltPressState = 'idle' | 'armed' | 'cancelled';

export interface ApplicationMenuAccessKeySource {
	readonly id: string;
	readonly label: string;
}

export interface ResolvedApplicationMenuAccessKey {
	readonly menuId: string;
	readonly key: string;
}

/** Assign unique, locale-facing mnemonics in the same order as the menubar. */
export function resolveApplicationMenuAccessKeys(
	menus: readonly ApplicationMenuAccessKeySource[],
): readonly ResolvedApplicationMenuAccessKey[] {
	const used = new Set<string>();
	return Object.freeze(menus.flatMap((menu) => {
		const key = firstUnusedAccessKey([menu.label, menu.id], used);
		if (!key) return [];
		used.add(key);
		return [Object.freeze({ menuId: menu.id, key })];
	}));
}

function firstUnusedAccessKey(values: readonly string[], used: ReadonlySet<string>): string | null {
	for (const value of values) {
		const normalized = value.normalize('NFKD').replace(/\p{Mark}/gu, '');
		for (const character of normalized) {
			const key = normalizeAccessKey(character);
			if (key && !used.has(key)) return key;
		}
	}
	return null;
}

function normalizeAccessKey(value: string): string | null {
	const normalized = value.normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase();
	const [character] = normalized;
	return character && /[\p{Letter}\p{Number}]/u.test(character) ? character : null;
}

/** Coordinate the platform menubar access keys without consuming editor shortcuts. */
export function createApplicationMenuAccessKeyController(
	options: ApplicationMenuAccessKeyOptions,
): ApplicationMenuAccessKeyController {
	let altPress: AltPressState = 'idle';

	const cancel = (): void => {
		altPress = 'idle';
	};

	const onKeyDown = (event: ApplicationMenuAccessKeyEvent): void => {
		if (event.key === 'Alt') {
			if (altPress === 'cancelled') return;
			const plainAlt = !event.shiftKey && !event.ctrlKey && !event.metaKey;
			if (!plainAlt) {
				altPress = 'cancelled';
				return;
			}
			if (altPress === 'idle') altPress = 'armed';
			event.preventDefault();
			return;
		}

		const plainAltAccessKey = event.altKey
			&& !event.shiftKey
			&& !event.ctrlKey
			&& !event.metaKey
			&& Array.from(event.key).length === 1;
		if (plainAltAccessKey) {
			altPress = 'cancelled';
			const key = normalizeAccessKey(event.key);
			if (key && options.openMenuByAccessKey(key)) event.preventDefault();
			return;
		}

		if (altPress !== 'idle') altPress = 'cancelled';
		const plainF10 = event.key === 'F10'
			&& !event.shiftKey
			&& !event.altKey
			&& !event.ctrlKey
			&& !event.metaKey;
		if (!plainF10) return;
		event.preventDefault();
		options.focusFileMenu();
	};

	const onKeyUp = (event: ApplicationMenuAccessKeyEvent): void => {
		if (event.key !== 'Alt') return;
		const activate = altPress === 'armed'
			&& !event.shiftKey
			&& !event.ctrlKey
			&& !event.metaKey;
		altPress = 'idle';
		if (!activate) return;
		event.preventDefault();
		options.focusFileMenu();
	};

	return { onKeyDown, onKeyUp, cancel };
}
