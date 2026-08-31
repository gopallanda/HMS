/**
 * Permissions.
 *
 * A permission is a fact about the CODE: it names a thing this application can
 * do. A role is a fact about the HOSPITAL: it names a job somebody holds. The
 * two live in different places on purpose.
 *
 * Keys are a frozen union here, not rows in a table. Seeding them into Postgres
 * would mean shipping a migration every time a screen is added and -- worse --
 * it would let an administrator tick a permission that nothing in the code
 * enforces, which reads as access granted and behaves as access denied.
 *
 * Roles, and the permissions attached to them, ARE data: public.roles and
 * public.role_permissions, per hospital, editable in /admin/roles without a
 * deploy.
 *
 * Adding a permission is three edits: the key here, a GROUP below so it appears
 * in the role editor, and a grant in public.seed_system_roles()
 * (20260828090000) for whichever system roles need it.
 */

export const PERMISSIONS = [
  'patients.read', 'patients.create', 'patients.update',
  'visits.create', 'visits.read',
  'queue.read', 'queue.manage',
  'consultation.read', 'consultation.write',
  'prescription.create',
  'billing.read', 'billing.collect', 'billing.void', 'billing.defer',
  'pharmacy.read', 'pharmacy.dispense', 'pharmacy.stock_adjust',
  'lab.read', 'lab.result_entry',
  'staff.read', 'staff.create', 'staff.update', 'staff.deactivate',
  'accounts.provision', 'accounts.reset_password',
  'roster.read', 'roster.write',
  'roles.manage', 'departments.manage',
  'settings.manage', 'reports.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

/**
 * Whether a string stored in role_permissions still names a real permission.
 *
 * role_permissions.permission_key is plain text with no foreign key, because
 * the authority is this file rather than a table. That makes this check the
 * place a key removed from the union stops having an effect: unknown keys are
 * dropped when a permission set is loaded, not silently honoured.
 */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * How the role editor groups the checkboxes. Order is the order on screen: the
 * desks people actually sit at first, administration last.
 */
export const PERMISSION_GROUPS: readonly {
  key: string;
  label: string;
  description: string;
  permissions: readonly Permission[];
}[] = [
  {
    key: 'patients',
    label: 'Patients and visits',
    description: 'The front desk: who is on file, and who is here today.',
    permissions: [
      'patients.read', 'patients.create', 'patients.update',
      'visits.create', 'visits.read',
      'queue.read', 'queue.manage',
    ],
  },
  {
    key: 'clinical',
    label: 'Clinical',
    description: 'Consultation notes, vitals and prescriptions.',
    permissions: ['consultation.read', 'consultation.write', 'prescription.create'],
  },
  {
    key: 'billing',
    label: 'Billing',
    description: 'Money. billing.void and billing.defer are the two that need thought.',
    permissions: ['billing.read', 'billing.collect', 'billing.void', 'billing.defer'],
  },
  {
    key: 'pharmacy',
    label: 'Pharmacy',
    description: 'Phase 2. Listed now so a role does not need re-editing later.',
    permissions: ['pharmacy.read', 'pharmacy.dispense', 'pharmacy.stock_adjust'],
  },
  {
    key: 'lab',
    label: 'Laboratory',
    description: 'Phase 2. Listed now so a role does not need re-editing later.',
    permissions: ['lab.read', 'lab.result_entry'],
  },
  {
    key: 'staff',
    label: 'Staff and rosters',
    description: 'People records, logins, and who worked which day.',
    permissions: [
      'staff.read', 'staff.create', 'staff.update', 'staff.deactivate',
      'accounts.provision', 'accounts.reset_password',
      'roster.read', 'roster.write',
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    description: 'Configuration. roles.manage lets a role edit the roles, including its own.',
    permissions: ['roles.manage', 'departments.manage', 'settings.manage', 'reports.view'],
  },
];

/**
 * What each key means, in one line, shown beside its checkbox.
 *
 * Read by somebody deciding whether a receptionist should hold it, so each one
 * says what the holder can DO rather than what the code calls it.
 */
export const PERMISSION_LABEL: Record<Permission, string> = {
  'patients.read': 'Look patients up and open their record',
  'patients.create': 'Register a new patient',
  'patients.update': 'Correct patient details',
  'visits.create': 'Start a visit and put someone in the queue',
  'visits.read': 'See visits',
  'queue.read': 'See the queue for today',
  'queue.manage': 'Reorder, transfer and cancel queue entries',
  'consultation.read': 'Read consultation notes and vitals',
  'consultation.write': 'Record consultation notes and vitals',
  'prescription.create': 'Write a prescription',
  'billing.read': 'See invoices, payments and balances',
  'billing.collect': 'Raise an invoice and take a payment',
  'billing.void': 'Void an invoice, with a reason',
  'billing.defer': 'Let a patient be seen before paying',
  'pharmacy.read': 'See stock and dispensing history',
  'pharmacy.dispense': 'Dispense against a prescription',
  'pharmacy.stock_adjust': 'Adjust stock and record purchases',
  'lab.read': 'See test orders and results',
  'lab.result_entry': 'Enter and upload results',
  'staff.read': 'See the staff list',
  'staff.create': 'Add a staff record',
  'staff.update': 'Edit a staff record',
  'staff.deactivate': 'Deactivate a staff record',
  'accounts.provision': 'Issue a username and password to staff',
  'accounts.reset_password': 'Reset a staff password',
  'roster.read': 'See the shift roster',
  'roster.write': 'Record and edit shifts',
  'roles.manage': 'Create roles and change what they may do',
  'departments.manage': 'Create and edit departments',
  'settings.manage': 'Change hospital settings, branding and printing',
  'reports.view': 'Open reports and the day close',
};

/** A set of permissions, as carried on a session. */
export type PermissionSet = ReadonlySet<Permission>;

export function can(held: PermissionSet, permission: Permission): boolean {
  return held.has(permission);
}

export function canAny(held: PermissionSet, ...permissions: Permission[]): boolean {
  return permissions.some((permission) => held.has(permission));
}

/** Keeps only the strings that still name a real permission. */
export function toPermissionSet(keys: readonly string[]): PermissionSet {
  return new Set(keys.filter(isPermission));
}
