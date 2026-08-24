/* SPDX-License-Identifier: AGPL-3.0-only */

using MediaDeclarationMap = std::array<std::pair<std::string_view, std::string_view>, 3>;

constexpr MediaDeclarationMap kComponentDeclarations{{
	{kOfxImageComponentRGBA, "RGBA"},
	{kOfxImageComponentRGB, "RGB"},
	{kOfxImageComponentAlpha, "Alpha"},
}};

constexpr MediaDeclarationMap kPixelDepthDeclarations{{
	{kOfxBitDepthByte, "byte"},
	{kOfxBitDepthShort, "short"},
	{kOfxBitDepthFloat, "float"},
}};

std::optional<std::vector<std::string>> normalized_media_declarations(
	const std::vector<PropertyValue>& values,
	const MediaDeclarationMap& declarations
) {
	if (values.empty() || values.size() > declarations.size()) return std::nullopt;
	std::set<std::string_view> observed;
	for (const auto& value : values) {
		const auto* text = std::get_if<std::string>(&value);
		if (text == nullptr) return std::nullopt;
		const auto found = std::find_if(
			declarations.begin(), declarations.end(), [text](const auto& declaration) {
				return declaration.first == *text;
			}
		);
		if (found == declarations.end() || !observed.insert(found->first).second) {
			return std::nullopt;
		}
	}
	std::vector<std::string> normalized;
	for (const auto& [official, projected] : declarations) {
		if (observed.contains(official)) normalized.emplace_back(projected);
	}
	return normalized;
}

std::optional<std::vector<std::string>> normalized_pixel_depths(const Effect& effect_record) {
	const auto found = effect_record.properties.values.find(
		kOfxImageEffectPropSupportedPixelDepths
	);
	return found == effect_record.properties.values.end()
		? std::nullopt
		: normalized_media_declarations(found->second, kPixelDepthDeclarations);
}

std::optional<std::vector<std::string>> normalized_components(const Effect& effect_record) {
	std::optional<std::vector<std::string>> normalized;
	for (const auto& [name, clip] : effect_record.clips) {
		static_cast<void>(name);
		const auto found = clip->properties.values.find(kOfxImageEffectPropSupportedComponents);
		if (found == clip->properties.values.end()) return std::nullopt;
		const auto current = normalized_media_declarations(found->second, kComponentDeclarations);
		if (!current.has_value() || (normalized.has_value() && *normalized != *current)) {
			return std::nullopt;
		}
		normalized = current;
	}
	return normalized.value_or(std::vector<std::string>{});
}

std::string normalized_parameter_type(const std::string_view type) {
	static constexpr std::array<std::pair<std::string_view, std::string_view>, 16> types{{
		{kOfxParamTypeInteger, "integer"}, {kOfxParamTypeInteger2D, "integer2d"},
		{kOfxParamTypeInteger3D, "integer3d"}, {kOfxParamTypeDouble, "double"},
		{kOfxParamTypeDouble2D, "double2d"}, {kOfxParamTypeDouble3D, "double3d"},
		{kOfxParamTypeRGB, "rgb"}, {kOfxParamTypeRGBA, "rgba"},
		{kOfxParamTypeBoolean, "boolean"}, {kOfxParamTypeChoice, "choice"},
		{kOfxParamTypeString, "string"}, {kOfxParamTypeGroup, "group"},
		{kOfxParamTypePage, "page"}, {kOfxParamTypePushButton, "pushbutton"},
		{kOfxParamTypeParametric, "parametric"}, {kOfxParamTypeCustom, "custom"},
	}};
	const auto found = std::find_if(types.begin(), types.end(), [type](const auto& entry) {
		return entry.first == type;
	});
	return found == types.end() ? std::string{} : std::string{found->second};
}

bool HostState::rgba_byte_ready() const {
	const auto depths = normalized_pixel_depths(effect_record);
	const auto components = normalized_components(effect_record);
	return !effect_record.clips.empty() && effect_record.clips.contains("Output")
		&& depths.has_value() && components.has_value()
		&& std::find(depths->begin(), depths->end(), "byte") != depths->end()
		&& std::find(components->begin(), components->end(), "RGBA") != components->end();
}

std::optional<std::vector<std::string>> HostState::declared_render_backends() const {
	std::vector<std::string> result;
	const auto declared = [&](const char* name, const bool default_value, const bool needed = false) -> std::optional<bool> {
		const auto found = effect_record.properties.values.find(name);
		if (found == effect_record.properties.values.end()) return default_value;
		if (found->second.size() != 1) return std::nullopt;
		const auto* value = std::get_if<std::string>(&found->second.front());
		if (value == nullptr || (*value != "true" && *value != "false" && (!needed || *value != "needed"))) return std::nullopt;
		return *value == "true" || (needed && *value == "needed");
	};
	const auto cpu = declared(kOfxImageEffectPropCPURenderSupported, true);
	const auto opengl = declared(kOfxImageEffectPropOpenGLRenderSupported, false, true);
	const auto opencl_buffers = declared(kOfxImageEffectPropOpenCLRenderSupported, false);
	const auto opencl_images = declared(kOfxImageEffectPropOpenCLSupported, false);
	const auto cuda = declared(kOfxImageEffectPropCudaRenderSupported, false);
	const auto metal = declared(kOfxImageEffectPropMetalRenderSupported, false);
	if (!cpu.has_value() || !opengl.has_value() || !opencl_buffers.has_value()
		|| !opencl_images.has_value() || !cuda.has_value() || !metal.has_value()) return std::nullopt;
	if (*cpu) result.emplace_back("cpu");
	if (*opengl) result.emplace_back("opengl");
	if (*opencl_buffers || *opencl_images) result.emplace_back("opencl");
	if (*cuda) result.emplace_back("cuda");
	if (*metal) result.emplace_back("metal");
	return result;
}

std::optional<PluginInspection> HostState::inspection() const {
	PluginInspection result;
	const auto contexts = effect_record.properties.values.find(kOfxImageEffectPropSupportedContexts);
	const auto threading = effect_record.properties.values.find(kOfxImageEffectPluginRenderThreadSafety);
	const auto pixel_depths = normalized_pixel_depths(effect_record);
	const auto components = normalized_components(effect_record);
	const auto render_backends = declared_render_backends();
	if (contexts == effect_record.properties.values.end()
		|| threading == effect_record.properties.values.end()
		|| threading->second.size() != 1 || !pixel_depths.has_value()
		|| !components.has_value() || !render_backends.has_value()) return std::nullopt;
	for (const auto& value : contexts->second) {
		const auto* official = std::get_if<std::string>(&value);
		if (official == nullptr) return std::nullopt;
		const auto found = std::find_if(kContexts.begin(), kContexts.end(), [official](const auto name) {
			return *official == official_context(*parse_context(name));
		});
		if (found == kContexts.end()) return std::nullopt;
		result.contexts.emplace_back(*found);
	}
	const auto* safety = std::get_if<std::string>(&threading->second.front());
	if (safety == nullptr) return std::nullopt;
	if (*safety == kOfxImageEffectRenderUnsafe) result.threading = "unsafe";
	else if (*safety == kOfxImageEffectRenderInstanceSafe) result.threading = "instance-safe";
	else if (*safety == kOfxImageEffectRenderFullySafe) result.threading = "fully-safe";
	else return std::nullopt;
	result.components = *components;
	result.pixel_depths = *pixel_depths;
	result.render_backends = *render_backends;
	for (const auto& [name, parameter] : effect_record.parameters.parameters) {
		const auto animates = parameter->properties.values.find(kOfxParamPropAnimates);
		const auto type = normalized_parameter_type(parameter->type);
		if (type.empty() || animates == parameter->properties.values.end()
			|| animates->second.size() != 1) return std::nullopt;
		const auto* animated = std::get_if<int>(&animates->second.front());
		if (animated == nullptr || (*animated != 0 && *animated != 1)) return std::nullopt;
		result.parameters.push_back({name, type, *animated == 1});
	}
	result.requested_suites.assign(requested_suites.begin(), requested_suites.end());
	return result;
}

bool same_parameter_contract(
	const std::vector<InspectedParameter>& left,
	const std::vector<InspectedParameter>& right
) {
	return left.size() == right.size() && std::equal(
		left.begin(), left.end(), right.begin(), [](const auto& first, const auto& second) {
			return first.name == second.name && first.type == second.type
				&& first.animates == second.animates;
		}
	);
}

std::optional<PluginInspection> inspect_plugin_contexts(
	HostState& state,
	OfxHost* host,
	OfxPlugin& plugin
) {
	state.reset(false);
	plugin.setHost(host);
	const bool loaded = accepted_status(call(plugin, kOfxActionLoad, nullptr));
	const bool described = loaded
		&& accepted_status(call(plugin, kOfxActionDescribe, &state.effect_record))
		&& state.descriptor_valid();
	const auto base = described ? state.inspection() : std::nullopt;
	const bool unloaded = loaded && accepted_status(call(plugin, kOfxActionUnload, nullptr));
	if (!base.has_value() || !unloaded) return std::nullopt;

	PluginInspection result = *base;
	result.parameters.clear();
	std::set<std::string> requested_suites{
		base->requested_suites.begin(), base->requested_suites.end(),
	};
	bool first_context = true;
	for (const auto& name : base->contexts) {
		state.reset(false);
		plugin.setHost(host);
		const bool context_loaded = accepted_status(call(plugin, kOfxActionLoad, nullptr));
		const bool context_described = context_loaded
			&& accepted_status(call(plugin, kOfxActionDescribe, &state.effect_record))
			&& state.descriptor_valid(*parse_context(name));
		PropertySet arguments;
		arguments.owner = &state;
		prop_set_string(
			handle(arguments), kOfxImageEffectPropContext, 0,
			official_context(*parse_context(name))
		);
		const bool in_context = context_described && accepted_status(call(
			plugin, kOfxImageEffectActionDescribeInContext,
			&state.effect_record, &arguments
		)) && state.rgba_byte_ready();
		const auto inspected = in_context ? state.inspection() : std::nullopt;
		const bool context_unloaded = context_loaded
			&& accepted_status(call(plugin, kOfxActionUnload, nullptr));
		if (!inspected.has_value() || !context_unloaded
			|| inspected->contexts != base->contexts || inspected->threading != base->threading
			|| inspected->render_backends != base->render_backends
			|| inspected->pixel_depths != base->pixel_depths
			|| (!first_context
				&& (!same_parameter_contract(result.parameters, inspected->parameters)
					|| result.components != inspected->components))) {
			return std::nullopt;
		}
		if (first_context) {
			result.parameters = inspected->parameters;
			result.components = inspected->components;
			first_context = false;
		}
		requested_suites.insert(
			inspected->requested_suites.begin(), inspected->requested_suites.end()
		);
	}
	result.requested_suites.assign(requested_suites.begin(), requested_suites.end());
	return result;
}
