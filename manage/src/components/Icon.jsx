import React from "react";

export function Icon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
  };

  const paths = {
    dashboard: (
      <>
        <path d="M4 13h6v7H4v-7Z" />
        <path d="M14 4h6v16h-6V4Z" />
        <path d="M4 4h6v5H4V4Z" />
      </>
    ),
    queue: (
      <>
        <path d="M5 6h14" />
        <path d="M5 12h14" />
        <path d="M5 18h9" />
      </>
    ),
    calendar: (
      <>
        <path d="M5 6h14v14H5V6Z" />
        <path d="M8 3v6" />
        <path d="M16 3v6" />
        <path d="M5 10h14" />
        <path d="M9 14h.01" />
        <path d="M13 14h.01" />
        <path d="M17 14h.01" />
        <path d="M9 17h.01" />
        <path d="M13 17h.01" />
      </>
    ),
    initiative: (
      <>
        <path d="M5 19V6l7-3 7 3v13" />
        <path d="M9 19v-7h6v7" />
        <path d="M12 8v.01" />
      </>
    ),
    repo: (
      <>
        <path d="M7 5h8l4 4v10H7V5Z" />
        <path d="M15 5v4h4" />
        <path d="M10 14h6" />
      </>
    ),
    agent: (
      <>
        <path d="M12 3v3" />
        <path d="M7 8h10a3 3 0 0 1 3 3v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5a3 3 0 0 1 3-3Z" />
        <path d="M9 13h.01" />
        <path d="M15 13h.01" />
        <path d="M9 17h6" />
      </>
    ),
    review: (
      <>
        <path d="M5 4h14v16H5V4Z" />
        <path d="m8 12 2 2 5-5" />
        <path d="M8 18h8" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    search: (
      <>
        <path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
        <path d="m16 16 4 4" />
      </>
    ),
    copy: (
      <>
        <path d="M9 9h10v10H9V9Z" />
        <path d="M5 15H4V4h11v1" />
      </>
    ),
    external: (
      <>
        <path d="M10 5H5v14h14v-5" />
        <path d="M14 5h5v5" />
        <path d="m13 11 6-6" />
      </>
    ),
    branch: (
      <>
        <path d="M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
        <path d="M17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
        <path d="M7 9v3a4 4 0 0 0 4 4h4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    warning: (
      <>
        <path d="M12 4 3 19h18L12 4Z" />
        <path d="M12 10v4" />
        <path d="M12 16h.01" />
      </>
    ),
    moon: (
      <>
        <path d="M20 14.8A8.5 8.5 0 0 1 9.2 4a7.2 7.2 0 1 0 10.8 10.8Z" />
      </>
    ),
    sun: (
      <>
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </>
    ),
    close: (
      <>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </>
    ),
    more: (
      <>
        <path d="M6 12h.01" />
        <path d="M12 12h.01" />
        <path d="M18 12h.01" />
      </>
    ),
  };

  return (
    <svg {...common} className="icon">
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[name]}
      </g>
    </svg>
  );
}
