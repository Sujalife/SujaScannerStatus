// Job titles are presentation only. Authorization and audit values keep their stored roles.
export function publicRoleName(roleId, name = '') {
  if (roleId === 'master' || (!roleId && name === 'Master')) return 'NetSuite Operator';
  return name || roleId || '';
}
