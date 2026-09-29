export const ROLE_EMAILS = Object.freeze({
  "ms4055028@gmail.com": "viewer",
  "juhi.batra25@gmail.com": "operations"
});

export const ROLE_LABELS = Object.freeze({
  operations: "Operations Manager",
  viewer: "Response Viewer"
});

export const ROLE_DESCRIPTIONS = Object.freeze({
  operations: "Operational control",
  viewer: "Monitoring & response"
});

export const ROLE_PERMISSIONS = Object.freeze({
  operations: Object.freeze({
    canViewDashboard: true,
    canUpdateStock: true,
    canUpdateBeds: true,
    canUpdateAttendance: true,
    canManageDistricts: true,
    canGenerateTransferPlan: true,
    canReviewTransfers: true,
    canApproveTransfers: true,
    canRaiseTransferRequest: true
  }),
  viewer: Object.freeze({
    canViewDashboard: true,
    canUpdateStock: false,
    canUpdateBeds: false,
    canUpdateAttendance: false,
    canManageDistricts: false,
    canGenerateTransferPlan: false,
    canReviewTransfers: true,
    canApproveTransfers: false,
    canRaiseTransferRequest: true
  })
});

const READ_ONLY_PERMISSIONS = Object.freeze({
  canViewDashboard: true,
  canUpdateStock: false,
  canUpdateBeds: false,
  canUpdateAttendance: false,
  canManageDistricts: false,
  canGenerateTransferPlan: false,
  canReviewTransfers: false,
  canApproveTransfers: false,
  canRaiseTransferRequest: false
});

export function getRoleForEmail(email) {
  return ROLE_EMAILS[String(email || "").trim().toLowerCase()] || null;
}

export function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || READ_ONLY_PERMISSIONS;
}