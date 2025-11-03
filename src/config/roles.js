const allRoles = {
  admin: ['getUsers', 'manageUsers'],
  agent: [],
  viewer: [],
};

const roles = Object.keys(allRoles);
const roleRights = new Map(Object.entries(allRoles));

module.exports = {
  roles,
  roleRights,
};
