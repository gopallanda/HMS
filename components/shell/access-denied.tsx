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
    <Card className="mx-auto mt-10 max-w-md">
      <CardContent className="grid gap-3 text-center">
        <span className="mx-auto flex size-9 items-center justify-center rounded-lg bg-muted">
          <ShieldIcon className="size-4 text-muted-foreground" />
        </span>
        <div className="grid gap-1">
          <p className="text-sm font-semibold">
            {area} is for {audience}
          </p>
          <p className="text-xs text-muted-foreground">
            You are signed in as {roleLabel(role)}. Ask an administrator if you need access, or
            sign in with an account that has it.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="mx-auto">
          <Link href="/">Back to overview</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
