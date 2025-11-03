const allRoles = {
  superadmin: ['getUsers', 'manageUsers', 'viewAdminDashboard', 'manageSettings', 'viewSettings'],
  admin: ['getUsers', 'manageUsers', 'viewAdminDashboard'],
  agent: [],
  viewer: [],
  user: [],
};

const roles = Object.keys(allRoles);
const roleRights = new Map(Object.entries(allRoles));

module.exports = {
  roles,
  roleRights,
};
