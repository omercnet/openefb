# bundle exec ruby fastlane/test/spaceship_names_check.rb
# Every Spaceship call TestflightSetup::ConnectApi makes exists in the locked fastlane, with the keywords it passes.
# Plain script (Ruby 4 no longer ships minitest in the bundle): exits 1 and says what is missing.
require "spaceship"
require_relative "../testflight_setup"

missing = []
check = lambda do |ok, what|
  missing << what unless ok
end

testflight = Spaceship::ConnectAPI::TestFlight::API
%i[get_beta_testers get_builds create_beta_group].each do |name|
  check.call(testflight.method_defined?(name), "ConnectAPI.#{name}")
end
if testflight.method_defined?(:create_beta_group)
  check.call(testflight.instance_method(:create_beta_group).parameters.map(&:last).include?(:has_access_to_all_builds),
             "create_beta_group(has_access_to_all_builds:)")
end
check.call(testflight.instance_method(:get_beta_testers).parameters.map(&:last).include?(:filter), "get_beta_testers(filter:)")
check.call(testflight.instance_method(:get_builds).parameters.map(&:last).include?(:sort), "get_builds(sort:)")

group = Spaceship::ConnectAPI::BetaGroup
%i[update add_beta_testers fetch_builds].each { |name| check.call(group.method_defined?(name), "BetaGroup##{name}") }
check.call(group.instance_method(:update).parameters.map(&:last).include?(:attributes), "BetaGroup#update(attributes:)")
check.call(group.method_defined?(:has_access_to_all_builds), "BetaGroup#has_access_to_all_builds")
check.call(group.method_defined?(:is_internal_group), "BetaGroup#is_internal_group")
check.call(Spaceship::ConnectAPI::App.method_defined?(:get_beta_groups), "App#get_beta_groups")
check.call(Spaceship::ConnectAPI::BetaTester.method_defined?(:email), "BetaTester#email")
check.call(Spaceship::ConnectAPI::Build.method_defined?(:pre_release_version), "Build#pre_release_version")
check.call(Spaceship::ConnectAPI::Build.method_defined?(:processing_state), "Build#processing_state")

# The build uploads read: Spaceship has the call and the model with the fields status prints.
check.call(testflight.method_defined?(:get_build_uploads), "ConnectAPI.get_build_uploads")
if testflight.method_defined?(:get_build_uploads)
  check.call(testflight.instance_method(:get_build_uploads).parameters.map(&:last).include?(:app_id), "get_build_uploads(app_id:)")
end
upload = Spaceship::ConnectAPI::BuildUpload
%i[cf_build_version cf_build_short_version_string platform uploaded_date created_date state].each do |name|
  check.call(upload.method_defined?(name), "BuildUpload##{name}")
end
uploads_seen = []
Spaceship::ConnectAPI.singleton_class.send(:alias_method, :real_get_build_uploads, :get_build_uploads)
Spaceship::ConnectAPI.define_singleton_method(:get_build_uploads) do |**args|
  uploads_seen << args
  Struct.new(:to_models).new([])
end
begin
  TestflightSetup::ConnectApi.new.build_uploads(Struct.new(:id).new("app1"), 5)
ensure
  Spaceship::ConnectAPI.singleton_class.send(:alias_method, :get_build_uploads, :real_get_build_uploads)
end
check.call(uploads_seen.size == 1 && uploads_seen[0][:app_id] == "app1", "build_uploads calls get_build_uploads(app_id:)")

# The adapter turns a tester refusal of the API into TesterRefused and lets every other API error through.
group_fake = Object.new
tester = Struct.new(:id).new("t1")
[["Tester already invited - state of another resource", TestflightSetup::TesterRefused],
 ["The specified resource does not exist", Spaceship::UnexpectedResponse]].each do |text, expected|
  group_fake.define_singleton_method(:add_beta_testers) { |**| raise Spaceship::UnexpectedResponse, text }
  begin
    TestflightSetup::ConnectApi.new.add_tester(group_fake, tester)
    missing << "add_tester raised nothing for #{text.inspect}"
  rescue StandardError => e
    missing << "add_tester raised #{e.class} for #{text.inspect}, expected #{expected}" unless e.instance_of?(expected)
  end
end

# Both build reads pass `includes:` explicitly, without betaBuildMetrics (Apple rejects it; Spaceship's default asks for it).
default_includes = testflight.instance_method(:get_builds).parameters.any? { |kind, name| name == :includes && kind == :key }
check.call(default_includes, "get_builds(includes:)")
seen = []
Spaceship::ConnectAPI.singleton_class.send(:alias_method, :real_get_builds, :get_builds)
Spaceship::ConnectAPI.define_singleton_method(:get_builds) do |**args|
  seen << args
  Struct.new(:to_models).new([])
end
begin
  adapter = TestflightSetup::ConnectApi.new
  adapter.group_builds(Struct.new(:id).new("g1"), 5)
  adapter.latest_builds(Struct.new(:id).new("app1"), 5)
ensure
  Spaceship::ConnectAPI.singleton_class.send(:alias_method, :get_builds, :real_get_builds)
end
check.call(seen.size == 2, "both build reads call get_builds (saw #{seen.size})")
seen.each_with_index do |args, i|
  name = %w[group_builds latest_builds][i]
  check.call(args.key?(:includes), "#{name} passes includes: explicitly")
  check.call(!args[:includes].to_s.include?("betaBuildMetrics"), "#{name} must not include betaBuildMetrics")
end
check.call(TestflightSetup::ConnectApi::BUILD_INCLUDES == "preReleaseVersion", "BUILD_INCLUDES is preReleaseVersion")
# The newest builds are asked for in every processing state, so a build still PROCESSING or turned down (FAILED, INVALID) shows.
states = seen[1][:filter].to_h[:processingState].to_s.split(",").sort
check.call(states == %w[FAILED INVALID PROCESSING VALID], "latest_builds filters processingState to all four states, got #{states}")
check.call(seen[1][:filter].to_h[:app] == "app1", "latest_builds filters by app")

if missing.empty?
  puts "Spaceship #{Gem.loaded_specs['fastlane']&.version}: all calls present"
else
  warn "Missing in Spaceship: #{missing.join(', ')}"
  exit 1
end
