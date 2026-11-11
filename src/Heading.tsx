export function Heading({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="eyebrow">{eyebrow}</div>
      <div className="heading-row">
        <div>
          <h1>
            {title}
            <span className="heading-dot">.</span>
          </h1>
          <p>{text}</p>
        </div>
        {action}
      </div>
    </div>
  );
}
