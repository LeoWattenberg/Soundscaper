/* SPDX-License-Identifier: AGPL-3.0-only */

export function createMockAudioWorkletNodeClass(NodeBase) {
	return class MockAudioWorkletNode extends NodeBase {
		constructor(context, name, options = {}) {
			super('audio-worklet');
			this.context = context;
			this.name = name;
			this.options = options;
			this.messages = [];
			this.readinessProbe = name === 'kw-audacity-live-effect'
				&& !context.workletNodes.some((node) => node.name === name);
			this.port = {
				onmessage: null,
				postMessage: (message) => this.messages.push(message),
				start() {},
			};
			if (name === 'kw-audacity-live-effect') queueMicrotask(() => this.port.onmessage?.({
				data: { type: 'status', status: 'ready' },
			}));
			context.workletNodes.push(this);
			context.nodeKinds.push(`audio-worklet:${name}`);
		}
	};
}
