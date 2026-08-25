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
 * 20260825140000_hospital_lifecycle.sql. They are written here from the
 * migration, NOT verified against the live schema -- that migration is applied
 * by hand in the SQL editor, because db:push cannot reach the hosted project
 * from a network without IPv6.
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
      staff: {
        Row: {
          id: string;
          hospital_id: string;
          user_id: string | null;
          full_name: string;
          role: AppRole;
          department_id: string | null;
          phone: string | null;
          reg_no: string | null;
          consultation_fee: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          hospital_id: string;
          user_id?: string | null;
          full_name: string;
          role: AppRole;
          department_id?: string | null;
          phone?: string | null;
          reg_no?: string | null;
          consultation_fee?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          hospital_id?: string;
          user_id?: string | null;
          full_name?: string;
          role?: AppRole;
          department_id?: string | null;
          phone?: string | null;
          reg_no?: string | null;
          consultation_fee?: number;
          is_active?: boolean;
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
          created_by: string | null;
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
      register_patient: {
        Args: { payload: Json };
        Returns: Database['public']['Tables']['patients']['Row'];
      };
      create_visit: {
        Args: { payload: Json };
        Returns: Database['public']['Tables']['visits']['Row'];
      };
      current_staff_id: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      save_consultation: {
        Args: { payload: Json };
        Returns: Database['public']['Tables']['consultations']['Row'];
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
      charge_status: ChargeStatus;
      charge_source: ChargeSource;
      invoice_status: InvoiceStatus;
      payment_mode: PaymentMode;
    };
    CompositeTypes: Record<never, never>;
  };
};
