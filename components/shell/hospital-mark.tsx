import Image from 'next/image';

import { cn } from '@/lib/cn';

/** "Sunrise Multispeciality Hospital" -> "SM". Used until a logo is uploaded. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The hospital's logo, or its initials.
 *
 * Both come from the hospitals row, never from a constant (CLAUDE.md 7) --
 * this same pair will sit at the top of every printed invoice.
 */
export function HospitalMark({
  name,
  logoUrl,
  size = 32,
  className,
}: {
  name: string;
  logoUrl: string | null;
  size?: number;
  className?: string;
}) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={`${name} logo`}
        width={size}
        height={size}
        className={cn('rounded-lg bg-white object-contain', className)}
        // Logos are small and above the fold; a placeholder flash is worse than
        // the byte cost.
        priority
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground',
        className,
      )}
    >
      {initials(name) || 'H'}
    </span>
  );
}
