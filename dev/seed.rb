# Seeds a throwaway Redmine with a user, a private project and four assigned
# issues, so the app (and `cargo test live -- --ignored`) has something to talk to.
# Idempotent. Run it through `rails runner`; see README → "Try it against a local Redmine".

Setting.rest_api_enabled = '1'

admin = User.find_by_login('admin')
user = User.find_by_login('alex') ||
       User.new(login: 'alex', firstname: 'Alex', lastname: 'Rivera', mail: 'alex@example.com', language: 'en')
user.password = user.password_confirmation = 'Passw0rd!x1'
user.save!

project = Project.find_by_identifier('atlas') ||
          Project.create!(name: 'Atlas Platform', identifier: 'atlas', is_public: false,
                          tracker_ids: Tracker.pluck(:id), enabled_module_names: %w[issue_tracking time_tracking])

# Stock "Developer" can log time but not edit it; most real setups allow editing your own entries.
role = Role.find_by(name: 'Developer') || Role.givable.first
role.add_permission!(:edit_own_time_entries)
role.save!

member = Member.find_by(user_id: user.id, project_id: project.id) || Member.new(user: user, project: project)
member.roles = [role]
member.save!

if Issue.where(project_id: project.id).empty?
  [
    'Login redirect loops after session timeout',
    'Add CSV export to the invoices list',
    'Upgrade Rails to 7.1',
    'Investigate slow dashboard query',
  ].each do |subject|
    Issue.new(project: project, tracker: project.trackers.first, subject: subject, author: admin,
              status: IssueStatus.sorted.first, priority: IssuePriority.default, assigned_to: user).save!
  end
end

puts "API key for alex: #{user.api_key}"
