export function Icon({ name, size = 20 }: {
  name: string;
  size?: number;
}) {
  const paths: Record<string, string> = { folder: 'M3 6h6l2 2h10v11H3z M3 6V4h6l2 2', themes: 'M4 4h16v16H4z M4 14l5-5 5 6 3-3 3 3 M15 7h.01', sounds: 'M5 9v6h4l5 4V5L9 9z M18 8q5 4 0 8', crosshairs: 'M12 2v5 M12 17v5 M2 12h5 M17 12h5 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0', install: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5', restore: 'M4 10a8 8 0 1 1 1 8 M4 4v6h6 M12 7v5l3 2', help: 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', check: 'M5 12l4 4L19 6', arrow: 'M4 12h15 M14 7l5 5-5 5', shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6', warning: 'M12 3L2 21h20z M12 9v5 M12 17h.01', search: 'M17 17l4 4 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', close: 'M6 6l12 12 M6 18L18 6', ui: 'M3 4h18v16H3z M3 9h18 M9 9v11', palette: 'M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-4c-2-1 0-3 2-3h2c4 0 2-11-7-11 M7 9h.01 M11 6h.01 M16 8h.01', primary: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6' };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name] ?? paths.folder} />
  </svg>;
}
export function TargetMark() {
  return <svg className="ki-target" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <circle cx="23" cy="25" r="18" stroke="currentColor" strokeWidth="3.2" />
    <circle cx="23" cy="25" r="11" stroke="currentColor" strokeWidth="3.2" />
    <circle cx="23" cy="25" r="3.5" fill="currentColor" />
    <path d="M24 24 41 7 M32 7h9v9" stroke="var(--ki-bg)" strokeWidth="7" />
    <path d="M24 24 41 7 M32 7h9v9" stroke="currentColor" strokeWidth="3.2" strokeLinecap="square" />
  </svg>;
}
