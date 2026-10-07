/* SPDX-License-Identifier: AGPL-3.0-only */

const ALL_TARGETS = Object.freeze([
	Object.freeze({ runner: 'windows-2025', platform: 'win', arch: 'x64', node_arch: 'x64' }),
	Object.freeze({ runner: 'macos-15', platform: 'mac', arch: 'arm64', node_arch: 'arm64' }),
	Object.freeze({ runner: 'ubuntu-22.04', platform: 'linux', arch: 'x64', node_arch: 'x64' }),
]);

/** @typedef {{ platform: 'win' | 'mac' | 'linux', arch: 'x64' | 'arm64', rustTarget: string }} TauriPrototypeTarget */
/** @type {readonly Readonly<TauriPrototypeTarget>[]} */
const RUST_TARGETS = Object.freeze([
	Object.freeze({ platform: 'win', arch: 'x64', rustTarget: 'x86_64-pc-windows-msvc' }),
	Object.freeze({ platform: 'win', arch: 'arm64', rustTarget: 'aarch64-pc-windows-msvc' }),
	Object.freeze({ platform: 'mac', arch: 'arm64', rustTarget: 'aarch64-apple-darwin' }),
	Object.freeze({ platform: 'linux', arch: 'x64', rustTarget: 'x86_64-unknown-linux-gnu' }),
	Object.freeze({ platform: 'linux', arch: 'arm64', rustTarget: 'aarch64-unknown-linux-gnu' }),
]);

/** @param {unknown} rustTarget @returns {Readonly<TauriPrototypeTarget>} */
export function describeTauriPrototypeTarget(rustTarget) {
	const target = RUST_TARGETS.find((entry) => entry.rustTarget === rustTarget);
	if (!target) throw new TypeError(`Unsupported Tauri prototype Rust target: ${String(rustTarget)}`);
	return target;
}

/** @param {string} platform @param {string} arch */
export function tauriPrototypeRustTarget(platform, arch) {
	const target = RUST_TARGETS.find((entry) => entry.platform === platform && entry.arch === arch);
	if (!target) throw new TypeError(`Unsupported Tauri prototype platform/architecture: ${platform}/${arch}`);
	return target.rustTarget;
}

/** @param {unknown} selection */
export function selectTauriPrototypeBuildTargets(selection) {
	let targets;
	if (selection === 'all') targets = ALL_TARGETS;
	else if (selection === 'windows' || selection === 'win-x64') targets = ALL_TARGETS.slice(0, 1);
	else throw new TypeError(`Unknown Tauri prototype target selection: ${String(selection)}`);
	return Object.freeze(targets.map((target) => Object.freeze({ ...target })));
}
