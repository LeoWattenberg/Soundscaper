/* SPDX-License-Identifier: AGPL-3.0-only */

#pragma once

#include "openfx_abi.hpp"

#include <cstdarg>
#include <map>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace framescaper::openfx {

enum class ParameterValueKind { none, integer, real, string, parametric };
using ParameterSnapshot = std::variant<std::monostate, std::vector<int>, std::vector<double>, std::string>;
struct ParametricPoint { double key{}; double value{}; };

struct ParameterValues final {
	ParameterValueKind kind{ParameterValueKind::none};
	std::size_t dimensions{};
	ParameterSnapshot current;
	std::map<OfxTime, ParameterSnapshot> keys;
	std::map<int, std::map<OfxTime, std::vector<ParametricPoint>>> curves;
	std::string returned_string;
};

/** Fully admitted V26 state ready for one exact plug-in parameter definition. */
struct HydratedParameterState final {
	std::string name;
	std::string ofx_type;
	ParameterValues values;
	std::size_t keyframe_count{};
};

bool initialize_parameter_values(ParameterValues& values, std::string_view type);
OfxStatus parameter_get(ParameterValues& values, std::va_list& arguments);
OfxStatus parameter_get_at(ParameterValues& values, OfxTime time, std::va_list& arguments);
OfxStatus parameter_derivative(ParameterValues& values, OfxTime time, std::va_list& arguments);
OfxStatus parameter_integral(ParameterValues& values, OfxTime first, OfxTime last, std::va_list& arguments);
OfxStatus parameter_set(ParameterValues& values, std::va_list& arguments);
OfxStatus parameter_set_at(ParameterValues& values, OfxTime time, std::va_list& arguments);
OfxStatus parameter_key_count(const ParameterValues& values, unsigned int* count);
OfxStatus parameter_key_time(const ParameterValues& values, unsigned int index, OfxTime* time);
OfxStatus parameter_key_index(const ParameterValues& values, OfxTime time, int direction, int* index);
OfxStatus parameter_delete_key(ParameterValues& values, OfxTime time);
void parameter_delete_all_keys(ParameterValues& values);
OfxStatus parameter_copy(ParameterValues& destination, const ParameterValues& source, OfxTime offset, const OfxRangeD* range);

OfxStatus parametric_get_value(ParameterValues& values, int curve, OfxTime time, double position, double* output);
OfxStatus parametric_point_count(ParameterValues& values, int curve, OfxTime time, int* output);
OfxStatus parametric_get_point(ParameterValues& values, int curve, OfxTime time, int index, double* key, double* output);
OfxStatus parametric_set_point(ParameterValues& values, int curve, OfxTime time, int index, double key, double value, bool animate);
OfxStatus parametric_add_point(ParameterValues& values, int curve, OfxTime time, double key, double value, bool animate);
OfxStatus parametric_delete_point(ParameterValues& values, int curve, int index);
OfxStatus parametric_delete_all_points(ParameterValues& values, int curve);

} // namespace framescaper::openfx
