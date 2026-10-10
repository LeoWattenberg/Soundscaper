/* SPDX-License-Identifier: AGPL-3.0-only */

interface ListeningEngine {
	setPlaybackGain(gain: number): unknown;
	setOutputDevice?(deviceId: string): unknown;
	play?(): Promise<void>;
	dispose(): Promise<void> | void;
}

/** Auditions own their audio contexts, while listening volume and speaker choice belong to the editor. */
export function createPlaybackPreviewEngines<Args extends readonly unknown[], Engine extends ListeningEngine>(
	createEngine: (...args: Args) => Engine,
	getPlaybackGain: () => number,
	getOutputDevice: () => string = () => '',
) {
	const active = new Set<Engine>();
	const outputReady = new Map<Engine, Promise<void>>();
	const routeOutput = (engine: Engine, deviceId: string): Promise<void> => {
		const browserDeviceId = deviceId.startsWith('native:') ? '' : deviceId;
		const work = (outputReady.get(engine) ?? Promise.resolve()).catch(() => undefined).then(async () => {
			if (!active.has(engine)) return;
			try { await engine.setOutputDevice?.(browserDeviceId); }
			catch (error) { if (active.has(engine)) throw error; }
		});
		outputReady.set(engine, work);
		void work.catch(() => undefined);
		return work;
	};
	const create = (...args: Args): Engine => {
		const engine = createEngine(...args);
		engine.setPlaybackGain(getPlaybackGain());
		active.add(engine);
		void routeOutput(engine, getOutputDevice());
		const play = engine.play?.bind(engine);
		if (play) engine.play = async () => {
			let ready: Promise<void> | undefined;
			do { ready = outputReady.get(engine); await ready; }
			while (active.has(engine) && ready !== outputReady.get(engine));
			await play();
		};
		const dispose = engine.dispose.bind(engine);
		engine.dispose = () => {
			active.delete(engine);
			outputReady.delete(engine);
			return dispose();
		};
		return engine;
	};
	const setGain = (gain: number): void => {
		for (const engine of active) engine.setPlaybackGain(gain);
	};
	const setOutput = async (deviceId: string): Promise<void> => {
		await Promise.all([...active].map(engine => routeOutput(engine, deviceId)));
	};
	return Object.freeze({ create, setGain, setOutput });
}
