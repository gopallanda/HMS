import { ShieldIcon } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { roleLabel, type AppRole } from '@/lib/roles';

/**
 * Shown instead of redirecting.
 *
 * A silent bounce to the overview reads as a broken link; a nurse who lands
 * here needs to know it is a permission, not a bug, and which role they are
 * currently signed in as -- on a shared machine that is usually the answer.
 */
export function AccessDenied({
  role,
  area,
  audience = 'administrators',
}: {
  role: AppRole;
  area: string;
  /** Who the area IS for, in the plural: 'administrators', 'the front desk'. */
  audience?: string;
}) {
  return (
    <Card className="mx-auto mt-12 max-w-md">
      <CardContent className="grid gap-4 py-4 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10">
          <ShieldIcon className="size-6 stroke-[1.5] text-primary" />
        </span>
        <div className="grid gap-1.5">
          <p className="text-base font-semibold">
            {area} is for {audience}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            You are signed in as {roleLabel(role)}. Ask an administrator if you need access, or
            sign in with an account that has it.
          </p>
        </div>
        <Button asChild variant="outline" className="mx-auto">
          <Link href="/">Go to overview</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
