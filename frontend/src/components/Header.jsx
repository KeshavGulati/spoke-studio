import React from "react";

export default function Header() {
  return (
    <header>
      <h1>
        <span className="brand-mark" aria-hidden="true" />
        Spoke Studio
      </h1>
      <button id="projectsButton">← Projects</button>
      <small id="projectTitle">Collaborative mask workspace</small>
      <button id="importFolder">Import folder</button>
      <button id="importFiles">Import images</button>
      <button id="importMasks">Import masks</button>
      <input
        id="masksInput"
        type="file"
        accept="image/png,.png"
        multiple
        hidden
      />
      <input
        id="folderInput"
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        hidden
      />
      <input
        id="filesInput"
        type="file"
        accept="image/png,.png"
        multiple
        hidden
      />
      <button id="createButton" className="primary">
        Create
      </button>
      <span id="themePill" className="theme-pill">
        <span aria-hidden="true">☾</span>Dark
      </span>
      <span id="status">Loading frames…</span>
      <small id="userBadge" hidden />
      <button id="logoutButton" hidden>
        Log out
      </button>
    </header>
  );
}
