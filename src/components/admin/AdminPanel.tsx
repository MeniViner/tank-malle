import type { ReactNode } from 'react';

/** Shared section layout for the existing admin and its operations views. */
export function AdminPanel({ title, note, trailing, bare = false, children }: {
  title: string;
  note?: string;
  trailing?: ReactNode;
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="admin-group-head">
        <h2>{title}</h2>
        {trailing}
      </div>
      {note ? <p className="-mt-1 text-[13px] text-muted">{note}</p> : null}
      {bare ? children : <div className="admin-group">{children}</div>}
    </section>
  );
}
