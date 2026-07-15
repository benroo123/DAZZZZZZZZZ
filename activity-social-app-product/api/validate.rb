#!/usr/bin/env ruby
require 'yaml'
require 'json'

root = File.expand_path('..', __dir__)
spec = YAML.load_file(File.join(__dir__, 'openapi.yaml'))
tools = JSON.parse(File.read(File.join(__dir__, 'agent-tools.json')))
errors = []
http_methods = %w[get post put patch delete options head trace]

operations = []
spec.fetch('paths').each do |path, item|
  path_parameters = Array(item['parameters'])
  item.each do |method, operation|
    next unless http_methods.include?(method)
    operation_id = operation['operationId']
    errors << "missing operationId: #{method.upcase} #{path}" unless operation_id
    operations << operation_id if operation_id

    declared = (path_parameters + Array(operation['parameters'])).map do |parameter|
      if parameter.is_a?(Hash) && parameter['$ref']
        ref = parameter['$ref'].sub('#/components/parameters/', '')
        spec.dig('components', 'parameters', ref, 'name')
      elsif parameter.is_a?(Hash) && parameter['in'] == 'path'
        parameter['name']
      end
    end.compact
    required = path.scan(/\{([^}]+)\}/).flatten
    missing = required - declared
    errors << "undeclared path parameters #{missing.inspect}: #{method.upcase} #{path}" unless missing.empty?
  end
end

duplicates = operations.group_by(&:itself).select { |_, values| values.length > 1 }.keys
errors << "duplicate operationIds: #{duplicates.join(', ')}" unless duplicates.empty?

refs = []
walk = lambda do |value|
  case value
  when Hash
    value.each do |key, child|
      refs << child if key == '$ref' && child.is_a?(String) && child.start_with?('#/')
      walk.call(child)
    end
  when Array
    value.each { |child| walk.call(child) }
  end
end
walk.call(spec)
refs.uniq.each do |ref|
  begin
    ref.sub('#/', '').split('/').reduce(spec) { |memo, key| memo.fetch(key) }
  rescue KeyError
    errors << "broken ref: #{ref}"
  end
end

tool_ops = tools.fetch('tools').map { |tool| tool.fetch('operation_id') }
missing_tool_ops = tool_ops - operations
errors << "Agent tools without OpenAPI operationId: #{missing_tool_ops.join(', ')}" unless missing_tool_ops.empty?
duplicate_tools = tools.fetch('tools').map { |tool| tool.fetch('name') }.group_by(&:itself).select { |_, values| values.length > 1 }.keys
errors << "duplicate Agent tools: #{duplicate_tools.join(', ')}" unless duplicate_tools.empty?

if errors.any?
  warn errors.join("\n")
  exit 1
end

puts "OK: #{spec['paths'].length} paths, #{operations.length} unique operations, #{tool_ops.length} Agent tools, #{refs.uniq.length} component refs"
