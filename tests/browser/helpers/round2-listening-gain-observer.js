/* SPDX-License-Identifier: AGPL-3.0-only */

export async function observeListeningGains(page) {
	await page.addInitScript(() => {
		const outputs = new WeakMap();
		const scheduledValues = new WeakMap();
		const setValueAtTime = AudioParam.prototype.setValueAtTime;
		AudioParam.prototype.setValueAtTime = function (value, time) {
			const result = Reflect.apply(setValueAtTime, this, [value, time]);
			scheduledValues.set(this, { value, time });
			return result;
		};
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (...args) {
			const result = Reflect.apply(connect, this, args);
			if (args[0] instanceof AudioNode) {
				const list = outputs.get(this) ?? [];
				list.push(args[0]);
				outputs.set(this, list);
			}
			return result;
		};
		const start = AudioBufferSourceNode.prototype.start;
		window.__round2PreviewListeningGains = [];
		AudioBufferSourceNode.prototype.start = function (...args) {
			const gains = [];
			const visited = new Set();
			const visit = (node, gain) => {
				if (visited.has(node)) return;
				visited.add(node);
				const scheduled = node instanceof GainNode ? scheduledValues.get(node.gain) : null;
				const level = node instanceof GainNode ? scheduled && scheduled.time <= node.context.currentTime
					? scheduled.value : node.gain.value : 1;
				const nextGain = gain * level;
				if (node instanceof AudioDestinationNode) gains.push(nextGain);
				else for (const output of outputs.get(node) ?? []) visit(output, nextGain);
			};
			visit(this, 1);
			window.__round2PreviewListeningGains.push(gains);
			return Reflect.apply(start, this, args);
		};
	});
}
