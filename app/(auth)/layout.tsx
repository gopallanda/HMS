/**
 * Shell for signed-out screens. No sidebar, no hospital branding -- which
 * hospital a person belongs to is not known until they authenticate.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 items-center justify-center bg-muted/40 p-4">
      {children}
    </div>
  );
}
