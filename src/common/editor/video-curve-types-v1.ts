/* SPDX-License-Identifier: AGPL-3.0-only */

/** Persisted coordinates are dimensionless. Bit depth and transfer belong to the process. */
export interface VideoCurvePointV1 { readonly x: number; readonly y: number }
export type VideoCurvePointsV1 = readonly Readonly<VideoCurvePointV1>[];
export type VideoEffectParameterV1 = number | VideoCurvePointsV1;
export type CurveChannelV1 = 'master' | 'red' | 'green' | 'blue';
export type PointCurvesParamsV1 = Readonly<Record<CurveChannelV1, VideoCurvePointsV1>>;
export type ParametricCurvesParamsV1 = Readonly<Record<string, number>>;
export type PreparedCurvesEffectV1 = Readonly<{ id: string; enabled: boolean; neutral: boolean }> & (
	Readonly<{ type: 'point-curves-v1'; params: PointCurvesParamsV1 }>
	| Readonly<{ type: 'parametric-curves-v1'; params: ParametricCurvesParamsV1 }>
);
