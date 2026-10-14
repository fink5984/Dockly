import type { LegalDoc } from '../copy/types'
import { Container, Layout, type PageProps } from '../components/Layout'
import { marketingPath } from '../routes'

const slug = (i: number) => `s${i + 1}`

export function LegalPage({ copy, lang, doc }: PageProps & { doc: 'privacy' | 'terms' | 'accessibility' }) {
  const d: LegalDoc = copy.legal[doc]
  return (
    <Layout copy={copy} lang={lang} page={doc}>
      <Container className="grid gap-12 py-16 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-20">
        <nav aria-label={copy.legal.toc} className="hidden lg:block">
          <div className="sticky top-24">
            <p className="text-xs font-semibold uppercase tracking-wider text-fg-4">{copy.legal.toc}</p>
            <ol className="mt-3 space-y-2 text-sm">
              {d.sections.map((s, i) => <li key={s.heading}><a href={`#${slug(i)}`} className="text-fg-3 hover:text-fg">{s.heading}</a></li>)}
            </ol>
            <ul className="mt-8 space-y-2 border-t border-line pt-6 text-sm">
              {(['privacy', 'terms', 'accessibility'] as const).map((k) => (
                <li key={k}><a href={marketingPath(k, lang)} aria-current={k === doc ? 'page' : undefined} className="text-fg-3 hover:text-fg aria-[current=page]:font-semibold aria-[current=page]:text-fg">{copy.legal[k].title}</a></li>
              ))}
            </ul>
          </div>
        </nav>
        <article className="max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight">{d.title}</h1>
          <p className="mt-3 text-sm text-fg-4">{d.updated}</p>
          <p className="mt-8 text-md leading-relaxed text-fg-2">{d.intro}</p>
          {d.sections.map((s, i) => (
            <section key={s.heading} className="mt-10 scroll-mt-24" id={slug(i)} aria-labelledby={`${slug(i)}-h`}>
              <h2 id={`${slug(i)}-h`} className="text-xl font-semibold tracking-tight">{s.heading}</h2>
              {s.paragraphs?.map((p) => <p key={p.slice(0, 40)} className="mt-3 leading-relaxed text-fg-2">{p}</p>)}
              {s.bullets && (
                <ul className="mt-3 list-disc space-y-2 ps-5 leading-relaxed text-fg-2 marker:text-fg-4">
                  {s.bullets.map((b) => <li key={b.slice(0, 40)}>{b}</li>)}
                </ul>
              )}
            </section>
          ))}
        </article>
      </Container>
    </Layout>
  )
}

export function NotFoundPage({ copy, lang }: PageProps) {
  return (
    <Layout copy={copy} lang={lang} page="notFound">
      <Container className="py-32 text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">{copy.notFound.title}</h1>
        <p className="mt-4 text-fg-3">{copy.notFound.body}</p>
        <a href={marketingPath('home', lang)} className="mt-8 inline-flex h-11 items-center rounded-full bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">{copy.notFound.home}</a>
      </Container>
    </Layout>
  )
}
