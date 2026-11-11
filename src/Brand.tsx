export function Brand() {
  return (
    <div className="brand">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M10 11l14 7 14-7v17c0 12-28 12-28 0z" fill="currentColor" />
        <circle cx="17" cy="24" r="4.5" fill="var(--brand-eye)" />
        <circle cx="31" cy="24" r="4.5" fill="var(--brand-eye)" />
        <path d="M20 30h8l-4 5z" fill="var(--brand-eye)" />
      </svg>
      <span>
        sova<span className="brand-period">.</span>
      </span>
      <small>PERSONAL AGENT</small>
    </div>
  );
}
