/* SPDX-License-Identifier: AGPL-3.0-only */

const char* host_standard_parameter_name(const Context context) {
	if (context == Context::retimer) return "SourceTime";
	if (context == Context::transition) return "Transition";
	return nullptr;
}

bool valid_host_standard_parameter_value(const Context context, const double value) {
	if (!std::isfinite(value)) return false;
	return context != Context::transition || (value >= 0 && value <= 1);
}

bool bind_host_standard_parameter(
	ParameterSet& parameters,
	const Context context,
	const std::optional<double> value,
	InvocationResult& result
) {
	const auto* name = host_standard_parameter_name(context);
	if (name == nullptr) return !value.has_value();
	if (!value.has_value() || !valid_host_standard_parameter_value(context, *value)
		|| parameters.parameters.contains(name)
		|| parameters.parameters.size() >= kMaximumParameters) return false;
	auto parameter = std::make_unique<Parameter>();
	parameter->properties.owner = parameters.properties.owner;
	parameter->name = name;
	parameter->type = kOfxParamTypeDouble;
	parameter->host_owned = true;
	if (!initialize_parameter_values(parameter->values, parameter->type.c_str())) return false;
	parameter->values.current = std::vector<double>{*value};
	if (prop_set_int(handle(parameter->properties), kOfxParamPropAnimates, 0, 1) != kOfxStatOK) {
		return false;
	}
	parameters.parameters.emplace(name, std::move(parameter));
	result.host_standard_parameter = name;
	result.host_standard_parameter_bound = true;
	return true;
}
