/**
 * Supabase schema types.
 *
 * HAND-WRITTEN, and verified column-for-column against the hosted project on
 * 2026-08-20, after 20260819090100 was applied: every table, view, column and
 * enum label below exists in the database with the same name.
 *
 * `consultations`, `current_staff_id` and `save_consultation` were added from
 * 20260820120000_consultations.sql and checked the same way, against the live
 * schema after that migration was pushed.
 *
 * The hospitals lifecycle columns (plan, status, trial_ends_at, suspended_at,
 * suspension_reason) and their two enums come from
 * 20260825140000_hospital_lifecycle.sql.
 *
 * Phase 1 remediation, 2026-08-28: hospitals.slug, the new staff columns
 * (role_id, can_login, employee_code, employment_type) and the five new tables
 * -- roles, role_permissions, staff_shifts, staff_accounts,
 * password_reset_tokens -- were written from migrations 20260828090000,
 * 090100 and 090200 after all three were pushed successfully.
 *
 * services.unit, the service_unit enum and seed_starter_services come from
 * 20260901090000_service_units_and_starter_catalogue.sql.
 *
 * EmploymentType and ShiftStatus are unions over CHECK constraints rather than
 * Postgres enums, so they are absent from Enums below on purpose: generated
 * output would type those columns as plain `string`, and narrowing them here
 * is the one place a hand-written file is better than the generator.
 *
 * It is still not generated output, so replace it with the real thing as soon
 * as a personal access token is available (CLAUDE.md 9, step 4):
 *
 *   npm run db:types
 *
 * That goes through the Management API and needs SUPABASE_ACCESS_TOKEN in
 * .env.local -- see .env.example. It deliberately does NOT use
 * SUPABASE_DB_URL: the CLI serves --db-url out of a Docker container, and
 * this project has no Docker (CLAUDE.md 2).
 *
 * Do not hand-edit once generated.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AppRole =
  | 'super_admin'
  | 'admin'
  | 'doctor'
  | 'front_desk'
  | 'cashier'
  | 'pharmacist'
  | 'lab_tech'
  | 'nurse';

export type NumberKey = 'invoice' | 'mrn' | 'visit' | 'token';

export type AuditAction = 'insert' | 'update' | 'delete';

export type Gender = 'male' | 'female' | 'other';

export type VisitType = 'opd' | 'ipd' | 'emergency';

export type VisitStatus = 'waiting' | 'in_consultation' | 'completed' | 'cancelled';

export type ServiceCategory =
  | 'consultation'
  | 'lab'
  | 'procedure'
  | 'bed'
  | 'pharmacy'
  | 'other';

export type ServiceUnit =
  | 'each'
  | 'per_day'
  | 'per_test'
  | 'per_session'
  | 'per_hour';

export type ChargeStatus = 'pending' | 'invoiced' | 'cancelled';

export type ChargeSource =
  | 'front_desk'
  | 'doctor'
  | 'lab'
  | 'pharmacy'
  | 'ipd'
  | 'billing';

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void';

export type PaymentMode = 'cash' | 'upi' | 'card' | 'other';

/** staff.employment_type -- a text check constraint, not a Postgres enum. */
export type EmploymentType = 'full_time' | 'part_time' | 'contract';

/** staff_shifts.status -- a text check constraint, not a Postgres enum. */
export type ShiftStatus =
  | 'scheduled'
  | 'present'
  | 'absent'
  | 'day_off'
  | 'leave';

export type HospitalPlan = 'trial' | 'standard';

export type HospitalStatus = 'active' | 'suspended';

export type Database = {
  public: {
    Tables: {
      hospitals: {
        Row: {
          id: string;
          name: string;
          logo_url: string | null;
          address: string | null;
          phone: string | null;
          gstin: string | null;
          settings: Json;
          created_at: string;
          /** Immutable tenant handle; part of every synthetic login address. */
          slug: string;
          plan: HospitalPlan;
          status: HospitalStatus;
          trial_ends_at: string | null;
          suspended_at: string | null;
          suspension_reason: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          logo_url?: string | null;
          address?: string | null;
          phone?: string | null;
          gstin?: string | null;
          settings?: Json;
          created_at?: string;
          slug?: string;
          plan?: HospitalPlan;
          status?: HospitalStatus;
          trial_ends_at?: string | null;
          suspended_at?: string | null;
          suspension_reason?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          logo_url?: string | null;
          address?: string | null;
          phone?: string | null;
          gstin?: string | null;
          settings?: Json;
          created_at?: string;
          slug?: string;
          plan?: HospitalPlan;
          status?: HospitalStatus;
          trial_ends_at?: string | null;
          suspended_at?: string | null;
          suspension_reason?: string | null;
        };
        Relationships: [];
      };
      memberships: {
        Row: {
          id: string;
          user_id: string;
          hospital_id: string;
          role: AppRole;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          hospital_id: string;
          role: AppRole;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          hospital_id?: string;
          role?: AppRole;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      departments: {
        Row: {
          id: string;
          hospital_id: string;
          name: string;
          code: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          hospital_id: string;
          name: string;
          code: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          name?: string;
          code?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * What a person DOES, and therefore what they may open.
       * Independent of department (20260828090000).
       */
      roles: {
        Row: {
          id: string;
          hospital_id: string;
          code: string;
          name: string;
          description: string | null;
          is_system: boolean;
          can_login: boolean;
          /** Bridge to public.app_role. Grants nothing. Removed in block 3. */
          legacy_role: AppRole;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          hospital_id: string;
          code: string;
          name: string;
          description?: string | null;
          is_system?: boolean;
          can_login?: boolean;
          legacy_role?: AppRole;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          code?: string;
          name?: string;
          description?: string | null;
          is_system?: boolean;
          can_login?: boolean;
          legacy_role?: AppRole;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      /**
       * permission_key is plain text on purpose: the list of permissions is a
       * fact about the code (lib/rbac/permissions.ts), not a table.
       */
      role_permissions: {
        Row: {
          id: string;
          hospital_id: string;
          role_id: string;
          permission_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          hospital_id: string;
          role_id: string;
          permission_key: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          role_id?: string;
          permission_key?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      staff: {
        Row: {
          id: string;
          hospital_id: string;
          user_id: string | null;
          full_name: string;
          /** DERIVED from role_id by trigger. Do not write it directly. */
          role: AppRole;
          role_id: string;
          department_id: string | null;
          phone: string | null;
          reg_no: string | null;
          consultation_fee: number;
          is_active: boolean;
          /** null = follow the role. false = denied credentials. Never true. */
          can_login: boolean | null;
          employee_code: string | null;
          employment_type: EmploymentType;
          created_at: string;
        };
        Insert: {
          id?: string;
          hospital_id: string;
          user_id?: string | null;
          full_name: string;
          role?: AppRole;
          role_id: string;
          department_id?: string | null;
          phone?: string | null;
          reg_no?: string | null;
          consultation_fee?: number;
          is_active?: boolean;
          can_login?: boolean | null;
          employee_code?: string | null;
          employment_type?: EmploymentType;
          created_at?: string;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          user_id?: string | null;
          full_name?: string;
          role?: AppRole;
          role_id?: string;
          department_id?: string | null;
          phone?: string | null;
          reg_no?: string | null;
          consultation_fee?: number;
          is_active?: boolean;
          can_login?: boolean | null;
          employee_code?: string | null;
          employment_type?: EmploymentType;
          created_at?: string;
        };
        Relationships: [];
      };
      /** The roster. One row per staff member per day (20260828090100). */
      staff_shifts: {
        Row: {
          id: string;
          hospital_id: string;
          staff_id: string;
          work_date: string;
          status: ShiftStatus;
          start_time: string | null;
          end_time: string | null;
          hours: number | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          hospital_id: string;
          staff_id: string;
          work_date: string;
          status?: ShiftStatus;
          start_time?: string | null;
          end_time?: string | null;
          hours?: number | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          staff_id?: string;
          work_date?: string;
          status?: ShiftStatus;
          start_time?: string | null;
          end_time?: string | null;
          hours?: number | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * One row per staff login. Written only by the provisioning server
       * action, through the service role (20260828090200).
       */
      staff_accounts: {
        Row: {
          id: string;
          hospital_id: string;
          staff_id: string;
          auth_user_id: string | null;
          login_email: string;
          contact_email: string;
          username: string;
          role_id: string;
          temp_password_issued_at: string | null;
          must_change_password: boolean;
          failed_sign_ins: number;
          first_failed_at: string | null;
          locked_until: string | null;
          last_login_at: string | null;
          created_at: string;
          created_by: string | null;
          disabled_at: string | null;
        };
        Insert: {
          id?: string;
          hospital_id: string;
          staff_id: string;
          auth_user_id?: string | null;
          login_email: string;
          contact_email: string;
          username: string;
          role_id: string;
          temp_password_issued_at?: string | null;
          must_change_password?: boolean;
          failed_sign_ins?: number;
          first_failed_at?: string | null;
          locked_until?: string | null;
          last_login_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          disabled_at?: string | null;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          staff_id?: string;
          auth_user_id?: string | null;
          login_email?: string;
          contact_email?: string;
          username?: string;
          role_id?: string;
          temp_password_issued_at?: string | null;
          must_change_password?: boolean;
          failed_sign_ins?: number;
          first_failed_at?: string | null;
          locked_until?: string | null;
          last_login_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          disabled_at?: string | null;
        };
        Relationships: [];
      };
      /**
       * Service role only. RLS is on with no policies and anon/authenticated
       * hold no grants, so this type is reachable only from the admin client.
       */
      password_reset_tokens: {
        Row: {
          id: string;
          hospital_id: string;
          account_id: string;
          token_hash: string;
          expires_at: string;
          used_at: string | null;
          requested_ip: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          hospital_id: string;
          account_id: string;
          token_hash: string;
          expires_at: string;
          used_at?: string | null;
          requested_ip?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          account_id?: string;
          token_hash?: string;
          expires_at?: string;
          used_at?: string | null;
          requested_ip?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      patients: {
        Row: {
          id: string;
          hospital_id: string;
          mrn: string;
          full_name: string;
          dob: string;
          gender: Gender;
          phone: string | null;
          address: string | null;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
        };
        // Inserts go through register_patient(); there is no insert policy on
        // this table. The shape is here because the generated file will have
        // it, not because app code should use it.
        Insert: {
          id?: string;
          hospital_id: string;
          mrn: string;
          full_name: string;
          dob: string;
          gender: Gender;
          phone?: string | null;
          address?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          mrn?: string;
          full_name?: string;
          dob?: string;
          gender?: Gender;
          phone?: string | null;
          address?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      services: {
        Row: {
          id: string;
          hospital_id: string;
          name: string;
          category: ServiceCategory;
          unit: ServiceUnit;
          price: number;
          tax_rate: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          hospital_id: string;
          name: string;
          category: ServiceCategory;
          unit?: ServiceUnit;
          price?: number;
          tax_rate?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          name?: string;
          category?: ServiceCategory;
          unit?: ServiceUnit;
          price?: number;
          tax_rate?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      visits: {
        Row: {
          id: string;
          hospital_id: string;
          patient_id: string;
          visit_no: string;
          token_no: number;
          visit_type: VisitType;
          doctor_id: string | null;
          department_id: string | null;
          status: VisitStatus;
          visited_at: string;
          created_by: string | null;
        };
        // Rows are created by create_visit() only. Status updates are the one
        // direct write the policies allow.
        Insert: {
          id?: string;
          hospital_id: string;
          patient_id: string;
          visit_no: string;
          token_no: number;
          visit_type?: VisitType;
          doctor_id?: string | null;
          department_id?: string | null;
          status?: VisitStatus;
          visited_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          patient_id?: string;
          visit_no?: string;
          token_no?: number;
          visit_type?: VisitType;
          doctor_id?: string | null;
          department_id?: string | null;
          status?: VisitStatus;
          visited_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      charge_items: {
        Row: {
          id: string;
          hospital_id: string;
          visit_id: string;
          service_id: string | null;
          description: string;
          qty: number;
          unit_price: number;
          amount: number;
          tax_rate: number;
          source_module: ChargeSource;
          invoice_id: string | null;
          status: ChargeStatus;
          created_by: string | null;
          created_at: string;
        };
        // No insert or update policy exists: money tables are written by RPCs
        // in a single transaction (CLAUDE.md 3.2).
        Insert: never;
        Update: never;
        Relationships: [];
      };
      consultations: {
        Row: {
          id: string;
          hospital_id: string;
          visit_id: string;
          patient_id: string;
          doctor_id: string | null;
          bp_systolic: number | null;
          bp_diastolic: number | null;
          pulse: number | null;
          /** Degrees Fahrenheit -- the unit on an Indian OPD chart. */
          temperature_f: number | null;
          weight_kg: number | null;
          spo2: number | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_by: string | null;
          updated_at: string;
        };
        // Same arrangement as the money tables: the only writer is
        // save_consultation, so there is no insert or update policy to type.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      number_series: {
        Row: {
          hospital_id: string;
          key: NumberKey;
          fy: string;
          current_value: number;
        };
        Insert: {
          hospital_id: string;
          key: NumberKey;
          fy: string;
          current_value?: number;
        };
        Update: {
          hospital_id?: string;
          key?: NumberKey;
          fy?: string;
          current_value?: number;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          hospital_id: string;
          table_name: string;
          record_id: string;
          action: AuditAction;
          actor_id: string | null;
          before: Json | null;
          after: Json | null;
          at: string;
        };
        Insert: {
          id?: string;
          hospital_id: string;
          table_name: string;
          record_id: string;
          action: AuditAction;
          actor_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          at?: string;
        };
        Update: never;
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          hospital_id: string;
          invoice_no: string;
          fy: string;
          visit_id: string;
          patient_id: string;
          patient_name_snapshot: string;
          invoice_date: string;
          subtotal: number;
          tax_total: number;
          grand_total: number;
          status: InvoiceStatus;
          void_reason: string | null;
          created_by: string | null;
        };
        // collect_payment is the only path that creates an invoice, and
        // void_invoice the only one that changes it (CLAUDE.md 3.2). There is
        // no insert or update policy, so these are unreachable by design.
        Insert: never;
        Update: never;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          hospital_id: string;
          invoice_id: string;
          amount: number;
          mode: PaymentMode;
          reference: string | null;
          collected_by: string;
          paid_at: string;
          is_reversed: boolean;
          reversal_reason: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      /** Read model behind the queue screen. security_invoker, so RLS applies. */
      visit_queue: {
        Row: {
          id: string;
          hospital_id: string;
          visit_no: string;
          token_no: number;
          visit_type: VisitType;
          status: VisitStatus;
          visited_at: string;
          visit_date: string;
          patient_id: string;
          patient_mrn: string;
          patient_name: string;
          patient_dob: string;
          patient_gender: Gender;
          patient_phone: string | null;
          doctor_id: string | null;
          doctor_name: string | null;
          department_id: string | null;
          department_name: string | null;
          charge_total: number;
          /** Whether an invoice on this visit is still unpaid or part paid. */
          payment_due: boolean;
          /** Why the patient was let through without paying, when they were. */
          defer_reason: string | null;
          created_by: string | null;
        };
        Relationships: [];
      };
      /** Visits with no doctor, still open. The repair list. security_invoker. */
      incomplete_visits: {
        Row: {
          id: string;
          hospital_id: string;
          visit_no: string;
          token_no: number;
          status: VisitStatus;
          visited_at: string;
          visit_date: string;
          patient_id: string;
          patient_mrn: string;
          patient_name: string;
          patient_dob: string;
          patient_gender: Gender;
          patient_phone: string | null;
          department_name: string | null;
          payment_due: boolean;
        };
        Relationships: [];
      };
      /** Read model behind the collect-payment screen. security_invoker. */
      visit_billing: {
        Row: {
          visit_id: string;
          hospital_id: string;
          visit_no: string;
          token_no: number;
          visit_type: VisitType;
          visit_status: VisitStatus;
          visited_at: string;
          visit_date: string;
          patient_id: string;
          patient_mrn: string;
          patient_name: string;
          patient_dob: string;
          patient_gender: Gender;
          patient_phone: string | null;
          doctor_id: string | null;
          doctor_name: string | null;
          department_id: string | null;
          department_name: string | null;
          pending_count: number;
          pending_total: number;
          invoiced_total: number;
          invoice_count: number;
        };
        Relationships: [];
      };
      /** Invoice with patient, visit and money collected. security_invoker. */
      invoice_summary: {
        Row: {
          id: string;
          hospital_id: string;
          invoice_no: string;
          fy: string;
          invoice_date: string;
          invoice_day: string;
          status: InvoiceStatus;
          void_reason: string | null;
          subtotal: number;
          tax_total: number;
          grand_total: number;
          patient_id: string;
          patient_name_snapshot: string;
          patient_mrn: string;
          patient_name: string;
          patient_phone: string | null;
          visit_id: string;
          visit_no: string;
          token_no: number;
          doctor_id: string | null;
          doctor_name: string | null;
          department_id: string | null;
          department_name: string | null;
          paid_total: number;
          balance: number;
          payment_count: number;
          payment_modes: PaymentMode[] | null;
          created_by: string | null;
          created_by_name: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      app_hospital_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      // Returns text, not an enum, so `string` is what generation will produce.
      // The narrow union lives in lib/hospital-lifecycle.ts, where it survives
      // this file being replaced by real generated output.
      hospital_lifecycle_state: {
        Args: { p_hospital_id: string };
        Returns: string;
      };
      hospital_is_active: {
        Args: { p_hospital_id: string };
        Returns: boolean;
      };
      app_role: {
        Args: Record<PropertyKey, never>;
        Returns: AppRole | null;
      };
      financial_year: {
        Args: { p_at?: string };
        Returns: string;
      };
      next_number: {
        Args: { p_hospital_id: string; p_key: NumberKey };
        Returns: string;
      };
      ist_date: {
        Args: { p_at: string };
        Returns: string;
      };
      search_patients: {
        Args: { p_query: string; p_limit?: number };
        Returns: {
          id: string;
          mrn: string;
          full_name: string;
          dob: string;
          gender: Gender;
          phone: string | null;
          address: string | null;
          last_visit_at: string | null;
          visit_count: number;
        }[];
      };
      /**
       * The resting state of the patients screen: who this hospital has seen
       * most recently, in the same row shape as search_patients. 20260831090000.
       */
      recent_patients: {
        Args: { p_limit?: number };
        Returns: Database['public']['Functions']['search_patients']['Returns'];
      };
      register_patient: {
        Args: { payload: Json };
        Returns: Database['public']['Tables']['patients']['Row'];
      };
      create_visit: {
        Args: { payload: Json };
        Returns: Database['public']['Tables']['visits']['Row'];
      };
      /**
       * Registration in one transaction: patient (MRN), visit (visit_no and a
       * per-doctor token), invoice (number), payment or deferral.
       * 20260829090000.
       */
      register_patient_visit: {
        Args: {
          /** Service-role callers only; a session takes its tenant from the JWT. */
          p_hospital_id?: string | null;
          /** An existing patient. Null means create one from p_patient. */
          p_patient_id?: string | null;
          p_patient?: Json | null;
          p_doctor_id?: string | null;
          p_department_id?: string | null;
          p_fee?: number | null;
          p_payment_mode?: PaymentMode | null;
          p_deferred?: boolean | null;
          p_defer_reason?: string | null;
          /** Service-role callers only; a session records auth.uid(). */
          p_actor_id?: string | null;
          /** Client-generated, so a resubmitted form registers once. */
          p_visit_id?: string | null;
          /** Client-generated, so a resubmitted form bills once. */
          p_invoice_id?: string | null;
        };
        Returns: {
          patient_id: string;
          mrn: string;
          patient_name: string;
          visit_id: string;
          visit_no: string;
          token_no: number;
          doctor_id: string | null;
          doctor_name: string | null;
          department_name: string | null;
          invoice_id: string;
          invoice_no: string;
          grand_total: number;
          payment_due: boolean;
        };
      };
      /**
       * Moves a waiting visit to another doctor: new token at the back of
       * their queue, reason recorded. 20260829090200.
       */
      transfer_visit: {
        Args: {
          p_visit_id: string;
          p_doctor_id: string;
          p_reason: string;
          p_department_id?: string | null;
          /** Service-role callers only; a session takes its tenant from the JWT. */
          p_hospital_id?: string | null;
        };
        Returns: {
          visit_id: string;
          visit_no: string;
          token_no: number;
          doctor_id: string;
          doctor_name: string;
        };
      };
      /** Records that a receipt went to paper. 20260829090100. */
      log_receipt_print: {
        Args: {
          p_invoice_id: string;
          p_format?: string | null;
          /** Service-role callers only; a session takes its tenant from the JWT. */
          p_hospital_id?: string | null;
        };
        Returns: undefined;
      };
      /** Whether a visit still owes money. One bit, readable by any member. */
      visit_payment_due: {
        Args: { p_hospital_id: string; p_visit_id: string };
        Returns: boolean;
      };
      current_staff_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      save_consultation: {
        Args: { payload: Json };
        Returns: Database['public']['Tables']['consultations']['Row'];
      };
      /**
       * Moves a visit between waiting, in_consultation and completed without
       * touching the consultation record -- so a queue-level action cannot
       * blank the vitals the way save_consultation would. 20260831090000.
       */
      set_visit_status: {
        Args: {
          p_visit_id: string;
          p_status: VisitStatus;
          /** Service-role callers only; a session takes its tenant from the JWT. */
          p_hospital_id?: string | null;
        };
        Returns: {
          visit_id: string;
          visit_no: string;
          token_no: number;
          status: VisitStatus;
          doctor_id: string | null;
        };
      };
      collect_payment: {
        Args: {
          p_visit_id: string;
          p_items: Json;
          p_mode?: PaymentMode | null;
          p_amount?: number;
          p_reference?: string | null;
          /** Client-generated, so a resubmitted form bills once. */
          p_invoice_id?: string | null;
          /** Service-role callers only; a session takes its tenant from the JWT. */
          p_hospital_id?: string | null;
          /** Service-role callers only; a session records auth.uid(). */
          p_collected_by?: string | null;
        };
        Returns: Database['public']['Tables']['invoices']['Row'];
      };
      void_invoice: {
        Args: {
          p_invoice_id: string;
          p_reason: string;
          /** Service-role callers only; a session takes its tenant from the JWT. */
          p_hospital_id?: string | null;
        };
        Returns: undefined;
      };
      /**
       * The caller staff record, role, permission keys and account state.
       * Null when the login has no staff record in the active hospital.
       */
      my_access: {
        Args: Record<PropertyKey, never>;
        Returns: {
          staff_id: string;
          staff_name: string;
          role_id: string;
          role_code: string;
          role_name: string;
          role_can_login: boolean;
          staff_can_login: boolean | null;
          permissions: string[];
          has_account: boolean;
          account_disabled: boolean;
          must_change_password: boolean;
          username: string | null;
          contact_email: string | null;
        } | null;
      };
      slugify: {
        Args: { p_text: string };
        Returns: string | null;
      };
      set_role_permissions: {
        Args: { p_role_id: string; p_keys: string[] };
        Returns: undefined;
      };
      seed_starter_services: {
        Args: { p_hospital_id: string; p_only_when_empty?: boolean };
        Returns: number;
      };
      day_close_report: {
        Args: { p_hospital_id: string; p_date?: string | null };
        Returns: {
          bucket: 'total' | 'mode' | 'staff' | 'department';
          key: string;
          label: string;
          entry_count: number;
          amount: number;
        }[];
      };
    };
    Enums: {
      app_role: AppRole;
      number_key: NumberKey;
      audit_action: AuditAction;
      gender: Gender;
      visit_type: VisitType;
      visit_status: VisitStatus;
      service_category: ServiceCategory;
      service_unit: ServiceUnit;
      charge_status: ChargeStatus;
      charge_source: ChargeSource;
      invoice_status: InvoiceStatus;
      payment_mode: PaymentMode;
    };
    CompositeTypes: Record<never, never>;
  };
};
