export default function HomePage() {
  return (
    <>
      <main
        id="main"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16"
      >
        <h1 className="font-serif text-4xl leading-tight text-ink">
          Respite Circle
        </h1>
        <p className="mt-4 max-w-prose text-xl leading-relaxed text-ink">
          A church-run break for the family caregiver.
        </p>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-muted">
          A coordinator reads every ask first. A neighbour claims a time, never a
          story. If nobody can take it, the coordinator calls.
        </p>
      </main>
      <footer className="mx-auto w-full max-w-2xl px-6 pb-10 text-base text-ink-muted">
        Fictional church, fictional families. Sample data.
      </footer>
    </>
  );
}
