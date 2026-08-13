/* SPDX-License-Identifier: AGPL-3.0-only */

export const VIDEO_PREVIEW_GEOMETRY_VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
uniform mat3 u_position_transform;
uniform mat3 u_texture_transform;
out vec2 v_uv;

void main() {
	vec2 unit_position = a_position * 0.5 + 0.5;
	v_uv = (u_texture_transform * vec3(unit_position, 1.0)).xy;
	vec2 device_position = (u_position_transform * vec3(unit_position, 1.0)).xy;
	gl_Position = vec4(device_position, 0.0, 1.0);
}`;

export const VIDEO_PREVIEW_IDENTITY_POSITION_TRANSFORM = Object.freeze([
	2, 0, 0,
	0, 2, 0,
	-1, -1, 1,
]);

export const VIDEO_PREVIEW_IDENTITY_TEXTURE_TRANSFORM = Object.freeze([
	1, 0, 0,
	0, 1, 0,
	0, 0, 1,
]);
