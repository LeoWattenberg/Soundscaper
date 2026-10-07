/* SPDX-License-Identifier: AGPL-3.0-only */

const ALL_TARGETS = Object.freeze([
	Object.freeze({ runner: 'windows-2025', platform: 'win', arch: 'x64', node_arch: 'x64' }),
	Object.freeze({ runner: 'macos-15', platform: 'mac', arch: 'arm64', node_arch: 'arm64' }),
	Object.freeze({ runner: 'ubuntu-22.04', platform: 'linux', arch: 'x64', node_arch: 'x64' }),
]);

/** @param {unknown} selection */
export function selectTauriPrototypeBuildTargets(selection) {
	let targets;
	if (selection === 'all') targets = ALL_TARGETS;
	else if (selection === 'windows' || selection === 'win-x64') targets = ALL_TARGETS.slice(0, 1);
	else throw new TypeError(`Unknown Tauri prototype target selection: ${String(selection)}`);
	return Object.freeze(targets.map((target) => Object.freeze({ ...target })));
}
