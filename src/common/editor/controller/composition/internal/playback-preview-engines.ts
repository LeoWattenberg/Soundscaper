/* SPDX-License-Identifier: AGPL-3.0-only */

interface ListeningEngine {
	setPlaybackGain(gain: number): unknown;
	dispose(): Promise<void> | void;
}

/** Auditions own their audio contexts, while listening volume belongs to the editor. */
export function createPlaybackPreviewEngines<Args extends readonly unknown[], Engine extends ListeningEngine>(
	createEngine: (...args: Args) => Engine,
	getPlaybackGain: () => number,
) {
	const active = new Set<Engine>();
	const create = (...args: Args): Engine => {
		const engine = createEngine(...args);
		engine.setPlaybackGain(getPlaybackGain());
		const dispose = engine.dispose.bind(engine);
		engine.dispose = () => {
			active.delete(engine);
			return dispose();
		};
		active.add(engine);
		return engine;
	};
	const setGain = (gain: number): void => {
		for (const engine of active) engine.setPlaybackGain(gain);
	};
	return Object.freeze({ create, setGain });
}
