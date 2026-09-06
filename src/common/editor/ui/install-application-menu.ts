/* SPDX-License-Identifier: AGPL-3.0-only */

export const INSTALL_APPLICATION_MENU_ITEM_ID = 'install-application';

export interface InstallApplicationMenuInput {
	readonly productId: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly available: () => boolean;
	readonly install: () => unknown;
}

/**
 * Offers the browser's held install prompt from Help.
 *
 * The label names the product because that is what a person is installing, so
 * it reads from the same pair of catalog entries the About command uses rather
 * than hard-coding either editor's name.
 *
 * A browser decides the app is installable whenever it likes — usually well
 * after these menus were first built, and never at all where installation is
 * unsupported or already done. Availability therefore resolves at menu-open
 * time instead of being frozen into the item, and the entry stays visible and
 * merely unavailable, because a row that disappears is harder to find again
 * than one that is plainly greyed out.
 */
export function createInstallApplicationMenuItem(input: InstallApplicationMenuInput) {
	const resolve = () => (input.available()
		? { disabled: false }
		: { disabled: true, disabledReason: input.copy.installUnavailable });
	return Object.freeze({
		id: INSTALL_APPLICATION_MENU_ITEM_ID,
		label: input.productId === 'framescaper'
			? input.copy.installFramescaper
			: input.copy.installEditor,
		// The built item also carries the state it had when it was built, because
		// command search reads menu items without opening them and would otherwise
		// offer an entry the menu itself shows as unavailable.
		...resolve(),
		resolve,
		onClick: input.install,
	});
}
