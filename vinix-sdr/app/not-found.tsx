import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <p className="text-5xl font-semibold tracking-tight text-stone-300">404</p>
        <h1 className="mt-3 text-lg font-semibold tracking-tight text-stone-900">Esta página no existe</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-stone-500">
          El enlace puede estar mal escrito o el recurso se ha eliminado.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-700"
        >
          Volver al panel
        </Link>
      </div>
    </main>
  );
}
