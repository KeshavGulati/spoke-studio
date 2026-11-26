import React from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import Header from "./components/Header.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import Dashboard from "./components/Dashboard.jsx";
import CreateProjectDialog from "./components/CreateProjectDialog.jsx";
import Editor from "./components/Editor.jsx";
import { useSpokeStudio } from "./hooks/useSpokeStudio.js";

function StudioLayout() {
  useSpokeStudio();

  return (
    <>
      <Header />
      <div id="loadingIndicator" className="loading-indicator" role="status" aria-live="polite" hidden>
        <span className="loading-spinner" aria-hidden="true" />
        Loading…
      </div>
      <AuthScreen />
      <Dashboard />
      <CreateProjectDialog />
      <Editor />
      <Outlet />
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/projects" replace />} />
      <Route element={<StudioLayout />}>
        <Route path="/login" element={null} />
        <Route path="/signup" element={null} />
        <Route path="/projects" element={null} />
        <Route path="/projects/:projectId" element={null} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Route>
    </Routes>
  );
}
