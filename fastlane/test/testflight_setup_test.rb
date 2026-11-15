# ruby fastlane/test/testflight_setup_test.rb   (minitest only; no Spaceship, no key). The Spaceship call names are checked by
# spaceship_names_check.rb under `bundle exec`.
# The setup logic against fake groups, testers and builds: what it creates, patches and adds, and what it must never do.
require "minitest/autorun"
require_relative "../testflight_setup"

Group = Struct.new(:id, :name, :is_internal_group, :has_access_to_all_builds)
Tester = Struct.new(:id, :email)
Build = Struct.new(:id, :version, :processing_state, :pre_release_version)
Train = Struct.new(:version)
App = Struct.new(:id)

# Records every call. `fail_for` makes add_tester refuse those tester ids.
class FakeApi
  attr_reader :calls, :groups_list
  attr_writer :builds

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
  def group_builds(group) = (@build_groups[group.id] || []).map { |id| Build.new(id) }
  def latest_builds(_app, count) = @builds.first(count)

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
    raise @fail_for[tester.id] if @fail_for.key?(tester.id)

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
      fail_for: { "t1" => "alice@example.com is not an App Store Connect user\nsecond line" }
    )
    r = TestflightSetup.ensure_internal_group(a, APP, "RN beta")
    assert_equal ["B***@Example.org"], r[:added]
    assert_equal [["a***@example.com", "a***@example.com is not an App Store Connect user"]], r[:skipped]
    refute_match(/alice@/, r[:lines].join(" "))
  end

  def test_the_real_adapter_can_only_list_create_one_internal_group_enable_and_add
    allowed = %i[groups group_testers group_builds latest_builds create_internal_group enable_all_builds add_tester]
    assert_equal allowed.sort, TestflightSetup::ConnectApi.public_instance_methods(false).sort
  end
end
