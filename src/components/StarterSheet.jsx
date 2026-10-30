export default function StarterSheet({ sheet, onLoad, featured = false }) {
  if (!sheet) return null

  return (
    <div className={`starter-sheet${featured ? ' featured' : ''}`}>
      <div className="starter-copy">
        <span className="starter-kicker">{featured ? 'New here?' : 'Starter sheet'}</span>
        <strong className="starter-title">{sheet.name}</strong>
        {sheet.description && <span className="starter-meta">{sheet.description}</span>}
      </div>
      <button
        type="button"
        className={`btn btn-small${featured ? ' btn-primary' : ''}`}
        onClick={() => onLoad(sheet)}
        aria-label={`Load ${featured ? 'starter sheet' : 'starter'} ${sheet.name}`}
      >
        {featured ? 'Load starter sheet' : 'Load'}
      </button>
    </div>
  )
}
