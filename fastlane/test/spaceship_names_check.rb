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

if missing.empty?
  puts "Spaceship #{Gem.loaded_specs['fastlane']&.version}: all calls present"
else
  warn "Missing in Spaceship: #{missing.join(', ')}"
  exit 1
end
