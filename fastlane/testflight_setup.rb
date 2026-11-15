# TestFlight setup (TFSETUP): look at, and set up, the TestFlight beta groups of the app with the App Store Connect API key.
# Used by `bundle exec fastlane ios testflight_setup action:status|ensure-internal-group group:"RN beta"` (Fastfile), run from
# the manual "TestFlight setup" workflow. The logic lives here, apart from the lane, so it is tested with fakes
# (fastlane/test/testflight_setup_test.rb): the real API only runs with the key.
#
# Hard limits, kept by what the API adapter can do at all: it lists, creates ONE internal group, turns on automatic
# distribution of that group and adds testers to it. It cannot upload, delete, touch an external group, submit for Beta
# App Review or change a build. Emails are masked in every line printed; the key is never read here.
module TestflightSetup
  DEFAULT_GROUP = "RN beta".freeze
  ACTIONS = %w[status ensure-internal-group].freeze
  # Any run of address characters before an @ (RFC 5322 allows ! # $ % & * / = ? ^ ` { | } ~ too), up to the domain.
  EMAIL = /[^\s@<>()\[\]",;:\\]+@[\w.-]+/

  GROUP_NAME_MAX = 64
  PAGE = 200 # testers read per group; more than this is shown as "200+"

  # The inputs are user typed: bounded, printable, and never echoed.
  class InvalidInput < StandardError; end

  # The API turned a tester down (a person who is not an App Store Connect user, already invited, ...): skip and say why.
  # Anything else (no network, a bad key, a server error, rate limit) is a failed run, never a skipped tester.
  class TesterRefused < StandardError; end

  # The run failed (an API error, a bad key, no network): the message is masked and bounded before Fastlane prints it.
  class RunFailed < StandardError; end

  # What Spaceship keeps of an API error is only the title and detail text (no status), so the adapter recognises a refusal by
  # that text: the API's "state of another resource" (409) and "invalid relationship/attribute value" (entity) answers, or a
  # message that names the tester. A missing group or build (404), "Unknown error", a temporary server error and every other
  # error are failures of the run, so a deleted group or a systematic fault cannot print as success.
  REFUSAL_TEXT = /state of another resource|relationship with an invalid value|attribute with an invalid value|\btester\b/i

  def self.refusal_text?(message)
    message.to_s.match?(REFUSAL_TEXT)
  end

  # Runs the block; any error that escapes is re-raised as RunFailed with its text masked and cut to 500 characters.
  def self.guarded
    yield
  rescue Refused, InvalidInput, RunFailed
    raise
  rescue StandardError => e
    raise RunFailed, "#{e.class}: #{mask_text(e.message)[0, 500]}"
  end

  # Returns [action, group]. A bad value is reported by its type and length only.
  def self.validate_inputs(action, group)
    action = action.to_s
    raise InvalidInput, "action must be one of #{ACTIONS.join(', ')}, got #{brief(action)}" unless ACTIONS.include?(action)

    group = group.to_s.strip
    group = DEFAULT_GROUP if group.empty?
    if group.length > GROUP_NAME_MAX || group.match?(/[[:cntrl:]]/)
      raise InvalidInput, "group must be 1 to #{GROUP_NAME_MAX} printable characters, got #{brief(group)}"
    end

    [action, group]
  end

  # A rejected input is reported by its type and length only: it may be a secret or an address, so none of it is echoed.
  def self.brief(value)
    "#{value.class} of #{value.to_s.length} characters"
  end

  # An external group has the requested name: it is not ours to reuse or change.
  class Refused < StandardError; end

  # "j***@example.com": the first letter and the domain.
  def self.mask_email(email)
    local, domain = email.to_s.split("@", 2)
    return "(no email)" if local.to_s.empty?

    domain ? "#{local[0]}***@#{domain}" : "#{local[0]}***"
  end

  # Error text from the API can quote an email: mask any in it.
  def self.mask_text(text)
    text.to_s.gsub(EMAIL) { |match| mask_email(match) }
  end

  def self.yes_no(value)
    value ? "yes" : "no"
  end

  # The real API (Spaceship::ConnectAPI, token already set). The ONLY calls the setup makes; see the limits above.
  class ConnectApi
    def groups(app)
      app.get_beta_groups
    end

    # One page only (PAGE): a count of PAGE means "PAGE or more". ensure-internal-group needs the whole internal group, which
    # is the team (a handful of people), so it uses the same page.
    def group_testers(group)
      Spaceship::ConnectAPI.get_beta_testers(filter: { betaGroups: group.id }, limit: PAGE).to_models
    end

    # The newest builds of the group, as many as status prints: never the whole history.
    def group_builds(group, count)
      Spaceship::ConnectAPI.get_builds(filter: { betaGroups: group.id }, sort: "-uploadedDate", limit: count).to_models
    end

    def latest_builds(app, count)
      Spaceship::ConnectAPI.get_builds(
        filter: { app: app.id }, includes: "preReleaseVersion", sort: "-uploadedDate", limit: count
      ).to_models.first(count)
    end

    def create_internal_group(app, name)
      Spaceship::ConnectAPI.create_beta_group(
        app_id: app.id, group_name: name, is_internal_group: true, has_access_to_all_builds: true
      ).to_models.first
    end

    def enable_all_builds(group)
      group.update(attributes: { has_access_to_all_builds: true })
    end

    # An API answer that turns the tester down becomes TesterRefused (the use case skips them); every other error propagates.
    def add_tester(group, tester)
      group.add_beta_testers(beta_tester_ids: [tester.id])
    rescue Spaceship::UnexpectedResponse => e
      raise e unless TestflightSetup.refusal_text?(e.message)

      raise TesterRefused, e.message
    end
  end

  # Every beta group (name, kind, automatic distribution, testers) and the newest builds (version, build, state, groups).
  def self.status_lines(api, app, build_count: 10)
    groups = api.groups(app)
    lines = ["Beta groups (#{groups.size}):"]
    groups.each do |group|
      testers = api.group_testers(group)
      kind = group.is_internal_group ? "internal" : "external"
      automatic = group.is_internal_group ? yes_no(group.has_access_to_all_builds) : "n/a (external)"
      count = testers.size >= PAGE ? "#{PAGE}+" : testers.size.to_s
      lines << "  #{mask_text(group.name)} | #{kind} | automatic distribution: #{automatic} | testers: #{count}"
      # The people of an internal group are the team; an external group can hold thousands, so only its count is printed.
      lines << "    #{testers.map { |t| mask_email(t.email) }.join(', ')}" if group.is_internal_group && !testers.empty?
    end

    names_by_build = Hash.new { |hash, id| hash[id] = [] }
    groups.each { |group| api.group_builds(group, build_count).each { |build| names_by_build[build.id] << mask_text(group.name) } }
    builds = api.latest_builds(app, build_count)
    lines << "Newest builds (#{builds.size}):"
    builds.each do |build|
      train = build.respond_to?(:pre_release_version) && build.pre_release_version ? build.pre_release_version.version : "?"
      names = names_by_build[build.id]
      lines << "  #{train} (#{build.version}) | #{build.processing_state} | groups: #{names.empty? ? 'none' : names.join(', ')}"
    end
    lines
  end

  # Idempotent. Returns { created:, enabled_all_builds:, added: [emails], skipped: [[email, reason]], lines: [...] }.
  def self.ensure_internal_group(api, app, group_name)
    groups = api.groups(app)
    same_name = groups.select { |g| g.name == group_name }
    target = same_name.find(&:is_internal_group)
    if target.nil? && !same_name.empty?
      raise Refused, "'#{mask_text(group_name)}' is an external group; the setup never touches external groups. Pick another name."
    end

    result = { created: false, enabled_all_builds: false, added: [], skipped: [], lines: [] }
    if target.nil?
      target = api.create_internal_group(app, group_name)
      result[:created] = true
      result[:lines] << "Created internal group '#{mask_text(group_name)}' with automatic distribution."
    elsif target.has_access_to_all_builds != true
      api.enable_all_builds(target)
      result[:enabled_all_builds] = true
      result[:lines] << "Turned on automatic distribution for '#{mask_text(group_name)}'."
    else
      result[:lines] << "Internal group '#{mask_text(group_name)}' exists with automatic distribution."
    end

    present = result[:created] ? [] : api.group_testers(target).map { |t| t.email.to_s.downcase }
    others = groups.select { |g| g.is_internal_group && g.id != target.id }
    candidates = others.flat_map { |g| api.group_testers(g) }
    candidates = candidates.reject { |t| t.email.to_s.empty? }.uniq { |t| t.email.downcase }
    candidates.reject { |t| present.include?(t.email.downcase) }.each do |tester|
      api.add_tester(target, tester)
      result[:added] << mask_email(tester.email)
      result[:lines] << "Added #{mask_email(tester.email)}."
    rescue StandardError => e
      raise unless e.is_a?(TesterRefused) # a failed run, not a refused tester

      reason = mask_text(e.message).lines.first.to_s.strip[0, 200]
      result[:skipped] << [mask_email(tester.email), reason]
      result[:lines] << "Skipped #{mask_email(tester.email)}: #{reason}"
    end

    if result[:added].empty? && result[:skipped].empty? && !result[:created] && !result[:enabled_all_builds]
      result[:lines] << "Nothing to change."
    end
    result
  end
end
