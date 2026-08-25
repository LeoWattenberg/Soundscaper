/* SPDX-License-Identifier: AGPL-3.0-only */

/** Narrow renderer bridge for main-owned external FFmpeg preferences. */

export interface ExternalFfmpegPreferenceIpcChannels {
	readonly externalFfmpegStatus: string;
	readonly externalFfmpegChoose: string;
	readonly externalFfmpegClear: string;
	readonly externalFfmpegRescan: string;
	readonly externalFfmpegInstall: string;
}

export interface ExternalFfmpegPreferenceIpcService {
	status(): Promise<unknown>;
	choose(): Promise<unknown>;
	clear(): Promise<unknown>;
	rescan(): Promise<unknown>;
	install(): Promise<unknown>;
}

export interface ExternalFfmpegPreferenceMainIpcOptions {
	readonly channels: ExternalFfmpegPreferenceIpcChannels;
	readonly handle: (
		channel: string,
		listener: (event: unknown, ...arguments_: unknown[]) => unknown,
	) => void;
	readonly removeHandler: (channel: string) => void;
	readonly service: ExternalFfmpegPreferenceIpcService;
}

export interface ExternalFfmpegPreferenceMainIpcRegistration {
	dispose(): void;
}

const CHANNEL_FIELDS = Object.freeze([
	'externalFfmpegStatus', 'externalFfmpegChoose', 'externalFfmpegClear',
	'externalFfmpegRescan', 'externalFfmpegInstall',
] as const);

export function registerExternalFfmpegPreferenceMainIpc(
	options: ExternalFfmpegPreferenceMainIpcOptions,
): ExternalFfmpegPreferenceMainIpcRegistration {
	validateOptions(options);
	const bindings = Object.freeze([
		[options.channels.externalFfmpegStatus, () => options.service.status()],
		[options.channels.externalFfmpegChoose, () => options.service.choose()],
		[options.channels.externalFfmpegClear, () => options.service.clear()],
		[options.channels.externalFfmpegRescan, () => options.service.rescan()],
		[options.channels.externalFfmpegInstall, () => options.service.install()],
	] as const);
	const registered: string[] = [];
	try {
		for (const [channel, action] of bindings) {
			options.handle(channel, (_event, ...arguments_) => {
				if (arguments_.length !== 0) {
					throw new TypeError('External FFmpeg preference IPC does not accept renderer arguments.');
				}
				return action();
			});
			registered.push(channel);
		}
	} catch (error) {
		for (const channel of registered) options.removeHandler(channel);
		throw error;
	}
	let disposed = false;
	return Object.freeze({
		dispose(): void {
			if (disposed) return;
			disposed = true;
			for (const channel of registered) options.removeHandler(channel);
		},
	});
}

function validateOptions(options: ExternalFfmpegPreferenceMainIpcOptions): void {
	if (!options || typeof options !== 'object' || typeof options.handle !== 'function'
		|| typeof options.removeHandler !== 'function' || !options.service
		|| CHANNEL_FIELDS.some((field) => typeof options.service[actionFor(field)] !== 'function')) {
		throw new TypeError('External FFmpeg preference IPC ports are invalid.');
	}
	if (!options.channels || typeof options.channels !== 'object') {
		throw new TypeError('External FFmpeg preference IPC channels are invalid.');
	}
	const values = CHANNEL_FIELDS.map((field) => options.channels[field]);
	if (values.some((channel) => typeof channel !== 'string' || channel.length < 1
		|| channel.length > 128 || !/^[a-z0-9:-]+$/u.test(channel))) {
		throw new TypeError('External FFmpeg preference IPC channels are invalid.');
	}
	if (new Set(values).size !== values.length) {
		throw new TypeError('External FFmpeg preference IPC channels must be unique.');
	}
}

function actionFor(
	field: typeof CHANNEL_FIELDS[number],
): keyof ExternalFfmpegPreferenceIpcService {
	if (field === 'externalFfmpegStatus') return 'status';
	if (field === 'externalFfmpegChoose') return 'choose';
	if (field === 'externalFfmpegClear') return 'clear';
	if (field === 'externalFfmpegRescan') return 'rescan';
	return 'install';
}
