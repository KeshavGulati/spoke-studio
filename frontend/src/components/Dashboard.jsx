import React from "react";

export default function Dashboard() {
  return (
    <div id="dashboard">
      <div className="dashboard-tools">
        <p id="projectTotal">Projects</p>
        <input
          id="projectSearch"
          type="search"
          placeholder="Search projects"
          aria-label="Search projects"
        />
      </div>
      <p id="dashboardError" role="alert" />
      <div id="projectGrid" />
    </div>
  );
}
