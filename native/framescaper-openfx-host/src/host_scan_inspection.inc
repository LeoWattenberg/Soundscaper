/* SPDX-License-Identifier: AGPL-3.0-only */

bool contains_string(const std::vector<PropertyValue>& values, const std::string_view expected) {
	return std::any_of(values.begin(), values.end(), [expected](const auto& value) {
		const auto* text = std::get_if<std::string>(&value);
		return text != nullptr && *text == expected;
	});
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
	const auto depths = effect_record.properties.values.find(kOfxImageEffectPropSupportedPixelDepths);
	if (depths == effect_record.properties.values.end() || effect_record.clips.empty()
		|| !contains_string(depths->second, kOfxBitDepthByte)
		|| !effect_record.clips.contains("Output")) return false;
	return std::all_of(effect_record.clips.begin(), effect_record.clips.end(), [](const auto& entry) {
		const auto components = entry.second->properties.values.find(
			kOfxImageEffectPropSupportedComponents
		);
		return components != entry.second->properties.values.end()
			&& contains_string(components->second, kOfxImageComponentRGBA);
	});
}

std::optional<PluginInspection> HostState::inspection() const {
	PluginInspection result;
	const auto contexts = effect_record.properties.values.find(kOfxImageEffectPropSupportedContexts);
	const auto threading = effect_record.properties.values.find(kOfxImageEffectPluginRenderThreadSafety);
	if (contexts == effect_record.properties.values.end()
		|| threading == effect_record.properties.values.end()) return std::nullopt;
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
	result.threading = *safety == kOfxImageEffectRenderUnsafe ? "unsafe"
		: *safety == kOfxImageEffectRenderInstanceSafe ? "instance-safe" : "fully-safe";
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
			|| (!first_context
				&& !same_parameter_contract(result.parameters, inspected->parameters))) {
			return std::nullopt;
		}
		if (first_context) {
			result.parameters = inspected->parameters;
			first_context = false;
		}
		requested_suites.insert(
			inspected->requested_suites.begin(), inspected->requested_suites.end()
		);
	}
	result.requested_suites.assign(requested_suites.begin(), requested_suites.end());
	return result;
}
