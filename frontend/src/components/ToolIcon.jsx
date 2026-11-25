import React from "react";

const paths = {
  brush: (
    <path d="M3 16c4-10 7-13 8-9 1 3-7 10-5 12 2 2 7-10 9-9 3 1-5 10-1 10 2 0 4-4 6-6" />
  ),
  erase: (
    <>
      <path d="m4 15 9-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 9H9z" />
      <path d="m8 11 9 9M13 22h9" />
    </>
  ),
  pointer: <path d="M6 3v17l4-5 4 7 3-2-4-7h7z" />,
  pan: (
    <path d="M8 13V6a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 5-3 7-7 7-3 0-5-2-7-5l-3-5c-1-2 1-3 3-1l2 2" />
  ),
  zoomIn: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6M7 10h6M10 7v6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6M7 10h6" />
    </>
  ),
  fit: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8" />,
  polygon: (
    <>
      <path d="m5 5 14 3-3 12-12-4z" />
      <circle cx="5" cy="5" r="1" />
      <circle cx="19" cy="8" r="1" />
      <circle cx="16" cy="20" r="1" />
      <circle cx="4" cy="16" r="1" />
    </>
  ),
};

export default function ToolIcon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
