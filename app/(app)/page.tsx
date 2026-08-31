import {
  Building2Icon,
  CalendarClockIcon,
  CalendarRangeIcon,
  CheckIcon,
  CreditCardIcon,
  StethoscopeIcon,
  UserRoundPlusIcon,
  UsersIcon,
} from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/shared/empty-state';
import { QuickAction, StatCard } from '@/components/shared/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireSession } from '@/lib/auth/session';
import { navFor } from '@/lib/nav';
import { roleLabel } from '@/lib/roles';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/cn';
import { formatLongDate, greetingIst } from '@/lib/utils/dates';
import { financialYear } from '@/lib/utils/financial-year';
import { formatMoney } from '@/lib/utils/money';

export const metadata = { title: 'Overview' };

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
  // The setup checklist is for whoever can act on it. settings.manage is the
  // permission behind every link in it.
  const admin = session.access.permissions.has('settings.manage');

  const setup = [
    { done: Boolean(session.hospital.logo_url), label: 'Upload a logo', href: '/admin/settings' },
    { done: Boolean(session.hospital.gstin), label: 'Record the GSTIN', href: '/admin/settings' },
    { done: Boolean(session.hospital.address), label: 'Add the address', href: '/admin/settings' },
    { done: (departments.count ?? 0) > 0, label: 'Create departments', href: '/admin/departments' },
    { done: doctorRows.length > 0, label: 'Add doctors and their fees', href: '/admin/staff' },
  ];
  const completed = setup.filter((step) => step.done).length;

  const planned = navFor(session.access.permissions)
    .flatMap((section) => section.items)
    .filter((item) => item.status === 'planned');

  // The quick actions are drawn from the same nav table the sidebar reads, so
  // a cashier is never offered a shortcut to a screen they cannot open.
  const reachable = new Set(
    navFor(session.access.permissions)
      .flatMap((section) => section.items)
      .filter((item) => item.status === 'ready')
      .map((item) => item.href),
  );

  const actions = [
    {
      href: '/front-desk/register',
      icon: UserRoundPlusIcon,
      label: 'Register patient',
      description: 'Search by phone, then register',
      tone: 'primary' as const,
    },
    {
      href: '/billing/collect',
      icon: CreditCardIcon,
      label: 'Collect payment',
      description: 'Bill a visit and print',
      tone: 'success' as const,
    },
    {
      href: '/front-desk/queue',
      icon: CalendarClockIcon,
      label: "Today's queue",
      description: 'Who is waiting, and for whom',
      tone: 'info' as const,
    },
    {
      href: '/doctor/queue',
      icon: StethoscopeIcon,
      label: 'My queue',
      description: 'Patients waiting for you',
      tone: 'brand' as const,
    },
  ].filter((action) => reachable.has(action.href));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
          Good {greetingIst()}, {session.hospital.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatLongDate()} · Signed in as {roleLabel(session.role)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Building2Icon}
          label="Departments"
          value={departments.count ?? 0}
          note="Active"
          tone="primary"
        />
        <StatCard
          icon={UsersIcon}
          label="Staff"
          value={staff.count ?? 0}
          note="Active records"
          tone="info"
        />
        <StatCard
          icon={StethoscopeIcon}
          label="Doctors"
          value={doctorRows.length}
          note="Taking OPD"
          tone="success"
        />
        <StatCard
          icon={CalendarRangeIcon}
          label="Financial year"
          value={financialYear()}
          note="Apr 1 – Mar 31"
          tone="brand"
        />
      </div>

      {actions.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-lg font-medium">Quick actions</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {actions.map((action) => (
              <QuickAction key={action.href} {...action} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Consultation fees
            </CardTitle>
          </CardHeader>
          <CardContent>
            {doctorRows.length === 0 ? (
              <EmptyState
                compact
                icon={StethoscopeIcon}
                title="No doctors yet"
                description="Consultation charges are seeded from a doctor's fee when a visit is created, so this is the first thing to fill in."
                action={
                  admin ? (
                    <Button asChild size="sm">
                      <Link href="/admin/staff">Add your first doctor</Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="grid">
                {doctorRows.map((doctor) => (
                  <li
                    key={doctor.full_name}
                    className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm last:border-0"
                  >
                    <span className="min-w-0 truncate">{doctor.full_name}</span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {formatMoney(doctor.consultation_fee)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {admin ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Setup
                <Badge variant={completed === setup.length ? 'success' : 'warning'}>
                  {completed}/{setup.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              {/* A bar rather than only the fraction: "3/5" is a number to read,
                  a bar three fifths across is a state to glance at. */}
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={completed}
                aria-valuemin={0}
                aria-valuemax={setup.length}
                aria-label="Setup progress"
              >
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-500',
                    completed === setup.length ? 'bg-success' : 'bg-primary',
                  )}
                  style={{ width: `${(completed / setup.length) * 100}%` }}
                />
              </div>

              <ul className="grid gap-1">
                {setup.map((step) => (
                  <li
                    key={step.label}
                    className="flex items-center justify-between gap-3 py-1 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          'grid size-5 shrink-0 place-items-center rounded-full',
                          step.done
                            ? 'bg-success/15 text-success'
                            : 'border border-dashed border-border',
                        )}
                      >
                        {step.done ? <CheckIcon className="size-3 stroke-[2.5]" /> : null}
                      </span>
                      <span className={cn('truncate', step.done && 'text-muted-foreground')}>
                        {step.label}
                      </span>
                    </span>
                    {step.done ? (
                      <span className="shrink-0 text-xs text-muted-foreground">Done</span>
                    ) : (
                      <Link
                        href={step.href}
                        className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Open
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                Coming next
              </CardTitle>
            </CardHeader>
            <CardContent>
              {planned.length === 0 ? (
                <EmptyState
                  compact
                  icon={CheckIcon}
                  title="Everything for your role is here"
                  description="Nothing on your side of the product is still being built."
                />
              ) : (
                <ul className="grid gap-1">
                  {planned.map((item) => (
                    <li
                      key={item.href}
                      className="flex items-center justify-between gap-3 py-1.5 text-sm"
                    >
                      <span className="truncate text-muted-foreground">{item.label}</span>
                      <Badge variant="outline">Phase {item.phase}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
