/* SPDX-License-Identifier: AGPL-3.0-only */

#include "parameter_values.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <new>
#include <stdexcept>
#include <utility>

namespace framescaper::openfx {
namespace {

constexpr std::size_t kMaximumKeys = 65'536;
constexpr std::size_t kMaximumControlPoints = 16'384;
constexpr int kMaximumParametricCurves = 256;

bool finite(const double value) { return std::isfinite(value); }

ParameterSnapshot initial(const ParameterValueKind kind, const std::size_t dimensions) {
	if (kind == ParameterValueKind::integer) return std::vector<int>(dimensions);
	if (kind == ParameterValueKind::real) return std::vector<double>(dimensions);
	if (kind == ParameterValueKind::string) return std::string{};
	return std::monostate{};
}

ParameterSnapshot read_value(const ParameterValues& values, std::va_list& arguments) {
	if (values.kind == ParameterValueKind::integer) {
		std::vector<int> result; result.reserve(values.dimensions);
		for (std::size_t index = 0; index < values.dimensions; ++index) result.push_back(va_arg(arguments, int));
		return result;
	}
	if (values.kind == ParameterValueKind::real) {
		std::vector<double> result; result.reserve(values.dimensions);
		for (std::size_t index = 0; index < values.dimensions; ++index) {
			const auto value = va_arg(arguments, double);
			if (!finite(value)) throw std::invalid_argument("A parameter value must be finite.");
			result.push_back(value);
		}
		return result;
	}
	if (values.kind == ParameterValueKind::string) {
		const auto* value = va_arg(arguments, const char*);
		if (value == nullptr || std::char_traits<char>::length(value) > 1'048'576) {
			throw std::invalid_argument("A string parameter is null or oversized.");
		}
		return std::string{value};
	}
	throw std::invalid_argument("This parameter type has no scalar value.");
}

ParameterSnapshot evaluate(const ParameterValues& values, const OfxTime time) {
	if (!finite(time) || values.keys.empty()) return values.current;
	const auto after = values.keys.lower_bound(time);
	if (after != values.keys.end() && after->first == time) return after->second;
	if (after == values.keys.begin()) return after->second;
	if (after == values.keys.end()) return std::prev(after)->second;
	const auto before = std::prev(after);
	if (values.kind == ParameterValueKind::string) return before->second;
	const auto amount = (time - before->first) / (after->first - before->first);
	if (values.kind == ParameterValueKind::integer) {
		const auto& left = std::get<std::vector<int>>(before->second);
		const auto& right = std::get<std::vector<int>>(after->second);
		std::vector<int> result(values.dimensions);
		for (std::size_t index = 0; index < values.dimensions; ++index) {
			const auto start = static_cast<double>(left[index]);
			const auto finish = static_cast<double>(right[index]);
			result[index] = static_cast<int>(std::llround(start + amount * (finish - start)));
		}
		return result;
	}
	if (values.kind == ParameterValueKind::real) {
		const auto& left = std::get<std::vector<double>>(before->second);
		const auto& right = std::get<std::vector<double>>(after->second);
		std::vector<double> result(values.dimensions);
		for (std::size_t index = 0; index < values.dimensions; ++index) {
			result[index] = left[index] + amount * (right[index] - left[index]);
		}
		return result;
	}
	return values.current;
}

OfxStatus write_value(ParameterValues& values, const ParameterSnapshot& snapshot, std::va_list& arguments) {
	if (values.kind == ParameterValueKind::integer) {
		std::vector<int*> outputs; outputs.reserve(values.dimensions);
		for (std::size_t index = 0; index < values.dimensions; ++index) {
			auto* output = va_arg(arguments, int*); if (output == nullptr) return kOfxStatErrValue;
			outputs.push_back(output);
		}
		const auto& input = std::get<std::vector<int>>(snapshot);
		for (std::size_t index = 0; index < values.dimensions; ++index) *outputs[index] = input[index];
		return kOfxStatOK;
	}
	if (values.kind == ParameterValueKind::real) {
		std::vector<double*> outputs; outputs.reserve(values.dimensions);
		for (std::size_t index = 0; index < values.dimensions; ++index) {
			auto* output = va_arg(arguments, double*); if (output == nullptr) return kOfxStatErrValue;
			outputs.push_back(output);
		}
		const auto& input = std::get<std::vector<double>>(snapshot);
		for (std::size_t index = 0; index < values.dimensions; ++index) *outputs[index] = input[index];
		return kOfxStatOK;
	}
	if (values.kind == ParameterValueKind::string) {
		auto** output = va_arg(arguments, char**); if (output == nullptr) return kOfxStatErrValue;
		values.returned_string = std::get<std::string>(snapshot);
		*output = values.returned_string.data();
		return kOfxStatOK;
	}
	return kOfxStatErrUnsupported;
}

std::vector<double> slope_at(const ParameterValues& values, const OfxTime time) {
	std::vector<double> output(values.dimensions);
	if (values.keys.size() < 2) return output;
	auto right = values.keys.upper_bound(time);
	if (right == values.keys.begin()) ++right;
	if (right == values.keys.end()) right = std::prev(values.keys.end());
	const auto left = std::prev(right);
	const auto& a = std::get<std::vector<double>>(left->second);
	const auto& b = std::get<std::vector<double>>(right->second);
	for (std::size_t index = 0; index < values.dimensions; ++index) {
		output[index] = (b[index] - a[index]) / (right->first - left->first);
	}
	return output;
}

OfxStatus write_reals(const std::vector<double>& input, std::va_list& arguments) {
	std::vector<double*> outputs; outputs.reserve(input.size());
	for (std::size_t index = 0; index < input.size(); ++index) {
		auto* output = va_arg(arguments, double*); if (output == nullptr) return kOfxStatErrValue;
		outputs.push_back(output);
	}
	for (std::size_t index = 0; index < input.size(); ++index) *outputs[index] = input[index];
	return kOfxStatOK;
}

const std::vector<ParametricPoint>* curve_at(const ParameterValues& values, const int curve, const OfxTime time) {
	const auto found = values.curves.find(curve);
	if (found == values.curves.end() || found->second.empty()) return nullptr;
	auto selected = found->second.upper_bound(time);
	if (selected == found->second.begin()) return &selected->second;
	return &std::prev(selected)->second;
}

bool valid_curve(const ParameterValues& values, const int curve) {
	return values.kind == ParameterValueKind::parametric && curve >= 0 && curve < kMaximumParametricCurves;
}

std::vector<ParametricPoint>& mutable_curve(ParameterValues& values, const int curve, const OfxTime time, const bool animate) {
	auto& timeline = values.curves[curve];
	const auto existing = curve_at(values, curve, time);
	OfxTime key_time = time;
	if (!animate) {
		if (timeline.empty()) key_time = 0;
		else {
			const auto after = timeline.upper_bound(time);
			key_time = after == timeline.begin() ? after->first : std::prev(after)->first;
		}
	}
	auto [entry, inserted] = timeline.try_emplace(key_time);
	if (inserted && existing != nullptr) entry->second = *existing;
	return entry->second;
}

} // namespace

bool initialize_parameter_values(ParameterValues& values, const std::string_view type) {
	if (type == kOfxParamTypeInteger || type == kOfxParamTypeBoolean || type == kOfxParamTypeChoice) {
		values.kind = ParameterValueKind::integer; values.dimensions = 1;
	} else if (type == kOfxParamTypeInteger2D) {
		values.kind = ParameterValueKind::integer; values.dimensions = 2;
	} else if (type == kOfxParamTypeInteger3D) {
		values.kind = ParameterValueKind::integer; values.dimensions = 3;
	} else if (type == kOfxParamTypeDouble) {
		values.kind = ParameterValueKind::real; values.dimensions = 1;
	} else if (type == kOfxParamTypeDouble2D) {
		values.kind = ParameterValueKind::real; values.dimensions = 2;
	} else if (type == kOfxParamTypeDouble3D || type == kOfxParamTypeRGB) {
		values.kind = ParameterValueKind::real; values.dimensions = 3;
	} else if (type == kOfxParamTypeRGBA) {
		values.kind = ParameterValueKind::real; values.dimensions = 4;
	} else if (type == kOfxParamTypeString || type == kOfxParamTypeCustom) {
		values.kind = ParameterValueKind::string; values.dimensions = 1;
	} else if (type == kOfxParamTypeParametric) {
		values.kind = ParameterValueKind::parametric; values.dimensions = 1;
	} else if (type == kOfxParamTypeGroup || type == kOfxParamTypePage || type == kOfxParamTypePushButton) {
		values.kind = ParameterValueKind::none; values.dimensions = 0;
	} else return false;
	values.current = initial(values.kind, values.dimensions);
	return true;
}

OfxStatus parameter_get(ParameterValues& values, std::va_list& arguments) {
	try { return write_value(values, values.current, arguments); } catch (...) { return kOfxStatErrValue; }
}
OfxStatus parameter_get_at(ParameterValues& values, const OfxTime time, std::va_list& arguments) {
	if (!finite(time)) return kOfxStatErrValue;
	try { return write_value(values, evaluate(values, time), arguments); } catch (...) { return kOfxStatErrValue; }
}
OfxStatus parameter_set(ParameterValues& values, std::va_list& arguments) {
	try { values.current = read_value(values, arguments); return kOfxStatOK; }
	catch (const std::bad_alloc&) { return kOfxStatErrMemory; } catch (...) { return kOfxStatErrValue; }
}
OfxStatus parameter_set_at(ParameterValues& values, const OfxTime time, std::va_list& arguments) {
	if (!finite(time) || (values.keys.size() >= kMaximumKeys && !values.keys.contains(time))) return kOfxStatErrValue;
	try { values.keys[time] = read_value(values, arguments); return kOfxStatOK; }
	catch (const std::bad_alloc&) { return kOfxStatErrMemory; } catch (...) { return kOfxStatErrValue; }
}
OfxStatus parameter_derivative(ParameterValues& values, const OfxTime time, std::va_list& arguments) {
	if (values.kind != ParameterValueKind::real || !finite(time)) return kOfxStatErrUnsupported;
	try { return write_reals(slope_at(values, time), arguments); } catch (...) { return kOfxStatErrValue; }
}
OfxStatus parameter_integral(ParameterValues& values, OfxTime first, OfxTime last, std::va_list& arguments) {
	if (values.kind != ParameterValueKind::real || !finite(first) || !finite(last)) return kOfxStatErrUnsupported;
	try {
		double sign = 1; if (last < first) { std::swap(first, last); sign = -1; }
		std::vector<OfxTime> times{first};
		for (const auto& [time, unused] : values.keys) if (time > first && time < last) times.push_back(time);
		times.push_back(last);
		std::vector<double> result(values.dimensions);
		for (std::size_t part = 1; part < times.size(); ++part) {
			const auto left = std::get<std::vector<double>>(evaluate(values, times[part - 1]));
			const auto right = std::get<std::vector<double>>(evaluate(values, times[part]));
			for (std::size_t index = 0; index < values.dimensions; ++index) {
				result[index] += sign * (times[part] - times[part - 1]) * (left[index] + right[index]) / 2;
			}
		}
		return write_reals(result, arguments);
	} catch (...) { return kOfxStatErrValue; }
}

OfxStatus parameter_key_count(const ParameterValues& values, unsigned int* count) {
	if (count == nullptr || values.keys.size() > std::numeric_limits<unsigned int>::max()) return kOfxStatErrBadHandle;
	*count = static_cast<unsigned int>(values.keys.size()); return kOfxStatOK;
}
OfxStatus parameter_key_time(const ParameterValues& values, const unsigned int index, OfxTime* time) {
	if (time == nullptr) return kOfxStatErrBadHandle;
	if (index >= values.keys.size()) return kOfxStatErrBadIndex;
	auto found = values.keys.begin(); std::advance(found, index); *time = found->first; return kOfxStatOK;
}
OfxStatus parameter_key_index(const ParameterValues& values, const OfxTime time, const int direction, int* index) {
	if (index == nullptr || !finite(time)) return kOfxStatErrBadHandle;
	*index = -1; auto found = values.keys.lower_bound(time);
	if (direction == 0) { if (found == values.keys.end() || found->first != time) return kOfxStatFailed; }
	else if (direction > 0) { if (found != values.keys.end() && found->first == time) ++found; if (found == values.keys.end()) return kOfxStatFailed; }
	else { if (found == values.keys.begin()) return kOfxStatFailed; --found; }
	*index = static_cast<int>(std::distance(values.keys.begin(), found)); return kOfxStatOK;
}
OfxStatus parameter_delete_key(ParameterValues& values, const OfxTime time) {
	return finite(time) && values.keys.erase(time) == 1 ? kOfxStatOK : kOfxStatErrBadIndex;
}
void parameter_delete_all_keys(ParameterValues& values) { values.keys.clear(); }
OfxStatus parameter_copy(ParameterValues& destination, const ParameterValues& source, const OfxTime offset, const OfxRangeD* range) {
	if (destination.kind != source.kind || destination.dimensions != source.dimensions || !finite(offset)) return kOfxStatErrValue;
	const bool all = range == nullptr || (range->min == 0 && range->max == 0);
	if (!all && (!finite(range->min) || !finite(range->max) || range->max < range->min)) return kOfxStatErrValue;
	try {
		destination.current = source.current; destination.keys.clear(); destination.curves.clear();
		for (const auto& [time, value] : source.keys) {
			if ((all || (time >= range->min && time <= range->max)) && finite(time + offset)) destination.keys.emplace(time + offset, value);
		}
		for (const auto& [curve, timeline] : source.curves) {
			for (const auto& [time, points] : timeline) {
				if ((all || (time >= range->min && time <= range->max)) && finite(time + offset)) {
					destination.curves[curve].emplace(time + offset, points);
				}
			}
		}
		return kOfxStatOK;
	} catch (const std::bad_alloc&) { return kOfxStatErrMemory; }
}

OfxStatus parametric_get_value(ParameterValues& values, const int curve, const OfxTime time, const double position, double* output) {
	if (!valid_curve(values, curve) || output == nullptr || !finite(time) || !finite(position)) return kOfxStatErrBadIndex;
	const auto* points = curve_at(values, curve, time);
	if (points == nullptr || points->empty()) { *output = position; return kOfxStatOK; }
	auto right = std::lower_bound(points->begin(), points->end(), position, [](const auto& point, double key) { return point.key < key; });
	if (right == points->begin()) { *output = right->value; return kOfxStatOK; }
	if (right == points->end()) { *output = points->back().value; return kOfxStatOK; }
	if (right->key == position) { *output = right->value; return kOfxStatOK; }
	const auto& left = *std::prev(right);
	*output = left.value + (position - left.key) * (right->value - left.value) / (right->key - left.key);
	return kOfxStatOK;
}
OfxStatus parametric_point_count(ParameterValues& values, const int curve, const OfxTime time, int* output) {
	if (!valid_curve(values, curve) || output == nullptr || !finite(time)) return kOfxStatErrBadIndex;
	const auto* points = curve_at(values, curve, time); *output = points == nullptr ? 0 : static_cast<int>(points->size()); return kOfxStatOK;
}
OfxStatus parametric_get_point(ParameterValues& values, const int curve, const OfxTime time, const int index, double* key, double* output) {
	if (!valid_curve(values, curve) || key == nullptr || output == nullptr || !finite(time)) return kOfxStatErrBadIndex;
	const auto* points = curve_at(values, curve, time);
	if (points == nullptr || index < 0 || static_cast<std::size_t>(index) >= points->size()) return kOfxStatErrBadIndex;
	*key = (*points)[static_cast<std::size_t>(index)].key; *output = (*points)[static_cast<std::size_t>(index)].value; return kOfxStatOK;
}
OfxStatus parametric_set_point(ParameterValues& values, const int curve, const OfxTime time, const int index, const double key, const double value, const bool animate) {
	if (!valid_curve(values, curve) || !finite(time) || !finite(key) || !finite(value)) return kOfxStatErrBadIndex;
	try {
		auto& points = mutable_curve(values, curve, time, animate);
		if (index < 0 || static_cast<std::size_t>(index) >= points.size()) return kOfxStatErrBadIndex;
		auto updated = points; updated[static_cast<std::size_t>(index)] = {key, value};
		std::sort(updated.begin(), updated.end(), [](const auto& a, const auto& b) { return a.key < b.key; });
		for (std::size_t item = 1; item < updated.size(); ++item) if (updated[item - 1].key == updated[item].key) return kOfxStatErrExists;
		points = std::move(updated);
		return kOfxStatOK;
	} catch (const std::bad_alloc&) { return kOfxStatErrMemory; }
}
OfxStatus parametric_add_point(ParameterValues& values, const int curve, const OfxTime time, const double key, const double value, const bool animate) {
	if (!valid_curve(values, curve) || !finite(time) || !finite(key) || !finite(value)) return kOfxStatErrBadIndex;
	try {
		auto& points = mutable_curve(values, curve, time, animate);
		if (points.size() >= kMaximumControlPoints) return kOfxStatErrMemory;
		const auto at = std::lower_bound(points.begin(), points.end(), key, [](const auto& point, double candidate) { return point.key < candidate; });
		if (at != points.end() && at->key == key) return kOfxStatErrExists;
		points.insert(at, {key, value}); return kOfxStatOK;
	} catch (const std::bad_alloc&) { return kOfxStatErrMemory; }
}
OfxStatus parametric_delete_point(ParameterValues& values, const int curve, const int index) {
	if (!valid_curve(values, curve)) return kOfxStatErrBadIndex;
	auto found = values.curves.find(curve); if (found == values.curves.end() || found->second.empty()) return kOfxStatErrBadIndex;
	auto& points = found->second.begin()->second;
	if (index < 0 || static_cast<std::size_t>(index) >= points.size()) return kOfxStatErrBadIndex;
	points.erase(points.begin() + index); return kOfxStatOK;
}
OfxStatus parametric_delete_all_points(ParameterValues& values, const int curve) {
	if (!valid_curve(values, curve)) return kOfxStatErrBadIndex;
	values.curves.erase(curve); return kOfxStatOK;
}

} // namespace framescaper::openfx
