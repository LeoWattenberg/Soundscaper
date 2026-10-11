/* SPDX-License-Identifier: AGPL-3.0-only */
import { useState } from 'react';
import { Button } from '@soundscaper/design-system/Button';
import type { MotionLayer, MotionAudioPlacement } from '../../motion-composition.ts';
import type { MotionExpression } from '../../motion-property.ts';
import { motionExpressionReference } from '../../motion-expression-links.ts';
import { motionLayerProperties } from '../../motion-project-graph.ts';
import { motionPropertyLabel } from './motion-property-ui.ts';
export interface MotionExpressionOwner { readonly owner: MotionLayer | MotionAudioPlacement; readonly label: string }
export default function MotionExpressionReferences({ copy, owners, references, disabled, onChange, onError }: Readonly<{
	copy: Readonly<Record<string, string>>; owners: readonly MotionExpressionOwner[]; references: MotionExpression['references']; disabled: boolean;
	onChange: (references: MotionExpression['references']) => void; onError: (error: unknown) => void;
}>) {
	const [ownerId, setOwnerId] = useState(''); const [path, setPath] = useState(''); const [alias, setAlias] = useState('driver');
	const entry = owners.find(({ owner }) => owner.id === ownerId) ?? owners[0]; const properties = entry ? motionLayerProperties(entry.owner) : [];
	const property = properties.find((value) => value.stablePath === path) ?? properties[0];
	const add = () => { try {
		if (!entry || !property) return; if (references.some(({ id }) => id === alias)) throw new Error(copy.motionscaperExpressionAliasDuplicate);
		onChange([...references, motionExpressionReference(entry.owner, alias, property.stablePath)]);
	} catch (error) { onError(error); } };
	return <fieldset disabled={disabled} className="motionscaper-timeline-actions"><legend>{copy.motionscaperExpressionReferences}</legend>
		<label>{copy.motionscaperExpressionAlias}<input value={alias} onChange={(event) => setAlias(event.currentTarget.value)} /></label>
		<label>{copy.motionscaperExpressionReferenceLayer}<select value={entry?.owner.id ?? ''} onChange={(event) => { setOwnerId(event.currentTarget.value); setPath(''); }}>{owners.map((entry) => <option key={entry.owner.id} value={entry.owner.id}>{entry.label}</option>)}</select></label>
		<label>{copy.motionscaperExpressionReferenceProperty}<select value={property?.stablePath ?? ''} onChange={(event) => setPath(event.currentTarget.value)}>{properties.map((property) => <option key={property.stablePath} value={property.stablePath}>{motionPropertyLabel(property.path, copy, entry && 'kind' in entry.owner ? entry.owner : undefined)}</option>)}</select></label>
		<Button variant="secondary" disabled={!property} onClick={add}>{copy.motionscaperExpressionAddReference}</Button>
		<ul>{references.map((reference) => {
			const target = owners.find(({ owner }) => owner.id === reference.layerId); const property = target ? motionLayerProperties(target.owner).find((entry) => entry.stablePath === reference.propertyPath) : null;
			return <li key={reference.id}><code>{`reference(${JSON.stringify(reference.id)})`}</code>{' · '}{target?.label}{' · '}{property ? motionPropertyLabel(property.path, copy, target && 'kind' in target.owner ? target.owner : undefined) : reference.propertyPath}
				<Button variant="secondary" onClick={() => onChange(references.filter(({ id }) => id !== reference.id))}>{copy.motionscaperExpressionRemoveReference}</Button></li>;
		})}</ul><p>{copy.motionscaperExpressionReferencesHint}</p>
	</fieldset>;
}
