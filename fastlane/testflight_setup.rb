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
  EMAIL = /[\w.+'-]+@[\w.-]+/

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

    def group_testers(group)
      Spaceship::ConnectAPI.get_beta_testers(filter: { betaGroups: group.id }, limit: 200).all_pages.flat_map(&:to_models)
    end

    def group_builds(group)
      group.fetch_builds
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

    def add_tester(group, tester)
      group.add_beta_testers(beta_tester_ids: [tester.id])
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
      lines << "  #{group.name} | #{kind} | automatic distribution: #{automatic} | testers: #{testers.size}"
      # The people of an internal group are the team; an external group can hold thousands, so only its count is printed.
      lines << "    #{testers.map { |t| mask_email(t.email) }.join(', ')}" if group.is_internal_group && !testers.empty?
    end

    names_by_build = Hash.new { |hash, id| hash[id] = [] }
    groups.each { |group| api.group_builds(group).each { |build| names_by_build[build.id] << group.name } }
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
      raise Refused, "'#{group_name}' is an external group; the setup never touches external groups. Pick another name."
    end

    result = { created: false, enabled_all_builds: false, added: [], skipped: [], lines: [] }
    if target.nil?
      target = api.create_internal_group(app, group_name)
      result[:created] = true
      result[:lines] << "Created internal group '#{group_name}' with automatic distribution."
    elsif target.has_access_to_all_builds != true
      api.enable_all_builds(target)
      result[:enabled_all_builds] = true
      result[:lines] << "Turned on automatic distribution for '#{group_name}'."
    else
      result[:lines] << "Internal group '#{group_name}' exists with automatic distribution."
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
