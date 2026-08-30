import type { Readable, Writable } from 'node:stream';

export function pipeDesktopNightlyTestsStaticResponse(
	stream: Readable,
	response: Writable,
): void;
