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
	isExcludedTarget(target: unknown): boolean;
}

type AltPressState = 'idle' | 'armed' | 'cancelled';

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
			if (!plainAlt || options.isExcludedTarget(event.target)) {
				altPress = 'cancelled';
				return;
			}
			if (altPress === 'idle') altPress = 'armed';
			event.preventDefault();
			return;
		}

		if (altPress !== 'idle') altPress = 'cancelled';
		const plainF10 = event.key === 'F10'
			&& !event.shiftKey
			&& !event.altKey
			&& !event.ctrlKey
			&& !event.metaKey;
		if (!plainF10 || options.isExcludedTarget(event.target)) return;
		event.preventDefault();
		options.focusFileMenu();
	};

	const onKeyUp = (event: ApplicationMenuAccessKeyEvent): void => {
		if (event.key !== 'Alt') return;
		const activate = altPress === 'armed'
			&& !event.shiftKey
			&& !event.ctrlKey
			&& !event.metaKey
			&& !options.isExcludedTarget(event.target);
		altPress = 'idle';
		if (!activate) return;
		event.preventDefault();
		options.focusFileMenu();
	};

	return { onKeyDown, onKeyUp, cancel };
}
