import Link from 'next/link';

import { PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireSession } from '@/lib/auth/session';
import { navFor } from '@/lib/nav';
import { isAdminRole, roleLabel } from '@/lib/roles';
import { createClient } from '@/lib/supabase/server';
import { financialYear } from '@/lib/utils/financial-year';
import { formatMoney } from '@/lib/utils/money';

export const metadata = { title: 'Overview' };

type Stat = { label: string; value: string; note?: string };

export default async function OverviewPage() {
  const session = await requireSession();
  const supabase = await createClient();

  // Counts only -- head:true skips the rows entirely. RLS scopes all three to
  // this hospital, so no hospital_id filter is needed for correctness; it is
  // here anyway so the query still reads correctly if it is ever moved to the
  // service-role client.
  const [departments, staff, doctors] = await Promise.all([
    supabase
      .from('departments')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', session.hospitalId)
      .eq('is_active', true),
    supabase
      .from('staff')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', session.hospitalId)
      .eq('is_active', true),
    supabase
      .from('staff')
      .select('full_name, consultation_fee, is_active')
      .eq('hospital_id', session.hospitalId)
      .eq('role', 'doctor')
      .eq('is_active', true)
      .order('full_name'),
  ]);

  const doctorRows = doctors.data ?? [];

  const stats: Stat[] = [
    { label: 'Active departments', value: String(departments.count ?? 0) },
    { label: 'Active staff', value: String(staff.count ?? 0) },
    { label: 'Doctors taking OPD', value: String(doctorRows.length) },
    { label: 'Financial year', value: financialYear(), note: 'Apr 1 - Mar 31' },
  ];

  const setup = [
    { done: Boolean(session.hospital.logo_url), label: 'Upload a logo', href: '/admin/settings' },
    { done: Boolean(session.hospital.gstin), label: 'Record the GSTIN', href: '/admin/settings' },
    { done: Boolean(session.hospital.address), label: 'Add the address', href: '/admin/settings' },
    { done: (departments.count ?? 0) > 0, label: 'Create departments', href: '/admin/departments' },
    { done: doctorRows.length > 0, label: 'Add doctors and their fees', href: '/admin/staff' },
  ];
  const remaining = setup.filter((step) => !step.done);

  const planned = navFor(session.role)
    .flatMap((section) => section.items)
    .filter((item) => item.status === 'planned');

  return (
    <div className="grid gap-4">
      <PageHeader
        title={session.hospital.name}
        description={`Signed in as ${roleLabel(session.role)}`}
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardContent className="grid gap-0.5">
              <span className="text-xs text-muted-foreground">
                {stat.label}
              </span>
              <span className="text-xl font-semibold tabular-nums">{stat.value}</span>
              {stat.note ? (
                <span className="text-xs text-muted-foreground">{stat.note}</span>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-sm">Consultation fees</CardTitle>
          </CardHeader>
          <CardContent>
            {doctorRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No active doctors yet.{' '}
                {isAdminRole(session.role) ? (
                  <Link href="/admin/staff" className="underline underline-offset-2">
                    Add one
                  </Link>
                ) : null}
              </p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {doctorRows.map((doctor) => (
                    <tr key={doctor.full_name} className="border-b last:border-0">
                      <td className="py-1 pr-2">{doctor.full_name}</td>
                      <td className="py-1 text-right tabular-nums">
                        {formatMoney(doctor.consultation_fee)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {isAdminRole(session.role) ? (
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">
                Setup
                <Badge variant={remaining.length === 0 ? 'success' : 'warning'} className="ml-2">
                  {setup.length - remaining.length}/{setup.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1">
              {setup.map((step) => (
                <div key={step.label} className="flex items-center justify-between gap-2 text-sm">
                  <span className={step.done ? 'text-muted-foreground line-through' : undefined}>
                    {step.label}
                  </span>
                  {step.done ? (
                    <span className="text-xs text-muted-foreground">done</span>
                  ) : (
                    <Link
                      href={step.href}
                      className="text-xs underline underline-offset-2"
                    >
                      open
                    </Link>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Coming next</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1">
              {planned.length === 0 ? (
                <p className="text-xs text-muted-foreground">Everything for your role is here.</p>
              ) : (
                planned.map((item) => (
                  <div key={item.href} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{item.label}</span>
                    <Badge variant="outline">Phase {item.phase}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
