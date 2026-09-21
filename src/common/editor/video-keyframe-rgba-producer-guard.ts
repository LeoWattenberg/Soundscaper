/* SPDX-License-Identifier: AGPL-3.0-only */

type Awaitable<Value> = PromiseLike<Value> | Value;

interface VideoKeyframeRgbaProducerRuntimePort {
	produce(
		frame: never,
		target: Uint8Array<ArrayBuffer>,
		options: Readonly<{ signal?: AbortSignal }>,
	): Awaitable<unknown>;
}

export interface VideoKeyframeRgbaProducerGuardMessages {
	readonly returnValue: string;
	readonly allocation: string;
}

const REUSABLE_ALLOCATION_MESSAGES: VideoKeyframeRgbaProducerGuardMessages = Object.freeze({
	returnValue: 'Video keyframe RGBA producers must return void and cannot replace the target.',
	allocation: 'The video keyframe producer did not retain the exact reusable RGBA allocation.',
});

/** Render one frame while enforcing the exact caller-owned RGBA allocation contract. */
export async function produceIntoExactVideoKeyframeRgbaAllocation(
	producer: VideoKeyframeRgbaProducerRuntimePort,
	frame: unknown,
	target: Uint8Array,
	options: Readonly<{ signal?: AbortSignal }>,
	byteLength: number,
	messages: VideoKeyframeRgbaProducerGuardMessages = REUSABLE_ALLOCATION_MESSAGES,
): Promise<void> {
	const expectedBuffer = target.buffer;
	const produced: unknown = await producer.produce(
		frame as never,
		target as Uint8Array<ArrayBuffer>,
		options,
	);
	if (produced !== undefined) throw new TypeError(messages.returnValue);
	if (target.buffer !== expectedBuffer || target.byteOffset !== 0
		|| target.byteLength !== byteLength || expectedBuffer.byteLength !== byteLength) {
		throw new Error(messages.allocation);
	}
}

/** Adapt the editor producer to the smaller WebCodecs producer port without weakening its allocation contract. */
export function createExactVideoKeyframeRgbaProducer(
	producer: VideoKeyframeRgbaProducerRuntimePort,
	byteLength: number,
	messages: VideoKeyframeRgbaProducerGuardMessages = REUSABLE_ALLOCATION_MESSAGES,
) {
	return Object.freeze({
		byteLength,
		async produce(
			frame: unknown,
			target: Uint8Array,
			options: Readonly<{ signal?: AbortSignal }>,
		): Promise<void> {
			await produceIntoExactVideoKeyframeRgbaAllocation(
				producer, frame, target, options, byteLength, messages,
			);
		},
	});
}
