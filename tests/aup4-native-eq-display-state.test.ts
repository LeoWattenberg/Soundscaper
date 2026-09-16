/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute, audacityXmlChildren as readXmlChildren, createAudacityXmlNode,
} from '../src/common/editor/audacity-binary-xml.js';
import { createAup4EffectsNode, readAup4EffectsNode } from '../src/common/editor/aup4-effects.js';

type XmlNode = ReturnType<typeof createAudacityXmlNode>;
const xmlChildren = readXmlChildren as unknown as (node: unknown, name: string) => XmlNode[];

// EqualizationParameters::IsLinear requires both draw mode and the linear flag.
// Graphic mode ignores a retained InterpolateLin value of 1. This static state
// is supported by the interchange profile; pinned Audacity EQ is selection-only.
for (const flag of ['0', '1']) {
	test(`Graphic EQ accepts and preserves its inactive linear-display flag ${flag}`, () => {
		const nativeId = 'Effect_Audacity_Audacity_Graphic EQ_Built-in Effect: Graphic EQ';
		const parameters = [['FilterLength', '8191'], ['InterpolateLin', flag], ['InterpolationMethod', 'B-spline']];
		const native = createAudacityXmlNode('effect', [
			{ kind: 'attribute', name: 'id', type: 'string', value: nativeId },
		], [{ kind: 'node', node: createAudacityXmlNode('parameters', [], parameters.map(([name, value]) => ({
			kind: 'node', node: createAudacityXmlNode('parameter', [
				{ kind: 'attribute', name: 'name', type: 'string', value: name },
				{ kind: 'attribute', name: 'value', type: 'string', value },
			]),
		}))) }]);
		const rack = createAudacityXmlNode('effects', [], [{ kind: 'node', node: native }]);
		const [effect] = readAup4EffectsNode(rack, { idFactory: () => 'graphic-eq' });
		assert.ok(effect);
		assert.equal(effect.type, 'audacity-graphic-eq');
		assert.equal(effect.params.linearFrequencyScale, undefined);
		assert.equal(effect.params.filterLength, 8191);

		const rewritten = createAup4EffectsNode([{
			...effect, params: { ...effect.params, filterLength: 4095 },
		}]);
		const [exported] = xmlChildren(rewritten, 'effect');
		assert.equal(audacityXmlAttribute(exported, 'id'), nativeId);
		const [container] = xmlChildren(exported, 'parameters');
		const values = new Map(xmlChildren(container, 'parameter').map(parameter => [
			audacityXmlAttribute(parameter, 'name'), audacityXmlAttribute(parameter, 'value'),
		]));
		assert.equal(values.get('InterpolateLin'), flag);
		assert.equal(values.get('FilterLength'), '4095');
		const [reopened] = readAup4EffectsNode(rewritten, { idFactory: () => 'graphic-eq-reopened' });
		assert.equal(reopened.type, 'audacity-graphic-eq');
		assert.equal(reopened.params.filterLength, 4095);
	});
}
