import React from "react";

export default function CreateProjectDialog() {
  return (
    <dialog id="createDialog" aria-labelledby="createTitle">
      <h2 id="createTitle">Create project</h2>
      <p>
        Give your image sequence a name. You can import images and masks after
        creating the project.
      </p>
      <form id="createProject">
        <label>
          Project name
          <input
            id="newProjectName"
            type="text"
            maxLength="120"
            placeholder="e.g. B-ring · observation 081"
            required
          />
        </label>
        <p id="createError" role="alert" />
        <div className="dialog-actions">
          <button id="cancelCreate" type="button">
            Cancel
          </button>
          <button type="submit" className="primary">
            Create project
          </button>
        </div>
      </form>
    </dialog>
  );
}
