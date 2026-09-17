import { SignInButton } from "./sign-in-button";

const ERRORS: Record<string, string> = {
  not_allowed:
    "That Google account isn't on the access list. Ask Indy to add your email to ALLOWED_EMAILS, then try again.",
  auth_failed: "Google sign-in didn't finish. Please try again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const message = typeof error === "string" ? ERRORS[error] : undefined;
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-amber-600">lemonlolly</p>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">Content Hub</h1>
        <p className="mt-2 text-sm text-stone-500">Sign in with your lemonlolly Google account.</p>
        {message && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{message}</p>
        )}
        <div className="mt-6">
          <SignInButton />
        </div>
      </div>
    </main>
  );
}
