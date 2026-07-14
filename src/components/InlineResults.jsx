import { ExternalLink, LoaderCircle, X } from 'lucide-react'

export function InlineResults({ query, results, loading, error, onClose }) {
  return (
    <section className="inline-results" aria-label="Inline search results">
      <header>
        <div><small>INLINE RESULTS</small><h2>{query}</h2></div>
        <button type="button" onClick={onClose} aria-label="Close inline results"><X /></button>
      </header>
      {loading && <div className="results-state"><LoaderCircle className="spin" /> Searching</div>}
      {error && <div className="results-state error">{error}</div>}
      {!loading && !error && (
        <ol>
          {results.map((result) => (
            <li key={`${result.url}:${result.title}`}>
              <a href={result.url} target="_blank" rel="noreferrer">
                <div><strong>{result.title}</strong><span>{result.url}</span></div>
                <ExternalLink size={17} />
              </a>
              {result.content && <p>{result.content}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
