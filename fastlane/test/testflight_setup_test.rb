# ruby fastlane/test/testflight_setup_test.rb   (minitest only; no Spaceship, no key). The Spaceship call names are checked by
# spaceship_names_check.rb under `bundle exec`.
# The setup logic against fake groups, testers and builds: what it creates, patches and adds, and what it must never do.
require "minitest/autorun"
require "timeout"
require_relative "../testflight_setup"

Group = Struct.new(:id, :name, :is_internal_group, :has_access_to_all_builds)
Tester = Struct.new(:id, :email)
Build = Struct.new(:id, :version, :processing_state, :pre_release_version)
Upload = Struct.new(:cf_build_version, :cf_build_short_version_string, :platform, :uploaded_date, :created_date, :state)
Train = Struct.new(:version)
App = Struct.new(:id)

# Records every call. `fail_for` makes add_tester refuse those tester ids.
class FakeApi
  attr_reader :calls, :groups_list
  attr_writer :builds, :uploads

  def initialize(groups:, members:, builds: [], build_groups: {}, fail_for: {})
    @groups_list = groups
    @members = members # group id => [Tester]
    @builds = builds
    @build_groups = build_groups # group id => [build ids]
    @fail_for = fail_for # tester id => message
    @calls = []
  end

  def groups(_app) = @groups_list
  def group_testers(group) = @members.fetch(group.id, [])
  def group_builds(group, count) = (@build_groups[group.id] || []).first(count).map { |id| Build.new(id) }
  def latest_builds(_app, count) = @builds.first(count)
  def build_uploads(_app, count) = (@uploads || []).first(count)

  def create_internal_group(_app, name)
    @calls << [:create_internal_group, name]
    group = Group.new("new-#{name}", name, true, true)
    @groups_list += [group]
    group
  end

  def enable_all_builds(group)
    @calls << [:enable_all_builds, group.id]
    group.has_access_to_all_builds = true
  end

  def add_tester(group, tester)
    raise @fail_for[tester.id] if @fail_for.key?(tester.id) # an exception to raise

    @calls << [:add_tester, group.id, tester.id]
    (@members[group.id] ||= []) << tester
  end

  def mutations = @calls.map(&:first)
end

class TestflightSetupTest < Minitest::Test
  APP = App.new("app1")
  ALICE = Tester.new("t1", "alice@example.com")
  BOB = Tester.new("t2", "Bob@Example.org")
  CAROL = Tester.new("t3", "carol@example.net")
  PUBLIC = Tester.new("t9", "public@example.com")

  def team = Group.new("g-team", "App Store Connect Users", true, true)
  def beta = Group.new("g-beta", "Public Beta", false, nil)

  def api(groups:, members: {}, **rest) = FakeApi.new(groups: groups, members: members, **rest)

  def test_mask_email_keeps_the_first_letter_and_the_domain
    assert_equal "a***@example.com", TestflightSetup.mask_email("alice@example.com")
    assert_equal "(no email)", TestflightSetup.mask_email("")
    assert_equal "(no email)", TestflightSetup.mask_email(nil)
    assert_equal "x***", TestflightSetup.mask_email("xyz")
    assert_equal "a***@example.com is refused", TestflightSetup.mask_text("alice@example.com is refused")
    assert_equal "a***@example.com", TestflightSetup.mask_text("alice!@example.com") # ! is valid in a local part
    assert_equal "x***@example.com", TestflightSetup.mask_text("x#$%&'*+/=?^_`{|}~-y@example.com")
    assert_equal "t***@a.co and u***@b.org", TestflightSetup.mask_text("t.s@a.co and u+v@b.org")
    assert_equal "refused: (a***@example.com).", TestflightSetup.mask_text("refused: (alice!@example.com).")
  end

  def test_status_prints_groups_kind_automatic_distribution_testers_and_builds
    a = api(
      groups: [team, beta],
      members: { "g-team" => [ALICE, BOB], "g-beta" => [PUBLIC, CAROL, ALICE] },
      builds: [Build.new("b2", "812", "VALID", Train.new("1.4.0")), Build.new("b1", "811", "PROCESSING", Train.new("1.3.0"))],
      build_groups: { "g-beta" => %w[b1 b2], "g-team" => %w[b2] }
    )
    text = TestflightSetup.status_lines(a, APP).join("\n")
    assert_includes text, "App Store Connect Users | internal | automatic distribution: yes | testers: 2"
    assert_includes text, "Public Beta | external | automatic distribution: n/a (external) | testers: 3"
    assert_includes text, "1.4.0 (812) | VALID | groups: App Store Connect Users, Public Beta"
    assert_includes text, "1.3.0 (811) | PROCESSING | groups: Public Beta"
    assert_includes text, "a***@example.com, B***@Example.org" # the internal group's people, masked
    refute_match(/alice|carol|public@/i, text) # no address and no external tester is printed
    assert_empty a.mutations
  end

  def test_status_shows_a_build_that_is_in_no_group
    a = api(groups: [team], builds: [Build.new("b1", "5", "VALID", Train.new("1.0"))])
    assert_includes TestflightSetup.status_lines(a, APP).join("\n"), "1.0 (5) | VALID | groups: none"
  end

  def test_ensure_creates_the_group_and_adds_every_internal_tester_once
    other = Group.new("g-qa", "QA", true, false)
    a = api(groups: [team, other, beta], members: { "g-team" => [ALICE, BOB], "g-qa" => [bob_again = Tester.new("t2b", "bob@example.org"), CAROL], "g-beta" => [PUBLIC] })
    r = TestflightSetup.ensure_internal_group(a, APP, "RN beta")
    assert r[:created]
    assert_equal [[:create_internal_group, "RN beta"]], a.calls.first(1)
    added = a.calls.select { |c| c.first == :add_tester }.map(&:last)
    assert_equal %w[t1 t2 t3], added.sort # Bob once (same address in another case), the external tester never
    refute_includes added, bob_again.id
    refute_includes added, "t9"
    assert_equal 3, r[:added].size
    refute_match(/alice|carol/, r[:lines].join(" "))
  end

  def test_ensure_turns_on_automatic_distribution_and_adds_only_missing_testers
    existing = Group.new("g-rn", "RN beta", true, false)
    a = api(groups: [team, existing], members: { "g-team" => [ALICE, BOB], "g-rn" => [ALICE] })
    r = TestflightSetup.ensure_internal_group(a, APP, "RN beta")
    assert r[:enabled_all_builds]
    refute r[:created]
    assert_equal [[:enable_all_builds, "g-rn"], [:add_tester, "g-rn", "t2"]], a.calls
  end

  def test_ensure_is_idempotent
    a = api(groups: [team], members: { "g-team" => [ALICE, BOB] })
    TestflightSetup.ensure_internal_group(a, APP, "RN beta")
    calls = a.calls.size
    second = TestflightSetup.ensure_internal_group(a, APP, "RN beta")
    assert_equal calls, a.calls.size, "a second run changes nothing"
    assert_includes second[:lines], "Nothing to change."
    refute second[:created]
    assert_empty second[:added]
  end

  def test_ensure_changes_nothing_when_the_group_is_complete
    done = Group.new("g-rn", "RN beta", true, true)
    a = api(groups: [team, done], members: { "g-team" => [ALICE], "g-rn" => [ALICE] })
    r = TestflightSetup.ensure_internal_group(a, APP, "RN beta")
    assert_empty a.calls
    assert_includes r[:lines], "Nothing to change."
  end

  def test_ensure_refuses_an_external_group_of_that_name_and_touches_nothing
    clash = Group.new("g-x", "RN beta", false, nil)
    a = api(groups: [team, clash], members: { "g-team" => [ALICE] })
    assert_raises(TestflightSetup::Refused) { TestflightSetup.ensure_internal_group(a, APP, "RN beta") }
    assert_empty a.calls
  end

  def test_a_group_named_like_an_email_is_masked_on_every_output_path
    named = "alice@example.com"
    status = api(groups: [Group.new("g1", named, true, true)], builds: [Build.new("b1", "1", "VALID", Train.new("1.0"))], build_groups: { "g1" => ["b1"] })
    assert_equal [], TestflightSetup.status_lines(status, APP).grep(/alice/)
    assert_includes TestflightSetup.status_lines(status, APP).join("\n"), "a***@example.com | internal"

    created = TestflightSetup.ensure_internal_group(api(groups: [team], members: { "g-team" => [ALICE] }), APP, named)
    assert_empty created[:lines].grep(/alice/)
    assert_includes created[:lines].first, "a***@example.com"

    existing = Group.new("g2", named, true, false)
    patched = TestflightSetup.ensure_internal_group(api(groups: [existing]), APP, named)
    assert_empty patched[:lines].grep(/alice/)

    clash = api(groups: [Group.new("g3", named, false, nil)])
    error = assert_raises(TestflightSetup::Refused) { TestflightSetup.ensure_internal_group(clash, APP, named) }
    refute_match(/alice/, error.message)
    assert_empty clash.calls
  end

  def test_ensure_skips_a_tester_the_api_refuses_and_says_why_without_the_address
    a = api(
      groups: [team],
      members: { "g-team" => [ALICE, BOB] },
      fail_for: { "t1" => TestflightSetup::TesterRefused.new("alice@example.com is not an App Store Connect user\nsecond line") }
    )
    r = TestflightSetup.ensure_internal_group(a, APP, "RN beta")
    assert_equal ["B***@Example.org"], r[:added]
    assert_equal [["a***@example.com", "a***@example.com is not an App Store Connect user"]], r[:skipped]
    refute_match(/alice@/, r[:lines].join(" "))
  end

  def test_an_api_failure_that_is_not_a_refusal_fails_the_run_instead_of_being_skipped
    a = api(groups: [team], members: { "g-team" => [ALICE, BOB] }, fail_for: { "t1" => RuntimeError.new("connection reset") })
    assert_raises(TestflightSetup::RunFailed) { TestflightSetup.ensure_internal_group(a, APP, "RN beta") }
  end

  def test_only_the_tester_refused_error_is_skipped_by_the_use_case
    assert_kind_of StandardError, TestflightSetup::TesterRefused.new("no")
    a = api(groups: [team], members: { "g-team" => [ALICE] }, fail_for: { "t1" => Timeout::Error.new("slow") })
    error = assert_raises(TestflightSetup::RunFailed) { TestflightSetup.ensure_internal_group(a, APP, "RN beta") }
    assert_includes error.message, "Timeout::Error"
  end

  # Spaceship keeps only the title and detail of an API error; these are the shapes the adapter sees.
  def test_only_a_tester_refusal_text_is_a_refusal_other_api_text_fails_the_run
    [
      "The request cannot be fulfilled because of the state of another resource. - Tester already invited",
      "The provided entity includes a relationship with an invalid value - /data/relationships/betaTesters",
      "The provided entity includes an attribute with an invalid value",
      "Beta tester is not an App Store Connect user"
    ].each { |text| assert TestflightSetup.refusal_text?(text), text }
    [
      "The specified resource does not exist - There is no resource of type 'betaGroups' with id 'x'",
      "Unknown error",
      "Temporary App Store Connect error: {\"statusCode\"=>\"ERROR\"}",
      "Temporary App Store Connect error: {\"statusCode\"=>\"ERROR\", \"detail\"=>\"beta tester service unavailable, state of another resource\"}",
      "  temporary app store connect error: tester",
      "This request is forbidden for security reasons", nil, ""
    ].each { |text| refute TestflightSetup.refusal_text?(text), text.inspect }
  end

  def test_guarded_masks_and_bounds_the_message_of_a_failed_run
    error = assert_raises(TestflightSetup::RunFailed) do
      TestflightSetup.guarded { raise "connection reset by alice!@example.com " + "x" * 2000 }
    end
    assert_includes error.message, "a***@example.com"
    refute_match(/alice/, error.message)
    assert_operator error.message.length, :<, 560
  end

  def test_a_failed_run_names_the_step_it_happened_in
    [
      ["adding a tester", { groups: [team], members: { "g-team" => [ALICE] }, fail_for: { "t1" => RuntimeError.new("boom") } }],
      ["reading the testers of an internal group", nil],
      ["listing the beta groups", nil],
      ["creating the internal group", nil]
    ].each do |step_name, options|
      a = options ? api(**options) : api(groups: [team], members: { "g-team" => [ALICE] })
      case step_name
      when "reading the testers of an internal group" then a.define_singleton_method(:group_testers) { |_g| raise "no read" }
      when "listing the beta groups" then a.define_singleton_method(:groups) { |_app| raise "no list" }
      when "creating the internal group" then a.define_singleton_method(:create_internal_group) { |_app, _n| raise "no create" }
      end
      error = assert_raises(TestflightSetup::RunFailed) { TestflightSetup.ensure_internal_group(a, APP, "RN beta") }
      assert_includes error.message, "while #{step_name}:"
    end
  end

  def test_status_failures_name_their_step
    a = api(groups: [team])
    a.define_singleton_method(:latest_builds) { |_app, _count| raise "builds down" }
    error = assert_raises(TestflightSetup::RunFailed) { TestflightSetup.status_lines(a, APP) }
    assert_includes error.message, "while reading the newest builds: RuntimeError: builds down"
  end

  def test_the_outer_boundary_names_a_step_too_and_a_step_error_is_not_wrapped_twice
    error = assert_raises(TestflightSetup::RunFailed) { TestflightSetup.guarded { raise "x" } }
    assert_includes error.message, "while running the setup:"
    inner = assert_raises(TestflightSetup::RunFailed) { TestflightSetup.guarded { TestflightSetup.step("adding a tester") { raise "x" } } }
    assert_equal 1, inner.message.scan("while ").size
    assert_includes inner.message, "while adding a tester:"
  end

  def test_a_tester_refusal_passes_through_a_step_to_be_skipped
    a = api(groups: [team], members: { "g-team" => [ALICE] }, fail_for: { "t1" => TestflightSetup::TesterRefused.new("no") })
    r = TestflightSetup.ensure_internal_group(a, APP, "RN beta")
    assert_equal 1, r[:skipped].size
  end

  def test_guarded_lets_the_lanes_own_errors_through_unchanged
    assert_raises(TestflightSetup::Refused) { TestflightSetup.guarded { raise TestflightSetup::Refused, "x" } }
    assert_raises(TestflightSetup::InvalidInput) { TestflightSetup.guarded { raise TestflightSetup::InvalidInput, "x" } }
    assert_equal 5, TestflightSetup.guarded { 5 }
  end

  def test_a_failed_run_in_the_use_case_reaches_the_boundary_masked
    a = api(groups: [team], members: { "g-team" => [ALICE] }, fail_for: { "t1" => RuntimeError.new("connection reset by alice@example.com") })
    error = assert_raises(TestflightSetup::RunFailed) do
      TestflightSetup.guarded { TestflightSetup.ensure_internal_group(a, APP, "RN beta") }
    end
    refute_match(/alice@/, error.message)
  end

  def test_inputs_are_validated_before_use_and_never_echoed_in_full
    assert_equal ["status", "RN beta"], TestflightSetup.validate_inputs("status", "")
    assert_equal ["ensure-internal-group", "G"], TestflightSetup.validate_inputs("ensure-internal-group", " G ")
    assert_equal 64, TestflightSetup.validate_inputs("status", "a" * 64).last.length
    error = assert_raises(TestflightSetup::InvalidInput) { TestflightSetup.validate_inputs("status", "a" * 65) }
    assert_includes error.message, "65 characters"
    secret = "SECRET-" + "x" * 5000
    [["bogus", ""], [secret, ""], ["status", secret], ["status", "bad\nname"], ["status", "alice@example.com" + "y" * 80], ["status", "hunter2-" + "z" * 80]].each do |action, group|
      e = assert_raises(TestflightSetup::InvalidInput) { TestflightSetup.validate_inputs(action, group) }
      assert_operator e.message.length, :<, 200
      refute_includes e.message, "x" * 30
      refute_match(/alice@example|hunter2|SECRET|bogus/, e.message) # nothing of the value, not even a prefix
    end
  end

  def test_status_lists_build_uploads_with_their_state_and_what_apple_said
    a = api(groups: [team])
    a.uploads = [
      Upload.new("158", "1.3.0", "IOS", "2026-11-15T20:57:00Z", nil,
                 { "state" => "FAILED", "errors" => [{ "code" => "90683", "description" => "Missing purpose string for alice@example.com" }],
                   "warnings" => [{ "code" => "90078", "description" => "Missing push notification entitlement" }] }),
      Upload.new("105", "1.3.0", "IOS", "2026-11-10T10:00:00Z", nil, { "state" => "COMPLETE" }),
      Upload.new("104", "1.2.0", "IOS", nil, "2026-11-01T10:00:00Z", "COMPLETE")
    ]
    text = TestflightSetup.status_lines(a, APP).join("\n")
    assert_includes text, "Recent build uploads (3):"
    assert_includes text, "1.3.0 (158) | IOS | uploaded 2026-11-15T20:57:00Z | FAILED"
    assert_includes text, "    error: 90683 - Missing purpose string for a***@example.com"
    assert_includes text, "    warning: 90078 - Missing push notification entitlement"
    assert_includes text, "1.3.0 (105) | IOS | uploaded 2026-11-10T10:00:00Z | COMPLETE"
    assert_includes text, "1.2.0 (104) | IOS | uploaded 2026-11-01T10:00:00Z | COMPLETE" # falls back to the created date
    refute_match(/alice/, text)
  end

  def test_a_failed_build_upload_read_does_not_fail_status_and_says_why
    a = api(groups: [team], builds: [Build.new("b1", "5", "VALID", Train.new("1.0"))])
    a.define_singleton_method(:build_uploads) { |_app, _count| raise "endpoint says no" }
    text = TestflightSetup.status_lines(a, APP).join("\n")
    assert_includes text, "Recent build uploads: not available (while reading the build uploads: RuntimeError: endpoint says no)"
    assert_includes text, "1.0 (5) | VALID" # the rest of status is intact
  end

  def test_status_shows_builds_that_are_still_processing_or_were_turned_down
    a = api(groups: [team], builds: [Build.new("b3", "158", "INVALID", Train.new("1.3.0")), Build.new("b2", "157", "PROCESSING", Train.new("1.3.0"))])
    text = TestflightSetup.status_lines(a, APP).join("\n")
    assert_includes text, "1.3.0 (158) | INVALID | groups: none"
    assert_includes text, "1.3.0 (157) | PROCESSING | groups: none"
  end

  def test_the_message_for_a_build_that_never_appears_says_what_it_means_and_where_to_look
    text = TestflightSetup.not_appeared_message("1.4.0", "158", 30, "exceeded 1800 seconds for alice@example.com")
    assert_includes text, "Kanaf RN 1.4.0 (158) was uploaded but did not appear"
    assert_includes text, "within 30 minutes"
    assert_includes text, "action=status"
    assert_includes text, "ITMS"
    refute_match(/alice@/, text)
  end

  def test_status_counts_testers_up_to_a_page
    many = Array.new(TestflightSetup::PAGE) { |i| Tester.new("t#{i}", "p#{i}@example.com") }
    a = api(groups: [beta], members: { "g-beta" => many })
    assert_includes TestflightSetup.status_lines(a, APP).join("\n"), "testers: #{TestflightSetup::PAGE}+"
  end

  def test_status_asks_for_only_as_many_builds_per_group_as_it_prints
    counts = []
    a = api(groups: [team], build_groups: { "g-team" => %w[b1 b2 b3] })
    a.define_singleton_method(:group_builds) do |group, count|
      counts << count
      super(group, count)
    end
    TestflightSetup.status_lines(a, APP, build_count: 2)
    assert_equal [2], counts
  end

  def test_the_real_adapter_can_only_list_create_one_internal_group_enable_and_add
    allowed = %i[groups group_testers group_builds latest_builds build_uploads create_internal_group enable_all_builds add_tester]
    assert_equal allowed.sort, TestflightSetup::ConnectApi.public_instance_methods(false).sort
  end
end
